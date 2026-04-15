import { parseDateValue } from "./formatting";
import type { InboxItem, ItemSort, ItemSortKey, SearchParams } from "./types";

export const ITEM_SORT_OPTIONS: Array<{ key: ItemSortKey; label: string }> = [
  { key: "default", label: "Default" },
  { key: "seen", label: "Latest seen" },
  { key: "published", label: "Published date" },
  { key: "source", label: "Source" }
];

export function parseItemSort(searchParams: SearchParams | undefined): ItemSort {
  const key = isItemSortKey(searchParams?.itemSort)
    ? searchParams.itemSort
    : "default";
  const direction =
    key !== "default" && searchParams?.itemDir === "asc" ? "asc" : "desc";

  return { key, direction };
}

export function sortItems(items: InboxItem[], sort: ItemSort): InboxItem[] {
  if (sort.key === "default") {
    return items;
  }

  const multiplier = sort.direction === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    let result = 0;

    if (sort.key === "seen") {
      result = compareNullableDates(a.last_seen_at, b.last_seen_at);
    } else if (sort.key === "published") {
      result = compareNullableDates(a.published_at, b.published_at);
    } else if (sort.key === "source") {
      result = compareSourceThenTitle(a, b);
    }

    return result * multiplier;
  });
}

export function describeItemSort(sort: ItemSort): string {
  if (sort.key === "default") {
    return "Using each view's default order.";
  }

  const option = ITEM_SORT_OPTIONS.find((candidate) => candidate.key === sort.key);
  const label = option?.label.toLowerCase() ?? "selected sort";
  return `Sorted by ${label}, ${sort.direction === "asc" ? "ascending" : "descending"}.`;
}

function isItemSortKey(value: string | undefined): value is ItemSortKey {
  return ITEM_SORT_OPTIONS.some((option) => option.key === value);
}

function compareNullableDates(a: string | null, b: string | null): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }

  return parseDateValue(a) - parseDateValue(b);
}

function compareSourceThenTitle(a: InboxItem, b: InboxItem): number {
  const sourceResult = a.source_name.localeCompare(b.source_name, undefined, {
    numeric: true,
    sensitivity: "base"
  });

  if (sourceResult !== 0) {
    return sourceResult;
  }

  return (a.title ?? "").localeCompare(b.title ?? "", undefined, {
    numeric: true,
    sensitivity: "base"
  });
}
