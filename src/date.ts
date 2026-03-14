const TOKYO_LOCALE = "ja-JP";

export const getDayRange = (
  targetDate: Date,
): {
  dayKey: string;
  label: string;
  timeMax: string;
  timeMin: string;
} => {
  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    dayKey: `${start.getFullYear()}-${`${start.getMonth() + 1}`.padStart(2, "0")}-${`${start.getDate()}`.padStart(2, "0")}`,
    label: formatDate(start),
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  };
};

export const shiftDate = (base: Date, deltaDays: number): Date => {
  const next = new Date(base);
  next.setDate(next.getDate() + deltaDays);
  return next;
};

export const isToday = (targetDate: Date): boolean => {
  const today = new Date();
  return getDayRange(today).dayKey === getDayRange(targetDate).dayKey;
};

export const formatEventTime = (
  startIso: string,
  endIso: string,
  isAllDay: boolean,
  anytime = false,
): string => {
  if (anytime) {
    return "日時指定なし";
  }

  const isMultiDay =
    getDayRange(new Date(startIso)).dayKey !==
    getDayRange(new Date(endIso)).dayKey;

  if (isAllDay) {
    return isMultiDay
      ? `${formatDateOnlyLabel(startIso)} - ${formatDateOnlyLabel(endIso)} 終日`
      : `${formatDateOnlyLabel(startIso)} 終日`;
  }

  if (isMultiDay) {
    return `${formatDateTime(new Date(startIso))} - ${formatDateTime(new Date(endIso))}`;
  }

  return `${formatClock(new Date(startIso))} - ${formatClock(new Date(endIso))}`;
};

export const formatDateTimeLabel = (iso: string, isAllDay: boolean): string => {
  if (isAllDay) {
    return formatDate(new Date(iso));
  }

  return `${formatDate(new Date(iso))} ${formatClock(new Date(iso))}`;
};

export const formatDateOnlyLabel = (iso: string): string =>
  formatDate(new Date(iso));

export const isEventPast = (event: { end: string }): boolean =>
  Date.parse(event.end) <= Date.now();

export const isLocalAllDayEvent = (event: {
  anytime?: boolean;
  end: string;
  isAllDay: boolean;
  source?: string;
  start: string;
}): boolean => {
  if (event.source !== "local" || event.anytime) {
    return false;
  }

  if (event.isAllDay) {
    return true;
  }

  const start = new Date(event.start);
  const end = new Date(event.end);
  return (
    isMidnight(start) && isMidnight(end) && end.getTime() >= start.getTime()
  );
};

export const getLocalAllDayDisplayEnd = (iso: string): number => {
  const end = new Date(iso);
  end.setDate(end.getDate() + 1);
  return end.getTime();
};

export const getRoundedFutureTime = (base = new Date()): Date => {
  const next = new Date(base);
  if (
    next.getMinutes() > 0 ||
    next.getSeconds() > 0 ||
    next.getMilliseconds() > 0
  ) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }

  next.setMinutes(0, 0, 0);
  return next;
};

const formatClock = (date: Date): string => {
  return new Intl.DateTimeFormat(TOKYO_LOCALE, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date);
};

const formatDateTime = (date: Date): string =>
  `${formatDate(date)} ${formatClock(date)}`;

const isMidnight = (date: Date): boolean =>
  date.getHours() === 0 &&
  date.getMinutes() === 0 &&
  date.getSeconds() === 0 &&
  date.getMilliseconds() === 0;

const formatDate = (date: Date): string => {
  return new Intl.DateTimeFormat(TOKYO_LOCALE, {
    day: "numeric",
    month: "numeric",
    weekday: "short",
  }).format(date);
};
