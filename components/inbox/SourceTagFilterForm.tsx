import Link from "next/link";
import { buildHref } from "@/lib/inbox/navigation";
import type {
  InboxView,
  ItemFilters,
  ItemSort,
  SourceSort,
  SourceTag
} from "@/lib/inbox/types";

function toggleSourceTag(sourceTagIds: string[], tagId: string) {
  return sourceTagIds.includes(tagId)
    ? sourceTagIds.filter((id) => id !== tagId)
    : [...sourceTagIds, tagId];
}

export function SourceTagFilterForm({
  activeView,
  filters,
  itemSort,
  sourceSort,
  sourceTags
}: {
  activeView: InboxView;
  filters: ItemFilters;
  itemSort: ItemSort;
  sourceSort: SourceSort;
  sourceTags: SourceTag[];
}) {
  if (!sourceTags.length) {
    return (
      <p className="muted source-tag-filter-empty">
        Create tags on a source to filter source lists by them.
      </p>
    );
  }

  return (
    <div className="source-tag-filter-form">
      <div className="source-tag-filter-copy">
        <span>Source tags</span>
        <p className="muted">Match all selected tags.</p>
      </div>

      <div className="source-tag-filter-options">
        {sourceTags.map((tag) => {
          const selected = filters.sourceTagIds.includes(tag.id);

          return (
            <Link
              className={`tag-filter-option source-tag-toggle source-tag-toggle-${tag.color}${
                selected ? " is-selected" : ""
              }`}
              data-preserve-inbox-ui="true"
              href={buildHref({
                view: activeView,
                filters: {
                  ...filters,
                  sourceTagIds: toggleSourceTag(filters.sourceTagIds, tag.id)
                },
                itemSort,
                sourceSort
              })}
              key={tag.id}
              scroll={false}
              title={selected ? `Remove ${tag.name} tag filter` : `Filter by ${tag.name}`}
            >
              <span className="source-tag-toggle-name">{tag.name}</span>
            </Link>
          );
        })}
      </div>

      {filters.sourceTagIds.length ? (
        <div className="source-tag-filter-actions">
          <Link
            className="filter-clear"
            data-preserve-inbox-ui="true"
            href={buildHref({
              view: activeView,
              filters: { ...filters, sourceTagIds: [] },
              itemSort,
              sourceSort
            })}
            scroll={false}
          >
            Clear tags
          </Link>
        </div>
      ) : null}
    </div>
  );
}
