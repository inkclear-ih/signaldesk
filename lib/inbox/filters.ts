import { matchesAllSourceTags } from "./source-tags";
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
  validSourceTagIds: Set<string>
): ItemFilters {
  const sourceId = searchParams?.source ?? "";
  const sourceTagIds = getSearchParamArray(searchParams?.sourceTag).filter((tagId) =>
    validSourceTagIds.has(tagId)
  );

  return {
    sourceId: validSourceIds.has(sourceId) ? sourceId : "",
    sourceTagIds: [...new Set(sourceTagIds)],
    newOnly: searchParams?.new === "1",
    unreviewedOnly: searchParams?.unreviewed === "1"
  };
}

export function hasActiveFilters(filters: ItemFilters): boolean {
  return Boolean(
    filters.sourceId ||
      filters.sourceTagIds.length ||
      filters.newOnly ||
      filters.unreviewedOnly
  );
}

export function filterItemsByView(
  itemsByView: ItemsByView,
  filters: ItemFilters,
  sourceTagsBySourceId: Map<string, SourceTag[]>
): Record<InboxView, InboxItem[]> {
  return {
    inbox: applyItemFilters(itemsByView.inbox, filters, sourceTagsBySourceId),
    saved: applyItemFilters(itemsByView.saved, filters, sourceTagsBySourceId),
    archived: applyItemFilters(itemsByView.archived, filters, sourceTagsBySourceId),
    hidden: applyItemFilters(itemsByView.hidden, filters, sourceTagsBySourceId),
    reviewed: applyItemFilters(itemsByView.reviewed, filters, sourceTagsBySourceId)
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
  filters: ItemFilters,
  sourceTagsBySourceId: Map<string, SourceTag[]>
): InboxItem[] {
  return items.filter((item) => {
    if (
      !matchesSourceFilters(
        item.source_id,
        sourceTagsBySourceId.get(item.source_id) ?? [],
        filters
      )
    ) {
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
  value: SearchParams["sourceTag"]
): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return typeof value === "string" && value ? [value] : [];
}
