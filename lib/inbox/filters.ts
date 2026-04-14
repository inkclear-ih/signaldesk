import type { InboxItem, InboxView, ItemFilters, ItemsByView, SearchParams } from "./types";

export function parseFilters(
  searchParams: SearchParams | undefined,
  validSourceIds: Set<string>
): ItemFilters {
  const sourceId = searchParams?.source ?? "";
  return {
    sourceId: validSourceIds.has(sourceId) ? sourceId : "",
    newOnly: searchParams?.new === "1",
    unreviewedOnly: searchParams?.unreviewed === "1"
  };
}

export function hasActiveFilters(filters: ItemFilters): boolean {
  return Boolean(filters.sourceId || filters.newOnly || filters.unreviewedOnly);
}

export function filterItemsByView(
  itemsByView: ItemsByView,
  filters: ItemFilters
): Record<InboxView, InboxItem[]> {
  return {
    inbox: applyItemFilters(itemsByView.inbox, filters),
    saved: applyItemFilters(itemsByView.saved, filters),
    archived: applyItemFilters(itemsByView.archived, filters),
    hidden: applyItemFilters(itemsByView.hidden, filters),
    reviewed: applyItemFilters(itemsByView.reviewed, filters)
  };
}

function applyItemFilters(items: InboxItem[], filters: ItemFilters): InboxItem[] {
  return items.filter((item) => {
    if (filters.sourceId && item.source_id !== filters.sourceId) {
      return false;
    }
    if (filters.newOnly && item.system_state !== "new") {
      return false;
    }
    if (filters.unreviewedOnly && item.review_state !== "unreviewed") {
      return false;
    }
    return true;
  });
}

