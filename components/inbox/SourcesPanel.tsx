import { Tags } from "./Tags";
import { formatShortDate, formatStatus } from "@/lib/inbox/formatting";
import { buildHref } from "@/lib/inbox/navigation";
import {
  nextSourceSort,
  SOURCE_COLUMNS,
  summarizeSources
} from "@/lib/inbox/source-table";
import type {
  InboxView,
  ItemFilters,
  SourceMetric,
  SourceSort,
  SourceSortKey
} from "@/lib/inbox/types";

export function SourcesPanel({
  activeView,
  filters,
  metrics,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  metrics: SourceMetric[];
  sourceSort: SourceSort;
}) {
  const { sourcesWithNew, staleSources, sourcesWithErrors } =
    summarizeSources(metrics);

  return (
    <section className="panel sources-panel" aria-labelledby="sources-heading">
      <div className="section-header section-header-panel">
        <h2 id="sources-heading">Sources</h2>
        <span className="section-count">({metrics.length})</span>
      </div>

      <div className="source-summary" aria-label="Source summary">
        <span>
          <strong>{sourcesWithNew}</strong> with new
        </span>
        <span>
          <strong>{staleSources}</strong> stale
        </span>
        <span>
          <strong>{sourcesWithErrors}</strong> errors
        </span>
      </div>

      {metrics.length ? (
        <div className="source-table" role="table" aria-label="Source scan table">
          <div className="source-row source-head" role="row">
            {SOURCE_COLUMNS.map((column) => (
              <span className={column.className} role="columnheader" key={column.key}>
                <a
                  className="source-sort-button"
                  href={buildHref({
                    view: activeView,
                    filters,
                    sourceSort: nextSourceSort(sourceSort, column.key)
                  })}
                >
                  {column.label}
                  <SortArrow sourceSort={sourceSort} columnKey={column.key} />
                </a>
              </span>
            ))}
          </div>
          <div className="source-body" role="rowgroup">
            {metrics.map((metric) => (
              <SourceRow
                activeView={activeView}
                filters={filters}
                key={metric.source.user_source_id}
                metric={metric}
                sourceSort={sourceSort}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">No sources seeded for this user yet.</p>
      )}
    </section>
  );
}

function SourceRow({
  activeView,
  filters,
  metric,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  metric: SourceMetric;
  sourceSort: SourceSort;
}) {
  const rowClasses = ["source-row"];
  if (metric.newCount > 0) {
    rowClasses.push("source-row-new");
  }
  if (metric.freshness.state === "stale" || metric.freshness.state === "never") {
    rowClasses.push("source-row-stale");
  }
  if (metric.latestRunStatus === "error" || metric.source.last_error) {
    rowClasses.push("source-row-error");
  }
  const error = metric.latestRunError || metric.source.last_error;

  return (
    <div className={rowClasses.join(" ")} role="row">
      <span className="source-primary" role="cell">
        <a
          className="source-name"
          href={buildHref({
            view: activeView,
            filters: { ...filters, sourceId: metric.source.source_id },
            sourceSort
          })}
          title={metric.source.feed_url}
        >
          {metric.name}
        </a>
        <span className="source-meta">
          <span className={`status status-${metric.status}`}>
            {formatStatus(metric.status)}
          </span>
          {metric.latestRunStatus ? (
            <span className={`status status-${metric.latestRunStatus}`}>
              run {formatStatus(metric.latestRunStatus)}
            </span>
          ) : null}
        </span>
        {metric.tags.length ? <Tags tags={metric.tags.slice(0, 3)} compact /> : null}
        {error ? <span className="source-error">Last error: {error}</span> : null}
      </span>
      <span className="source-number" role="cell">
        <span
          className={
            metric.newCount > 0 ? "source-new-count active" : "source-new-count"
          }
        >
          {metric.newCount}
        </span>
      </span>
      <span className="source-number" role="cell">
        {metric.attentionCount}
      </span>
      <span className="source-number" role="cell">
        {metric.snapshotCount}
      </span>
      <span className="source-number" role="cell">
        {metric.fetchedCount ?? "-"}
      </span>
      <span role="cell">{formatShortDate(metric.latestItemAt) ?? "-"}</span>
      <span role="cell">
        <span className={`freshness freshness-${metric.freshness.state}`}>
          {metric.freshness.label}
        </span>
      </span>
    </div>
  );
}

function SortArrow({
  columnKey,
  sourceSort
}: {
  columnKey: SourceSortKey;
  sourceSort: SourceSort;
}) {
  if (sourceSort.key !== columnKey) {
    return <span className="source-sort-arrow" aria-hidden="true" />;
  }

  return (
    <span className="source-sort-arrow" aria-hidden="true">
      {sourceSort.direction === "asc" ? "^" : "v"}
    </span>
  );
}

