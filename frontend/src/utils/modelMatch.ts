import type { OpenRouterModel } from "../types";

// Qualifiers stripped before scoring — they add noise without meaning.
const QUALIFIER_TOKENS = new Set(["beta", "preview", "exp", "experimental", "latest", "free"]);
// Tokens treated as equivalent (small/cheap model tier).
const SMALL_TIER = new Set(["mini", "fast", "flash", "lite", "haiku", "small"]);

/** Split a model ID's name part into lowercase tokens on [-_.] boundaries,
 *  stripping qualifiers and normalising small-tier synonyms. */
function tokenize(modelId: string): string[] {
  const name = modelId.includes("/") ? modelId.split("/")[1] : modelId;
  return name
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(Boolean)
    .reduce<string[]>((acc, t) => {
      if (/^\d+([._-]\d+)*$/.test(t)) return acc; // version number
      if (QUALIFIER_TOKENS.has(t)) return acc;
      acc.push(SMALL_TIER.has(t) ? "_small" : t);
      return acc;
    }, []);
}

/** Extract version numbers from a raw model ID string (higher = newer). */
function extractVersions(modelId: string): number[] {
  return [...modelId.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
}

/** Compare two version arrays; higher values sort first. */
function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Find the best available model for a target ID.
 *
 * @param preferNewest  When false (default), exact match wins — use this when
 *   the user explicitly chose a model.  When true, skip exact match and always
 *   return the highest-versioned fuzzy match — use this for dropdown
 *   suggestions where we want the latest model.
 */
export function findBestModel(
  targetId: string,
  available: OpenRouterModel[],
  { preferNewest = false }: { preferNewest?: boolean } = {},
): OpenRouterModel | undefined {
  if (!available.length) return undefined;

  if (!preferNewest) {
    const exact = available.find((m) => m.id === targetId);
    if (exact) return exact;
  }

  const provider = targetId.split("/")[0];
  if (!provider) return undefined;

  const sameProvider = available.filter((m) => m.id.startsWith(provider + "/"));
  if (!sameProvider.length) return undefined;

  const targetTokens = tokenize(targetId);

  const scored = sameProvider.map((m) => {
    const tokens = tokenize(m.id);
    const shared = tokens.filter((t) => targetTokens.includes(t)).length;
    const union = new Set([...tokens, ...targetTokens]).size || 1;
    return { m, score: shared / union, versions: extractVersions(m.id) };
  });

  const maxScore = Math.max(...scored.map((x) => x.score));
  if (maxScore === 0) return undefined;

  return scored
    .filter((x) => x.score === maxScore)
    .sort((a, b) => compareVersions(a.versions, b.versions))[0]?.m;
}

/**
 * Resolve an ordered list of preferred model IDs to their best available
 * matches, preserving order and deduplicating so the same resolved model
 * doesn't appear twice.  Always prefers newest versions since these are
 * used for dropdown suggestions, not user-chosen models.
 */
export function resolvePreferredModels(
  preferredIds: readonly string[],
  available: OpenRouterModel[]
): OpenRouterModel[] {
  const seen = new Set<string>();
  const result: OpenRouterModel[] = [];
  for (const id of preferredIds) {
    const m = findBestModel(id, available, { preferNewest: true });
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      result.push(m);
    }
  }
  return result;
}
