import { VIEW_TABS } from "./constants";
import type { InboxView, ItemFilters, ItemSort, SourceSort } from "./types";

export function parseView(value: string | undefined): InboxView {
  return VIEW_TABS.some((tab) => tab.key === value) ? (value as InboxView) : "inbox";
}

export function buildHref({
  filters,
  itemSort,
  sourceSort,
  view
}: {
  filters?: ItemFilters;
  itemSort?: ItemSort;
  sourceSort?: SourceSort;
  view?: InboxView;
}): string {
  const params = new URLSearchParams();
  if (view && view !== "inbox") {
    params.set("view", view);
  }
  if (filters?.sourceId) {
    params.set("source", filters.sourceId);
  }
  if (filters?.newOnly) {
    params.set("new", "1");
  }
  if (filters?.unreviewedOnly) {
    params.set("unreviewed", "1");
  }
  if (itemSort && itemSort.key !== "default") {
    params.set("itemSort", itemSort.key);
    params.set("itemDir", itemSort.direction);
  }
  if (sourceSort) {
    params.set("sourceSort", sourceSort.key);
    params.set("sourceDir", sourceSort.direction);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
