import { SOURCE_TAG_PALETTE } from "./source-tags";
import type { ItemTag, ItemTagColor } from "./types";

export const ITEM_TAG_PALETTE = SOURCE_TAG_PALETTE;

export function isItemTagColor(value: string): value is ItemTagColor {
  return ITEM_TAG_PALETTE.some((option) => option.value === value);
}

export function normalizeItemTagName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function cleanItemTags(value: unknown): ItemTag[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const tags: ItemTag[] = [];

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
        ? normalizeItemTagName(rawTag.name)
        : "";
    const color =
      typeof rawTag.color === "string" && isItemTagColor(rawTag.color)
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
