import type { EventLink } from "./types";

const URL_PATTERN = /https?:\/\/[^\s<>"')]+/g;
const OVICE_PATTERN = /https?:\/\/[^\s<>"')]*ovice\.[^\s<>"')]+/i;

export const extractEventLinks = (input: {
  conferenceUrl?: string;
  description?: string;
  htmlLink?: string;
  location?: string;
}): EventLink[] => {
  const links: EventLink[] = [];
  const seen = new Set<string>();

  const text = `${input.description ?? ""}\n${input.location ?? ""}`;
  const urls = Array.from(text.matchAll(URL_PATTERN), (match) => match[0]);
  const oviceUrl = urls.find((url) => OVICE_PATTERN.test(url));

  if (oviceUrl) {
    pushLink(links, seen, {
      label: "Open ovice",
      type: "ovice",
      url: oviceUrl,
    });
  }

  if (input.conferenceUrl) {
    pushLink(links, seen, {
      label: "Open Google Meet",
      type: "meet",
      url: input.conferenceUrl,
    });
  }

  if (input.htmlLink) {
    pushLink(links, seen, {
      label: "Open in Google Calendar",
      type: "calendar",
      url: input.htmlLink,
    });
  }

  return links;
};

export const getPreferredJoinLink = (
  links: EventLink[],
): EventLink | undefined => {
  return (
    links.find((link) => link.type === "ovice") ??
    links.find((link) => link.type === "meet") ??
    links.find((link) => link.type === "join")
  );
};

export const buildManualJoinLinks = (url: string): EventLink[] => {
  const trimmed = url.trim();
  if (!trimmed) {
    return [];
  }

  if (OVICE_PATTERN.test(trimmed)) {
    return [{ label: "Open ovice", type: "ovice", url: trimmed }];
  }

  if (trimmed.includes("meet.google.com")) {
    return [{ label: "Open Google Meet", type: "meet", url: trimmed }];
  }

  return [{ label: "Open Link", type: "join", url: trimmed }];
};

const pushLink = (links: EventLink[], seen: Set<string>, link: EventLink) => {
  if (seen.has(link.url)) {
    return;
  }

  seen.add(link.url);
  links.push(link);
};
