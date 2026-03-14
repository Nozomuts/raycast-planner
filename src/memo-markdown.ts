export const renderMemoMarkdown = (note: string): string => {
  const normalizedNote = note
    .replace(/\r\n?/g, "\n")
    .replace(/^[・•]\s+/gm, "- ")
    .replace(/^☐\s+/gm, "- [ ] ")
    .replace(/^(☑|✅)\s+/gm, "- [x] ")
    .trim();

  return normalizedNote
    ? `# メモ\n\n${normalizedNote}`
    : "# メモ\n\nまだありません";
};

export const normalizeMemoForSave = async (note: string): Promise<string> => {
  const normalizedNote = note.replace(/\r\n?/g, "\n");
  const urls = [
    ...new Set(normalizedNote.match(/https?:\/\/[^\s<>"')\]]+/g) ?? []),
  ];
  if (!urls.length) {
    return normalizedNote;
  }

  const titles = Object.fromEntries(
    await Promise.all(
      urls.map(async (url) => [url, await getLinkTitle(url)] as const),
    ),
  );

  return normalizedNote.replace(
    /https?:\/\/[^\s<>"')\]]+/g,
    (url, offset, source) => {
      const prefix = source.slice(Math.max(0, offset - 2), offset);
      if (prefix === "](") {
        return url;
      }

      return `[${titles[url] ?? fallbackLinkTitle(url)}](${url})`;
    },
  );
};

const getLinkTitle = async (url: string): Promise<string> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("text/html")) {
      return fallbackLinkTitle(url);
    }

    const html = await response.text();
    return (
      extractMetaTitle(html, "property", "og:title") ??
      extractMetaTitle(html, "name", "twitter:title") ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
      fallbackLinkTitle(url)
    );
  } catch {
    return fallbackLinkTitle(url);
  }
};

const extractMetaTitle = (
  html: string,
  attribute: "name" | "property",
  value: string,
): string | undefined =>
  html
    .match(
      new RegExp(
        `<meta[^>]*${attribute}=["']${value}["'][^>]*content=["']([^"']+)["'][^>]*>`,
        "i",
      ),
    )?.[1]
    ?.trim();

const fallbackLinkTitle = (url: string): string => {
  try {
    const parsed = new URL(url);
    const pathLabel = parsed.pathname
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/[-_]+/g, " ");

    return pathLabel ? `${parsed.hostname} / ${pathLabel}` : parsed.hostname;
  } catch {
    return url;
  }
};
