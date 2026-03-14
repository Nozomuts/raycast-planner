import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Cache, environment, LocalStorage } from "@raycast/api";

import { formatEventTime, getDayRange } from "./date";
import { mergeEventsWithOverlay } from "./planner";
import type {
  AutoOpenExecutionState,
  EventLink,
  GoogleCalendarEvent,
  LocalPlannerEvent,
  PlannerOverlay,
  SharedNoteHistoryEntry,
} from "./types";

const AUTO_OPEN_STATE_KEY = "planner.auto-open-state.v1";
const EVENTS_CACHE_KEY = "planner.cached-events.v1";
const EVENTS_CACHE_META_KEY = "planner.cached-events-meta.v1";
const FETCHED_GOOGLE_EVENTS_KEY = "planner.google-events-by-day.v1";
const LOCAL_EVENTS_KEY = "planner.local-events.v1";
const LOCAL_EVENTS_FILE = "events.md";
const NOTE_SECTION_END = "<!-- planner-note-end -->";
const NOTE_SECTION_START = "<!-- planner-note-start -->";
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

type GoogleEventsByDay = Record<string, GoogleCalendarEvent[]>;

export const loadOverlayMap = async (): Promise<
  Record<string, PlannerOverlay>
> => loadJson(OVERLAYS_KEY, {});

export const saveOverlayMap = async (
  overlayMap: Record<string, PlannerOverlay>,
) => {
  await saveJson(OVERLAYS_KEY, overlayMap);
  await rewritePlannerFile(undefined, overlayMap);
};

export const loadAutoOpenState = async (): Promise<AutoOpenExecutionState> =>
  loadJson(AUTO_OPEN_STATE_KEY, {});

export const saveAutoOpenState = async (state: AutoOpenExecutionState) =>
  saveJson(AUTO_OPEN_STATE_KEY, state);

export const loadLocalEvents = async (): Promise<LocalPlannerEvent[]> =>
  (await loadPlannerData()).events;

export const saveLocalEvents = async (events: LocalPlannerEvent[]) => {
  const plannerData = await loadPlannerData();
  await rewritePlannerFile({ ...plannerData, events });
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

  await rewritePlannerFile({ ...plannerData, notes });
};

export const loadSharedNoteHistory = async (): Promise<
  SharedNoteHistoryEntry[]
> => loadJson(SHARED_NOTE_HISTORY_KEY, []);

