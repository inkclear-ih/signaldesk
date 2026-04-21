import Link from "next/link";
import { buildHref } from "@/lib/inbox/navigation";
import type {
  InboxView,
  ItemFilters,
  ItemSort,
  ItemTag,
  SourceSort
} from "@/lib/inbox/types";

function toggleItemTag(itemTagIds: string[], tagId: string) {
  return itemTagIds.includes(tagId)
    ? itemTagIds.filter((id) => id !== tagId)
    : [...itemTagIds, tagId];
}

export function ItemTagFilterForm({
  activeView,
  filters,
  itemSort,
  sourceSort,
  itemTags
}: {
  activeView: InboxView;
  filters: ItemFilters;
  itemSort: ItemSort;
  sourceSort: SourceSort;
  itemTags: ItemTag[];
}) {
  if (!itemTags.length) {
    return (
      <p className="muted source-tag-filter-empty">
        Create tags on an item to filter item results by them.
      </p>
    );
  }

  return (
    <div className="source-tag-filter-form">
      <div className="source-tag-filter-copy">
        <span>Item tags</span>
        <p className="muted">Match all selected tags.</p>
      </div>

      <div className="source-tag-filter-options">
        {itemTags.map((tag) => {
          const selected = filters.itemTagIds.includes(tag.id);

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
                  itemTagIds: toggleItemTag(filters.itemTagIds, tag.id)
                },
                itemSort,
                sourceSort
              })}
              key={tag.id}
              scroll={false}
              title={selected ? `Remove ${tag.name} item tag filter` : `Filter by ${tag.name}`}
            >
              <span className="source-tag-toggle-name">{tag.name}</span>
            </Link>
          );
        })}
      </div>

      {filters.itemTagIds.length ? (
        <div className="source-tag-filter-actions">
          <Link
            className="filter-clear"
            data-preserve-inbox-ui="true"
            href={buildHref({
              view: activeView,
              filters: { ...filters, itemTagIds: [] },
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
