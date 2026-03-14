import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cache, environment, LocalStorage } from "@raycast/api";
import { getDayRange } from "./date";
import type {
  AutoOpenExecutionState,
  GoogleCalendarEvent,
  LocalPlannerEvent,
  PlannerOverlay,
  SharedNoteHistoryEntry,
} from "./types";

const AUTO_OPEN_STATE_KEY = "planner.auto-open-state.v1";
const EVENTS_CACHE_KEY = "planner.cached-events.v1";
const EVENTS_CACHE_META_KEY = "planner.cached-events-meta.v1";
const LOCAL_EVENTS_KEY = "planner.local-events.v1";
const OVERLAYS_KEY = "planner.overlays.v1";
const SHARED_NOTE_HISTORY_KEY = "planner.shared-note-history.v1";
const SHARED_NOTE_KEY = "planner.shared-note.v1";
const SHARED_NOTES_FILE = "memo.md";
const cache = new Cache();

type CachedEventsMeta = {
  cachedAt: string;
  calendarId: string;
  dayKey: string;
};

export const loadOverlayMap = async (): Promise<
  Record<string, PlannerOverlay>
> => loadJson(OVERLAYS_KEY, {});

export const saveOverlayMap = async (
  overlayMap: Record<string, PlannerOverlay>,
) => saveJson(OVERLAYS_KEY, overlayMap);

export const loadAutoOpenState = async (): Promise<AutoOpenExecutionState> =>
  loadJson(AUTO_OPEN_STATE_KEY, {});

export const saveAutoOpenState = async (state: AutoOpenExecutionState) =>
  saveJson(AUTO_OPEN_STATE_KEY, state);

export const loadLocalEvents = async (): Promise<LocalPlannerEvent[]> =>
  loadJson(LOCAL_EVENTS_KEY, []);

export const saveLocalEvents = async (events: LocalPlannerEvent[]) =>
  saveJson(LOCAL_EVENTS_KEY, events);

export const loadSharedNote = async (dayKey: string): Promise<string> =>
  (await loadSharedNotes())[dayKey] ?? "";

export const saveSharedNote = async (dayKey: string, note: string) => {
  const notes = await loadSharedNotes();
  if (note.trim()) {
    notes[dayKey] = note;
  } else {
    delete notes[dayKey];
  }

  await saveSharedNotes(notes);
};

export const loadSharedNoteHistory = async (): Promise<
  SharedNoteHistoryEntry[]
> => loadJson(SHARED_NOTE_HISTORY_KEY, []);

export const appendSharedNoteHistory = async (
  entry: SharedNoteHistoryEntry,
) => {
  const history = await loadSharedNoteHistory();
  const next = [entry, ...history].slice(0, 200);
  await saveJson(SHARED_NOTE_HISTORY_KEY, next);
};

export const loadCachedEvents = (
  calendarId: string,
  dayKey: string,
): { cachedAt?: string; events: GoogleCalendarEvent[] } | undefined => {
  const rawMeta = cache.get(EVENTS_CACHE_META_KEY);
  const rawEvents = cache.get(EVENTS_CACHE_KEY);

  if (!rawMeta || !rawEvents) {
    return undefined;
  }

  const meta = safeParse<CachedEventsMeta | undefined>(rawMeta, undefined);
  if (!meta || meta.calendarId !== calendarId || meta.dayKey !== dayKey) {
    return undefined;
  }

  const events = safeParse<GoogleCalendarEvent[] | undefined>(
    rawEvents,
    undefined,
  );
  if (!events) {
    return undefined;
  }

  return { events, cachedAt: meta.cachedAt };
};

export const saveCachedEvents = (
  calendarId: string,
  dayKey: string,
  events: GoogleCalendarEvent[],
) => {
  cache.set(
    EVENTS_CACHE_META_KEY,
    JSON.stringify({
      cachedAt: new Date().toISOString(),
      calendarId,
      dayKey,
    } satisfies CachedEventsMeta),
  );
  cache.set(EVENTS_CACHE_KEY, JSON.stringify(events));
};

export const clearCachedEvents = () => {
  cache.remove(EVENTS_CACHE_KEY);
  cache.remove(EVENTS_CACHE_META_KEY);
};

const loadJson = async <T>(key: string, fallback: T): Promise<T> => {
  const value = await LocalStorage.getItem<string>(key);
  return safeParse(value, fallback);
};

const saveJson = async (key: string, value: unknown) => {
  await LocalStorage.setItem(key, JSON.stringify(value));
};

const loadSharedNotes = async (): Promise<Record<string, string>> => {
  const filePath = path.join(environment.supportPath, SHARED_NOTES_FILE);

  try {
    return parseSharedNotes(await readFile(filePath, "utf8"));
  } catch {
    const legacyNote = await LocalStorage.getItem<string>(SHARED_NOTE_KEY);
    if (!legacyNote?.trim()) {
      return {};
    }

    const migratedNotes = {
      [getDayRange(new Date()).dayKey]: legacyNote,
    };
    await saveSharedNotes(migratedNotes);
    await LocalStorage.removeItem(SHARED_NOTE_KEY);
    return migratedNotes;
  }
};

const saveSharedNotes = async (notes: Record<string, string>) => {
  await mkdir(environment.supportPath, { recursive: true });
  await writeFile(
    path.join(environment.supportPath, SHARED_NOTES_FILE),
    stringifySharedNotes(notes),
    "utf8",
  );
};

const parseSharedNotes = (markdown: string): Record<string, string> => {
  const notes: Record<string, string> = {};
  let currentDayKey = "";
  let buffer: string[] = [];

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const matchedDayKey = line.match(/^## (\d{4}-\d{2}-\d{2})$/)?.[1];
    if (matchedDayKey) {
      if (currentDayKey) {
        notes[currentDayKey] = buffer.join("\n").trim();
      }

      currentDayKey = matchedDayKey;
      buffer = [];
      continue;
    }

    if (currentDayKey) {
      buffer.push(line);
    }
  }

  if (currentDayKey) {
    notes[currentDayKey] = buffer.join("\n").trim();
  }

  return notes;
};

const stringifySharedNotes = (notes: Record<string, string>): string => {
  const sections = Object.entries(notes)
    .filter(([, note]) => note.trim())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dayKey, note]) => `## ${dayKey}\n${note.trim()}`);

  return sections.length
    ? `# Planner Memo\n\n${sections.join("\n\n")}\n`
    : "# Planner Memo\n";
};

const safeParse = <T>(value: string | undefined, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