export const appendSharedNoteHistory = async (
  entry: SharedNoteHistoryEntry,
) => {
  const history = await loadSharedNoteHistory();
  await saveJson(SHARED_NOTE_HISTORY_KEY, [entry, ...history].slice(0, 200));
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

export const saveFetchedGoogleEvents = async (
  dayKey: string,
  events: GoogleCalendarEvent[],
) => {
  const googleEventsByDay = await loadJson<GoogleEventsByDay>(
    FETCHED_GOOGLE_EVENTS_KEY,
    {},
  );
  if (events.length) {
    googleEventsByDay[dayKey] = events;
  } else {
    delete googleEventsByDay[dayKey];
  }

  await saveJson(FETCHED_GOOGLE_EVENTS_KEY, googleEventsByDay);
  await rewritePlannerFile(undefined, undefined, googleEventsByDay);
};

export const ensurePlannerDataFile = async (): Promise<string> => {
  await rewritePlannerFile();
  return path.join(environment.supportPath, PLANNER_DATA_FILE);
};

const loadJson = async <T>(key: string, fallback: T): Promise<T> => {
  const value = await LocalStorage.getItem<string>(key);
  return safeParse(value, fallback);
};

const saveJson = async (key: string, value: unknown) => {
  await LocalStorage.setItem(key, JSON.stringify(value));
};

const rewritePlannerFile = async (
  plannerData?: PlannerData,
  overlayMap?: Record<string, PlannerOverlay>,
  googleEventsByDay?: GoogleEventsByDay,
) => {
  const nextPlannerData = plannerData ?? (await loadPlannerData());
  const nextOverlayMap = overlayMap ?? (await loadOverlayMap());
  const nextGoogleEventsByDay =
    googleEventsByDay ??
    (await loadJson<GoogleEventsByDay>(FETCHED_GOOGLE_EVENTS_KEY, {}));

  await mkdir(environment.supportPath, { recursive: true });
  await writeFile(
    path.join(environment.supportPath, PLANNER_DATA_FILE),
    renderPlannerMarkdown(
      nextPlannerData,
      nextGoogleEventsByDay,
      nextOverlayMap,
    ),
    "utf8",
  );
};

const loadPlannerData = async (): Promise<PlannerData> => {
  const filePath = path.join(environment.supportPath, PLANNER_DATA_FILE);

  try {
    const markdown = await readFile(filePath, "utf8");
    return parsePlannerMarkdown(markdown);
  } catch {
    const plannerData = await loadLegacyPlannerData();

    if (!plannerData.events.length && !Object.keys(plannerData.notes).length) {
      return plannerData;
    }

    await rewritePlannerFile(plannerData);
    await removeLegacyPlannerData();
    return plannerData;
  }
};

const loadLegacyPlannerData = async (): Promise<PlannerData> => {
  const filePath = path.join(environment.supportPath, PLANNER_DATA_FILE);

  try {
    return parseLegacyPlannerMarkdown(await readFile(filePath, "utf8"));
  } catch {
    return {
      events: await loadLegacyLocalEvents(),
      notes: await loadLegacyNotes(),
    };
  }
};

const removeLegacyPlannerData = async () => {
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

const parsePlannerMarkdown = (markdown: string): PlannerData => {
  const normalized = normalizeNewlines(markdown);
  const notes = Object.fromEntries(
    Array.from(normalized.matchAll(daySectionPattern())).flatMap(
      ([, dayKey, section]) => {
        const note = section.match(noteSectionPattern())?.[1]?.trim();
        return note ? [[dayKey, note]] : [];
      },
    ),
  );
  const eventMap = new Map<string, LocalPlannerEvent>();

  for (const [, payload] of normalized.matchAll(localEventCommentPattern())) {
    try {
      const event = JSON.parse(
        decodeURIComponent(payload),
      ) as LocalPlannerEvent;
      if (event.id.startsWith("local:")) {
        eventMap.set(event.id, event);
      }
    } catch {
      // Ignore broken local event comments and keep loading the rest.
    }
  }

  if (Object.keys(notes).length || eventMap.size) {
    return { events: [...eventMap.values()], notes };
  }

  return parseLegacyPlannerMarkdown(markdown);
};

const parseLegacyPlannerMarkdown = (markdown: string): PlannerData => {
  const normalized = normalizeNewlines(markdown);
  if (!normalized.includes("## Notes") && !normalized.includes("## Events")) {
    return { events: [], notes: {} };
  }

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

  for (const line of normalized.split("\n")) {
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

const parseSharedNotes = (markdown: string): Record<string, string> => {
  const notes: Record<string, string> = {};
  let currentDayKey = "";
  let buffer: string[] = [];

  for (const line of normalizeNewlines(markdown).split("\n")) {
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

const parseLocalEventsMarkdown = (markdown: string): LocalPlannerEvent[] => {
  const events: LocalPlannerEvent[] = [];
  const blocks = normalizeNewlines(markdown).matchAll(
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

const renderPlannerMarkdown = (
  plannerData: PlannerData,
  googleEventsByDay: GoogleEventsByDay,
  overlayMap: Record<string, PlannerOverlay>,
): string => {
  const sections = collectPlannerDayKeys(
    plannerData.events,
    plannerData.notes,
    googleEventsByDay,
    overlayMap,
  )
    .map((dayKey) =>
      renderDaySection(
        dayKey,
        plannerData.notes[dayKey] ?? "",
        googleEventsByDay[dayKey] ?? [],
        plannerData.events,
        overlayMap,
      ),
    )
    .filter(Boolean);
  const body = sections.length
    ? sections.join("\n\n")
    : "予定やメモはまだありません。";

  return [
    "# Planner",
    "",
    "このファイルは Planner が自動生成します。",
    "手で編集してもアプリには戻りません。",
    "",
    body,
    "",
  ].join("\n");
};

const collectPlannerDayKeys = (
  localEvents: LocalPlannerEvent[],
  notes: Record<string, string>,
  googleEventsByDay: GoogleEventsByDay,
  overlayMap: Record<string, PlannerOverlay>,
): string[] => {
  const dayKeys = new Set<string>([
    ...Object.keys(notes),
    ...Object.keys(googleEventsByDay),
  ]);

  for (const event of localEvents) {
    const completedDayKey = overlayMap[event.id]?.completedAt
      ? getDayRange(new Date(overlayMap[event.id].completedAt as string)).dayKey
      : undefined;
    const startDayKey = getDayRange(
      new Date(event.anytime ? (event.createdAt ?? event.start) : event.start),
    ).dayKey;
    const endDayKey = event.anytime
      ? (completedDayKey ?? startDayKey)
      : completedDayKey &&
          completedDayKey < getDayRange(new Date(event.end)).dayKey
        ? completedDayKey
        : getDayRange(new Date(event.end)).dayKey;

    for (const dayKey of enumerateDayKeys(startDayKey, endDayKey)) {
      dayKeys.add(dayKey);
    }
  }

  return [...dayKeys].sort();
};

const renderDaySection = (
  dayKey: string,
  note: string,
  googleEvents: GoogleCalendarEvent[],
  localEvents: LocalPlannerEvent[],
  overlayMap: Record<string, PlannerOverlay>,
): string => {
  const visibleLocalEvents = localEvents.filter((event) =>
    isLocalEventVisibleOnDay(event, dayKey),
  );
  const events = mergeEventsWithOverlay(
    googleEvents,
    overlayMap,
    visibleLocalEvents,
    parseDayKey(dayKey),
  );
  const googleSection = events
    .filter((event) => event.source === "google")
    .map((event) => renderEventBlock(event, false))
    .join("\n\n");
  const localSection = events
    .filter((event) => event.source === "local")
    .map((event) => renderEventBlock(event, true))
    .join("\n\n");
  const sections = [
    note.trim()
      ? `### メモ\n${NOTE_SECTION_START}\n${note.trim()}\n${NOTE_SECTION_END}`
      : "",
    googleSection ? `### Google予定\n${googleSection}` : "",
    localSection ? `### ローカル予定\n${localSection}` : "",
  ].filter(Boolean);

  if (!sections.length) {
    return "";
  }

  return `## ${dayKey}\n\n${sections.join("\n\n")}`;
};

const renderEventBlock = (
  event: Awaited<ReturnType<typeof mergeEventsWithOverlay>>[number],
  includeLocalPayload: boolean,
): string => {
  const lines = [
    `#### ${escapeHeading(event.title)}`,
    `- 時間: ${formatEventTime(
      event.start,
      event.end,
      event.isAllDay,
      event.isAnytime,
    )}`,
    `- 種別: ${event.source === "local" ? "ローカル予定" : "Google予定"}`,
    `- 状態: ${event.completed ? "完了" : "予定"}`,
  ];

  if (event.location) {
    lines.push(`- 場所: ${event.location}`);
  }

  const links = formatEventLinks(event.links);
  if (links) {
    lines.push(`- リンク: ${links}`);
  }

  if (event.description?.trim()) {
    lines.push("- 説明:");
    lines.push(indentBlock(event.description.trim()));
  }

  if (includeLocalPayload && event.source === "local") {
    lines.push(`<!-- planner-local-event: ${encodeLocalEvent(event)} -->`);
  }

  return lines.join("\n");
};

const formatEventLinks = (links: EventLink[]): string =>
  links.map((link) => `[${getLinkLabel(link)}](${link.url})`).join(" / ");

const getLinkLabel = (link: EventLink): string => {
  if (link.type === "ovice") {
    return "ovice";
  }

  if (link.type === "meet") {
    return "Google Meet";
  }

  if (link.type === "calendar") {
    return "Google Calendar";
  }

  return link.label;
};

const encodeLocalEvent = (
  event: LocalPlannerEvent & {
    autoOpenJoin?: boolean;
    completed?: boolean;
    hidden?: boolean;
    title: string;
  },
): string =>
  encodeURIComponent(
    JSON.stringify({
      anytime: event.anytime ?? false,
      attendees: event.attendees,
      createdAt: event.createdAt,
      description: event.description,
      end: event.end,
      htmlLink: event.htmlLink,
      id: event.id,
      isAllDay: event.isAllDay,
      links: event.links,
      location: event.location,
      source: "local",
      start: event.start,
      summary: event.summary,
    } satisfies LocalPlannerEvent),
  );

const isLocalEventVisibleOnDay = (
  event: LocalPlannerEvent,
  dayKey: string,
): boolean => {
  if (event.anytime) {
    return (
      dayKey >= getDayRange(new Date(event.createdAt ?? event.start)).dayKey
    );
  }

  return (
    dayKey >= getDayRange(new Date(event.start)).dayKey &&
    dayKey <= getDayRange(new Date(event.end)).dayKey
  );
};

const enumerateDayKeys = (startDayKey: string, endDayKey: string): string[] => {
  if (endDayKey < startDayKey) {
    return [startDayKey];
  }

  const dayKeys: string[] = [];
  const cursor = parseDayKey(startDayKey);
  const end = parseDayKey(endDayKey);

  while (cursor.getTime() <= end.getTime()) {
    dayKeys.push(getDayRange(cursor).dayKey);
    cursor.setDate(cursor.getDate() + 1);
  }

  return dayKeys;
};

const parseDayKey = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const indentBlock = (text: string): string =>
  text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const escapeHeading = (text: string): string => text.replace(/\n+/g, " ");

const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n?/g, "\n");

const daySectionPattern = () =>
  /^## (\d{4}-\d{2}-\d{2}) \([^)]+\)\n([\s\S]*?)(?=^## \d{4}-\d{2}-\d{2} \(|(?![\s\S]))/gm;

const noteSectionPattern = () =>
  new RegExp(
    `### メモ\\n${escapeRegExp(NOTE_SECTION_START)}\\n([\\s\\S]*?)\\n${escapeRegExp(NOTE_SECTION_END)}`,
  );

const localEventCommentPattern = () =>
  /<!-- planner-local-event: ([^\n]+) -->/g;

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
