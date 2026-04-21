import { matchesAllSourceTags } from "./source-tags";
import { matchesAllItemTags } from "./item-tags";
import type {
  InboxItem,
  InboxView,
  ItemFilters,
  ItemsByView,
  SearchParams,
  SourceMetric,
  SourceTag,
  UserSource
} from "./types";

export function parseFilters(
  searchParams: SearchParams | undefined,
  validSourceIds: Set<string>,
  validSourceTagIds: Set<string>,
  validItemTagIds: Set<string>
): ItemFilters {
  const sourceId = searchParams?.source ?? "";
  const sourceTagIds = getSearchParamArray(searchParams?.sourceTag).filter((tagId) =>
    validSourceTagIds.has(tagId)
  );
  const itemTagIds = getSearchParamArray(searchParams?.itemTag).filter((tagId) =>
    validItemTagIds.has(tagId)
  );

  return {
    sourceId: validSourceIds.has(sourceId) ? sourceId : "",
    sourceTagIds: [...new Set(sourceTagIds)],
    itemTagIds: [...new Set(itemTagIds)],
    newOnly: searchParams?.new === "1",
    unreviewedOnly: searchParams?.unreviewed === "1"
  };
}

export function hasActiveFilters(filters: ItemFilters): boolean {
  return Boolean(
    filters.sourceId ||
      filters.sourceTagIds.length ||
      filters.itemTagIds.length ||
      filters.newOnly ||
      filters.unreviewedOnly
  );
}

export function hasActiveItemFilters(filters: ItemFilters): boolean {
  return Boolean(
    filters.sourceId ||
      filters.itemTagIds.length ||
      filters.newOnly ||
      filters.unreviewedOnly
  );
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

export function filterSourceMetrics(
  metrics: SourceMetric[],
  filters: ItemFilters
): SourceMetric[] {
  return metrics.filter((metric) =>
    matchesSourceFilters(metric.source.source_id, metric.tags, filters)
  );
}

export function filterUserSources(
  sources: UserSource[],
  filters: ItemFilters
): UserSource[] {
  return sources.filter((source) =>
    matchesSourceFilters(source.source_id, source.source_tags, filters)
  );
}

function applyItemFilters(
  items: InboxItem[],
  filters: ItemFilters
): InboxItem[] {
  return items.filter((item) => {
    if (filters.sourceId && item.source_id !== filters.sourceId) {
      return false;
    }
    if (!matchesAllItemTags(item.item_tags, filters.itemTagIds)) {
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

function matchesSourceFilters(
  sourceId: string,
  sourceTags: SourceTag[],
  filters: ItemFilters
): boolean {
  if (filters.sourceId && sourceId !== filters.sourceId) {
    return false;
  }

  if (!matchesAllSourceTags(sourceTags, filters.sourceTagIds)) {
    return false;
  }

  return true;
}

function getSearchParamArray(
  value: SearchParams["sourceTag"] | SearchParams["itemTag"]
): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return typeof value === "string" && value ? [value] : [];
}
