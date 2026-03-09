const STORAGE_KEY = "brainstormer_ak";
const SALT = "brstnmr_2024_ak";

function obfuscate(key: string): string {
  const keyBytes = new TextEncoder().encode(key);
  const saltBytes = new TextEncoder().encode(SALT);
  const result = keyBytes.map((b, i) => b ^ saltBytes[i % saltBytes.length]);
  return btoa(String.fromCharCode(...result));
}

function deobfuscate(stored: string): string {
  try {
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const saltBytes = new TextEncoder().encode(SALT);
    const result = bytes.map((b, i) => b ^ saltBytes[i % saltBytes.length]);
    return new TextDecoder().decode(result);
  } catch {
    return "";
  }
}

export function getStoredApiKey(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? deobfuscate(stored) : "";
}

export function setStoredApiKey(key: string): void {
  if (key.trim()) {
    localStorage.setItem(STORAGE_KEY, obfuscate(key.trim()));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasStoredApiKey(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}
