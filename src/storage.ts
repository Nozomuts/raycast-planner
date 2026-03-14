import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const LOCAL_EVENTS_FILE = "events.md";
const OVERLAYS_KEY = "planner.overlays.v1";
const PLANNER_DATA_FILE = "planner.md";
const SHARED_NOTE_HISTORY_KEY = "planner.shared-note-history.v1";
const SHARED_NOTE_KEY = "planner.shared-note.v1";
const SHARED_NOTES_FILE = "memo.md";
const cache = new Cache();

type CachedEventsMeta = {
  cachedAt: string;
  calendarId: string;
  dayKey: string;
};

type PlannerData = {
  events: LocalPlannerEvent[];
  notes: Record<string, string>;
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
  (await loadPlannerData()).events;

export const saveLocalEvents = async (events: LocalPlannerEvent[]) => {
  const plannerData = await loadPlannerData();
  await savePlannerData({ ...plannerData, events });
};

export const loadSharedNote = async (dayKey: string): Promise<string> =>
  (await loadPlannerData()).notes[dayKey] ?? "";

export const saveSharedNote = async (dayKey: string, note: string) => {
  const plannerData = await loadPlannerData();
  const notes = { ...plannerData.notes };
  if (note.trim()) {
    notes[dayKey] = note;
  } else {
    delete notes[dayKey];
  }

  await savePlannerData({ ...plannerData, notes });
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

export const ensurePlannerDataFile = async (): Promise<string> => {
  const plannerData = await loadPlannerData();
  await savePlannerData(plannerData);
  return path.join(environment.supportPath, PLANNER_DATA_FILE);
};

const loadJson = async <T>(key: string, fallback: T): Promise<T> => {
  const value = await LocalStorage.getItem<string>(key);
  return safeParse(value, fallback);
};

const saveJson = async (key: string, value: unknown) => {
  await LocalStorage.setItem(key, JSON.stringify(value));
};

const loadPlannerData = async (): Promise<PlannerData> => {
  const filePath = path.join(environment.supportPath, PLANNER_DATA_FILE);

  try {
    return parsePlannerDataMarkdown(await readFile(filePath, "utf8"));
  } catch {
    const plannerData = {
      events: await loadLegacyLocalEvents(),
      notes: await loadLegacyNotes(),
    };

    if (!plannerData.events.length && !Object.keys(plannerData.notes).length) {
      return plannerData;
    }

    await savePlannerData(plannerData);
    await Promise.all([
      LocalStorage.removeItem(LOCAL_EVENTS_KEY),
      LocalStorage.removeItem(SHARED_NOTE_KEY),
      rm(path.join(environment.supportPath, LOCAL_EVENTS_FILE), {
        force: true,
      }),
      rm(path.join(environment.supportPath, SHARED_NOTES_FILE), {
        force: true,
      }),
    ]);
    return plannerData;
  }
};

const savePlannerData = async (plannerData: PlannerData) => {
  await mkdir(environment.supportPath, { recursive: true });
  await writeFile(
    path.join(environment.supportPath, PLANNER_DATA_FILE),
    stringifyPlannerDataMarkdown(plannerData),
    "utf8",
  );
};

const loadLegacyNotes = async (): Promise<Record<string, string>> => {
  try {
    return parseSharedNotes(
      await readFile(
        path.join(environment.supportPath, SHARED_NOTES_FILE),
        "utf8",
      ),
    );
  } catch {
    const legacyNote = await LocalStorage.getItem<string>(SHARED_NOTE_KEY);
    return legacyNote?.trim()
      ? { [getDayRange(new Date()).dayKey]: legacyNote }
      : {};
  }
};

const loadLegacyLocalEvents = async (): Promise<LocalPlannerEvent[]> => {
  try {
    return parseLocalEventsMarkdown(
      await readFile(
        path.join(environment.supportPath, LOCAL_EVENTS_FILE),
        "utf8",
      ),
    );
  } catch {
    return await loadJson(LOCAL_EVENTS_KEY, [] as LocalPlannerEvent[]);
  }
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

const parsePlannerDataMarkdown = (markdown: string): PlannerData => {
  const notes: Record<string, string> = {};
  const events: LocalPlannerEvent[] = [];
  let currentKey = "";
  let currentSection = "";
  let buffer: string[] = [];

  const flush = () => {
    if (!currentKey) {
      return;
    }

    if (currentSection === "notes") {
      notes[currentKey] = buffer.join("\n").trim();
      currentKey = "";
      buffer = [];
      return;
    }

    const rawEvent = buffer.join("\n").match(/^```json\n([\s\S]*?)\n```$/)?.[1];
    if (rawEvent) {
      try {
        const event = JSON.parse(rawEvent) as LocalPlannerEvent;
        if (event.id === currentKey) {
          events.push(event);
        }
      } catch {
        // Ignore broken blocks and keep loading the rest.
      }
    }

    currentKey = "";
    buffer = [];
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (line === "## Notes") {
      flush();
      currentSection = "notes";
      continue;
    }

    if (line === "## Events") {
      flush();
      currentSection = "events";
      continue;
    }

    const noteDayKey =
      currentSection === "notes"
        ? line.match(/^### (\d{4}-\d{2}-\d{2})$/)?.[1]
        : undefined;
    if (noteDayKey) {
      flush();
      currentKey = noteDayKey;
      continue;
    }

    const eventId =
      currentSection === "events"
        ? line.match(/^### (local:[^\n]+)$/)?.[1]
        : undefined;
    if (eventId) {
      flush();
      currentKey = eventId;
      continue;
    }

    if (currentKey) {
      buffer.push(line);
    }
  }

  flush();
  return { events, notes };
};

const parseLocalEventsMarkdown = (markdown: string): LocalPlannerEvent[] => {
  const events: LocalPlannerEvent[] = [];
  const blocks = markdown.matchAll(
    /^## (local:[^\n]+)\n```json\n([\s\S]*?)\n```\n?/gm,
  );

  for (const [, id, rawEvent] of blocks) {
    try {
      const event = JSON.parse(rawEvent) as LocalPlannerEvent;
      if (event.id === id) {
        events.push(event);
      }
    } catch {
      // Ignore broken blocks and keep loading the rest.
    }
  }

  return events;
};

const stringifyPlannerDataMarkdown = ({
  events,
  notes,
}: PlannerData): string => {
  const noteSections = Object.entries(notes)
    .filter(([, note]) => note.trim())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dayKey, note]) => `### ${dayKey}\n${note.trim()}`);
  const eventSections = [...events]
    .sort((left, right) =>
      (left.createdAt ?? left.start).localeCompare(
        right.createdAt ?? right.start,
      ),
    )
    .map(
      (event) =>
        `### ${event.id}\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``,
    );

  return [
    "# Planner Data",
    "",
    "## Notes",
    "",
    ...(noteSections.length ? noteSections : [""]),
    "",
    "## Events",
    "",
    ...(eventSections.length ? eventSections : [""]),
    "",
  ].join("\n");
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
