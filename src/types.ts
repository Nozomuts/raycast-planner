export type LinkType = "calendar" | "join" | "meet" | "ovice" | "url";

export type EventLink = {
  label: string;
  type: LinkType;
  url: string;
};

export type PlannerBaseEvent = {
  anytime?: boolean;
  description?: string;
  end: string;
  id: string;
  isAllDay: boolean;
  location?: string;
  start: string;
  summary: string;
};

export type GoogleCalendarEvent = PlannerBaseEvent & {
  attendees: string[];
  conferenceUrl?: string;
  htmlLink?: string;
  links: EventLink[];
  source: "google";
  status?: string;
};

export type LocalPlannerEvent = PlannerBaseEvent & {
  attendees: string[];
  createdAt?: string;
  htmlLink?: string;
  links: EventLink[];
  source: "local";
};

export type PlannerEvent = GoogleCalendarEvent | LocalPlannerEvent;

export type PlannerOverlay = {
  autoOpenJoin?: boolean;
  completed?: boolean;
  completedAt?: string;
  hidden?: boolean;
  titleOverride?: string;
};

export type PlannerEventViewModel = PlannerEvent & {
  autoOpenJoin: boolean;
  completed: boolean;
  hidden: boolean;
  isAnytime: boolean;
  isPast: boolean;
  joinLink?: EventLink;
  title: string;
};

export type AutoOpenExecutionState = {
  [eventId: string]: string;
};

export type PlannerPreferences = {
  calendarId: string;
  enableCalendarSync: boolean;
  gwsPath: string;
};

export type FetchResult = {
  events: GoogleCalendarEvent[];
  source: "cache" | "local" | "remote";
};

export type SharedNoteHistoryEntry = {
  after: string;
  before: string;
  dayKey: string;
  timestamp: string;
};
