"""Web search and URL fetching tools for participants."""
from __future__ import annotations
import asyncio
import random
import re
import time
from urllib.parse import unquote
import httpx

_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
]

# Serialize all search requests and track last request time
_search_lock: asyncio.Lock | None = None
_last_search_time: float = 0.0
_MIN_SEARCH_INTERVAL = 1.5  # seconds between DDG requests


def _get_lock() -> asyncio.Lock:
    global _search_lock
    if _search_lock is None:
        _search_lock = asyncio.Lock()
    return _search_lock


async def _ddg_html_search(query: str) -> list[dict] | None:
    """Search via DuckDuckGo HTML lite with rate-limit awareness."""
    global _last_search_time

    for attempt in range(3):
        async with _get_lock():
            # Enforce minimum interval between requests
            now = time.monotonic()
            wait = _MIN_SEARCH_INTERVAL - (now - _last_search_time)
            if wait > 0:
                await asyncio.sleep(wait)

            try:
                ua = random.choice(_USER_AGENTS)
                async with httpx.AsyncClient(follow_redirects=True, timeout=20) as client:
                    r = await client.get(
                        "https://html.duckduckgo.com/html/",
                        params={"q": query},
                        headers={"User-Agent": ua},
                    )
                _last_search_time = time.monotonic()
            except Exception:
                _last_search_time = time.monotonic()
                if attempt < 2:
                    await asyncio.sleep(2 ** attempt)
                    continue
                return None

        if r.status_code in (202, 429):
            if attempt < 2:
                await asyncio.sleep(2 + attempt * 2)
                continue
            return None

        if r.status_code != 200:
            return None

        if "result__a" not in r.text:
            # Got 200 but no results (possibly CAPTCHA page)
            if attempt < 2:
                await asyncio.sleep(2 + attempt * 2)
                continue
            return None

        # Parse results
        results = []
        blocks = re.findall(
            r'<a rel="nofollow" class="result__a" href="(.*?)">(.*?)</a>'
            r'.*?<a class="result__snippet"[^>]*>(.*?)</a>',
            r.text, re.DOTALL,
        )
        for href, title, snippet in blocks[:5]:
            clean_title = re.sub(r"<[^>]+>", "", title).strip()
            clean_snippet = re.sub(r"<[^>]+>", "", snippet).strip()
            clean_snippet = clean_snippet.replace("&#x27;", "'").replace("&amp;", "&")
            # Extract real URL from DDG redirect
            real_url = href
            url_match = re.search(r"uddg=([^&]+)", href)
            if url_match:
                real_url = unquote(url_match.group(1))
            results.append({
                "title": clean_title,
                "href": real_url,
                "body": clean_snippet,
            })
        return results if results else None

    return None



async def search_web(query: str) -> str:
    """Search the web and return formatted results."""
    # Go straight to HTML scraping — more reliable under load
    results = await _ddg_html_search(query)
    if results is None:
        return "Search temporarily unavailable. Please provide your analysis based on your existing knowledge."
    if not results:
        return "No results found."
    parts = []
    for r in results:
        parts.append(
            f"Title: {r.get('title', '')}\n"
            f"URL: {r.get('href', '')}\n"
            f"Snippet: {r.get('body', '')}"
        )
    return "\n---\n".join(parts)


async def fetch_url(url: str) -> str:
    """Fetch and extract the text content of a URL."""
    try:
        ua = random.choice(_USER_AGENTS)
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            r = await client.get(url, headers={"User-Agent": ua})
            r.raise_for_status()
            html = r.text
        # Strip scripts, styles, then all tags
        html = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000]
    except Exception as e:
        return f"Failed to fetch URL: {e}"


TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for current information, news, data, or any topic needed to inform your response.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch and read the text content of a specific URL or webpage.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The full URL to fetch"},
                },
                "required": ["url"],
            },
        },
    },
]
