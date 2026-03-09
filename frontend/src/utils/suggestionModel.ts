const STORAGE_KEY = "brainstormer_suggestion_model";

export function getStoredSuggestionModel(): string {
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setStoredSuggestionModel(modelId: string): void {
  if (modelId.trim()) {
    localStorage.setItem(STORAGE_KEY, modelId.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
