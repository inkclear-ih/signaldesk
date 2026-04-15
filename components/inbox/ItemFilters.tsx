import { buildHref } from "@/lib/inbox/navigation";
import { ITEM_SORT_OPTIONS } from "@/lib/inbox/item-sort";
import type {
  InboxView,
  ItemFilters as ItemFilterState,
  ItemSort,
  SourceMetric,
  SourceSort
} from "@/lib/inbox/types";

export function ItemFilters({
  activeView,
  filters,
  filtersActive,
  itemSort,
  shownCount,
  sourceMetrics,
  sourceSort,
  totalCount
}: {
  activeView: InboxView;
  filters: ItemFilterState;
  filtersActive: boolean;
  itemSort: ItemSort;
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

        <label className="filter-field filter-field-compact">
          <span>Sort</span>
          <select name="itemSort" defaultValue={itemSort.key}>
            {ITEM_SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field filter-field-compact">
          <span>Direction</span>
          <select name="itemDir" defaultValue={itemSort.direction}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>

        <button className="button button-compact" type="submit">
          Apply
        </button>
        {filtersActive ? (
          <a
            className="filter-clear"
            href={buildHref({ view: activeView, itemSort, sourceSort })}
          >
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
