import type { DispositionState } from "./types";

const SUMMARY_MAX_CHARS = 360;

export function cleanTags(tags: string[] | null): string[] {
  return (tags ?? [])
    .map((tag) => cleanText(tag))
    .filter((tag): tag is string => Boolean(tag));
}

export function cleanText(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  const text = decodeHtmlEntities(String(value))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

export function trimSummary(value: string | null): string | null {
  if (!value || value.length <= SUMMARY_MAX_CHARS) {
    return value;
  }

  let trimmed = value.slice(0, SUMMARY_MAX_CHARS - 3).trimEnd();
  if (trimmed.includes(" ")) {
    trimmed = trimmed.slice(0, trimmed.lastIndexOf(" ")).trimEnd();
  }
  return `${trimmed}...`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      decodeCodePoint(Number(codePoint), _)
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) =>
      decodeCodePoint(Number.parseInt(codePoint, 16), _)
    )
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) => {
      const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        nbsp: " "
      };
      return entities[entity] ?? _;
    });
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  return String.fromCodePoint(codePoint);
}

export function formatDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

export function formatShortDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short"
  }).format(date);
}

export function formatDisposition(
  value: Exclude<DispositionState, "none">
): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDispositionAction(
  value: Exclude<DispositionState, "none">
): string {
  const actions: Record<Exclude<DispositionState, "none">, string> = {
    saved: "Save",
    archived: "Archive",
    hidden: "Hide"
  };
  return actions[value];
}

export function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}

export function parseDateValue(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function maxIsoDate(
  current: string | null,
  candidate: string | null
): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return parseDateValue(candidate) > parseDateValue(current) ? candidate : current;
}

export function compareIsoDate(a: string | null, b: string | null): number {
  return parseDateValue(a) - parseDateValue(b);
}

