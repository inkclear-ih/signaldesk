import { buildHref } from "@/lib/inbox/navigation";
import type {
  InboxView,
  ItemFilters as ItemFilterState,
  SourceMetric,
  SourceSort
} from "@/lib/inbox/types";

export function ItemFilters({
  activeView,
  filters,
  filtersActive,
  shownCount,
  sourceMetrics,
  sourceSort,
  totalCount
}: {
  activeView: InboxView;
  filters: ItemFilterState;
  filtersActive: boolean;
  shownCount: number;
  sourceMetrics: SourceMetric[];
  sourceSort: SourceSort;
  totalCount: number;
}) {
  const selectedSource = sourceMetrics.find(
    (metric) => metric.source.source_id === filters.sourceId
  );

  return (
    <section className="filters-panel" aria-label="Item filters">
      <form className="filters" method="get">
        {activeView !== "inbox" ? (
          <input type="hidden" name="view" value={activeView} />
        ) : null}
        <input type="hidden" name="sourceSort" value={sourceSort.key} />
        <input type="hidden" name="sourceDir" value={sourceSort.direction} />

        <label className="filter-field">
          <span>Source</span>
          <select name="source" defaultValue={filters.sourceId}>
            <option value="">All sources</option>
            {sourceMetrics.map((metric) => (
              <option key={metric.source.source_id} value={metric.source.source_id}>
                {metric.name}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            name="new"
            value="1"
            defaultChecked={filters.newOnly}
          />
          New only
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            name="unreviewed"
            value="1"
            defaultChecked={filters.unreviewedOnly}
          />
          Unreviewed only
        </label>

        <button className="button button-compact" type="submit">
          Apply
        </button>
        {filtersActive ? (
          <a className="filter-clear" href={buildHref({ view: activeView, sourceSort })}>
            Clear
          </a>
        ) : null}
      </form>
      <p className="muted filter-result">
        {shownCount} of {totalCount} items shown
        {selectedSource ? ` from ${selectedSource.name}` : ""}
      </p>
    </section>
  );
}

