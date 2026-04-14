import { compareIsoDate } from "./formatting";
import type { SearchParams, SourceMetric, SourceSort, SourceSortKey } from "./types";

export const SOURCE_COLUMNS: Array<{
  key: SourceSortKey;
  label: string;
  className?: string;
}> = [
  { key: "source", label: "Source" },
  { key: "new", label: "New", className: "source-number" },
  { key: "attention", label: "Open", className: "source-number" },
  { key: "snapshot", label: "Items", className: "source-number" },
  { key: "fetched", label: "Fetched", className: "source-number" },
  { key: "latest", label: "Latest item" },
  { key: "freshness", label: "Fetched at" }
];

export function parseSourceSort(searchParams: SearchParams | undefined): SourceSort {
  const key = isSourceSortKey(searchParams?.sourceSort)
    ? searchParams.sourceSort
    : "new";
  const direction = searchParams?.sourceDir === "asc" ? "asc" : "desc";
  return { key, direction };
}

export function nextSourceSort(current: SourceSort, key: SourceSortKey): SourceSort {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc"
    };
  }

  return {
    key,
    direction: key === "source" ? "asc" : "desc"
  };
}

export function sortSourceMetrics(
  metrics: SourceMetric[],
  sort: SourceSort
): SourceMetric[] {
  const multiplier = sort.direction === "asc" ? 1 : -1;

  return [...metrics].sort((a, b) => {
    let result = 0;
    if (sort.key === "source") {
      result = compareSourceNames(a, b);
    } else if (sort.key === "new") {
      result = a.newCount - b.newCount;
    } else if (sort.key === "attention") {
      result = a.attentionCount - b.attentionCount;
    } else if (sort.key === "snapshot") {
      result = a.snapshotCount - b.snapshotCount;
    } else if (sort.key === "fetched") {
      result = (a.fetchedCount ?? -1) - (b.fetchedCount ?? -1);
    } else if (sort.key === "latest") {
      result = compareIsoDate(a.latestItemAt, b.latestItemAt);
    } else if (sort.key === "freshness") {
      result = a.freshness.timestamp - b.freshness.timestamp;
    }

    if (result === 0) {
      return compareSourceNames(a, b);
    }

    return result * multiplier;
  });
}

export function summarizeSources(metrics: SourceMetric[]) {
  return {
    sourcesWithNew: metrics.filter((metric) => metric.newCount > 0).length,
    staleSources: metrics.filter(
      (metric) =>
        metric.freshness.state === "stale" || metric.freshness.state === "never"
    ).length,
    sourcesWithErrors: metrics.filter(
      (metric) =>
        metric.latestRunStatus === "error" ||
        Boolean(metric.source.last_error) ||
        Boolean(metric.latestRunError)
    ).length
  };
}

function isSourceSortKey(value: string | undefined): value is SourceSortKey {
  return SOURCE_COLUMNS.some((column) => column.key === value);
}

function compareSourceNames(a: SourceMetric, b: SourceMetric): number {
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

