import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { showToast, Toast } from "@raycast/api";

import { getDayRange } from "./date";
import { extractEventLinks } from "./links";
import { loadCachedEvents, saveCachedEvents } from "./storage";
import type {
  FetchResult,
  GoogleCalendarEvent,
  PlannerPreferences,
} from "./types";

const execFileAsync = promisify(execFile);
const COMMON_BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const COMMON_CERT_FILES = [
  "/etc/ssl/cert.pem",
  "/opt/homebrew/etc/openssl@3/cert.pem",
];

type RawEvent = {
  attendees?: { email?: string }[];
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
  description?: string;
  end?: { date?: string; dateTime?: string };
  htmlLink?: string;
  id?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  status?: string;
  summary?: string;
};

type RawListResponse = {
  items?: RawEvent[];
};

export const fetchCalendarEvents = async (
  preferences: PlannerPreferences,
  targetDate: Date,
  options?: { forceRefresh?: boolean },
): Promise<FetchResult> => {
  const { dayKey, timeMin, timeMax } = getDayRange(targetDate);

  if (!options?.forceRefresh) {
    const cached = loadCachedEvents(preferences.calendarId, dayKey);
    if (cached) {
      return { events: cached.events, source: "cache" };
    }
  }

  const params = {
    calendarId: preferences.calendarId,
    orderBy: "startTime",
    singleEvents: true,
    timeMax,
    timeMin,
  };

  const gwsExecutable = await resolveGwsExecutable(preferences.gwsPath);
  const env = await buildGwsEnv();

  const { stdout, stderr } = await execFileAsync(
    gwsExecutable,
    [
      "calendar",
      "events",
      "list",
      "--params",
      JSON.stringify(params),
      "--format",
      "json",
    ],
    { env },
  );

  if (stderr?.trim()) {
    await showToast({
      style: Toast.Style.Failure,
      title: "gws returned stderr",
      message: stderr.trim(),
    });
  }

  const gwsError = parseGwsError(stdout);
  if (gwsError) {
    throw new Error(gwsError);
  }

  const raw = JSON.parse(stdout) as RawListResponse;
  const events = (raw.items ?? [])
    .map(normalizeEvent)
    .filter((event): event is GoogleCalendarEvent => Boolean(event))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));

  saveCachedEvents(preferences.calendarId, dayKey, events);

  return { events, source: "remote" };
};

const resolveGwsExecutable = async (gwsPath: string): Promise<string> => {
  const candidate = gwsPath.trim() || "gws";
  if (candidate.includes("/")) {
    await ensureExecutable(candidate);
    return candidate;
  }

  const pathEntries = [
    ...new Set([
      ...(process.env.PATH?.split(":").filter(Boolean) ?? []),
      ...COMMON_BIN_DIRS,
    ]),
  ];

  for (const dir of pathEntries) {
    const executable = path.join(dir, candidate);
    try {
      await ensureExecutable(executable);
      return executable;
    } catch {
      // Continue searching known directories until a valid executable is found.
    }
  }

  throw new Error(
    "gws が見つかりません。Extension Preferences の gwsPath に絶対パスを設定してください。",
  );
};

const ensureExecutable = async (executablePath: string) => {
  await access(executablePath, constants.X_OK);
};

const buildGwsEnv = async (): Promise<NodeJS.ProcessEnv> => {
  const env = { ...process.env };
  const mergedPathEntries = [
    ...new Set([
      ...COMMON_BIN_DIRS,
      ...(env.PATH?.split(":").filter(Boolean) ?? []),
    ]),
  ];
  env.PATH = mergedPathEntries.join(":");

  if (env.SSL_CERT_FILE) {
    return env;
  }

  for (const certFile of COMMON_CERT_FILES) {
    try {
      await access(certFile, constants.R_OK);
      env.SSL_CERT_FILE = certFile;
      return env;
    } catch {
      // Try the next certificate bundle.
    }
  }

  return env;
};

const parseGwsError = (stdout: string): string | undefined => {
  try {
    const parsed = JSON.parse(stdout) as {
      error?: {
        code?: number;
        message?: string;
        reason?: string;
      };
    };

    if (!parsed.error?.message) {
      return undefined;
    }

    const code = parsed.error.code ? ` (${parsed.error.code})` : "";
    const reason = parsed.error.reason ? ` [${parsed.error.reason}]` : "";
    return `${parsed.error.message}${code}${reason}`;
  } catch {
    return undefined;
  }
};

export const normalizeEvent = (
  event: RawEvent,
): GoogleCalendarEvent | undefined => {
  const id = event.id;
  if (!id) {
    return undefined;
  }

  const start = event.start?.dateTime ?? event.start?.date;
  const end = event.end?.dateTime ?? event.end?.date;
  if (!start || !end) {
    return undefined;
  }

  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  const conferenceUrl = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video",
  )?.uri;

  return {
    attendees: (event.attendees ?? []).flatMap((attendee) =>
      attendee.email ? [attendee.email] : [],
    ),
    conferenceUrl,
    description: event.description,
    end,
    htmlLink: event.htmlLink,
    id,
    isAllDay,
    links: extractEventLinks({
      conferenceUrl,
      description: event.description,
      htmlLink: event.htmlLink,
      location: event.location,
    }),
    location: event.location,
    source: "google",
    start,
    status: event.status,
    summary: event.summary ?? "(No title)",
  };
};
