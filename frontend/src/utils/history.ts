import type { Meeting } from "../types";

export interface HistoryEntry {
  meeting: Meeting;
  summary: string | null;
  savedAt: string;
}

const STORAGE_KEY = "brainstormer_history";
const MAX_ENTRIES = 50;

function loadAll(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveAll(entries: HistoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function getHistory(): HistoryEntry[] {
  return loadAll();
}

export function saveMeeting(meeting: Meeting, summary: string | null) {
  const entries = loadAll();
  // Update existing or add new
  const idx = entries.findIndex((e) => e.meeting.id === meeting.id);
  const entry: HistoryEntry = {
    meeting,
    summary,
    savedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.unshift(entry);
  }
  // Keep only the most recent entries
  saveAll(entries.slice(0, MAX_ENTRIES));
}

export function deleteFromHistory(meetingId: string) {
  const entries = loadAll().filter((e) => e.meeting.id !== meetingId);
  saveAll(entries);
}
