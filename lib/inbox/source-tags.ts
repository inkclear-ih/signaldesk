import type { SourceTag, SourceTagColor } from "./types";

export const SOURCE_TAG_PALETTE: Array<{
  value: SourceTagColor;
  label: string;
}> = [
  { value: "slate", label: "Slate" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "purple", label: "Purple" },
  { value: "teal", label: "Teal" },
  { value: "orange", label: "Orange" }
];

export function isSourceTagColor(value: string): value is SourceTagColor {
  return SOURCE_TAG_PALETTE.some((option) => option.value === value);
}

export function normalizeSourceTagName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function cleanSourceTags(value: unknown): SourceTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const tags: SourceTag[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawTag = entry as {
      id?: unknown;
      name?: unknown;
      color?: unknown;
    };
    const id = typeof rawTag.id === "string" ? rawTag.id.trim() : "";
    const name =
      typeof rawTag.name === "string"
        ? normalizeSourceTagName(rawTag.name)
        : "";
    const color =
      typeof rawTag.color === "string" && isSourceTagColor(rawTag.color)
        ? rawTag.color
        : null;

    if (!id || !name || !color || seen.has(id)) {
      continue;
    }

    seen.add(id);
    tags.push({ id, name, color });
  }

  return tags;
}

export function matchesAllSourceTags(
  sourceTags: SourceTag[],
  selectedTagIds: string[]
): boolean {
  if (!selectedTagIds.length) {
    return true;
  }

  const assignedTagIds = new Set(sourceTags.map((tag) => tag.id));
  return selectedTagIds.every((tagId) => assignedTagIds.has(tagId));
}
