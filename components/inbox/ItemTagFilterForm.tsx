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
            <a
              className={`tag-filter-option source-tag-toggle source-tag-toggle-${tag.color}${
                selected ? " is-selected" : ""
              }`}
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
              title={selected ? `Remove ${tag.name} item tag filter` : `Filter by ${tag.name}`}
            >
              <span className="source-tag-toggle-name">{tag.name}</span>
            </a>
          );
        })}
      </div>

      {filters.itemTagIds.length ? (
        <div className="source-tag-filter-actions">
          <a
            className="filter-clear"
            href={buildHref({
              view: activeView,
              filters: { ...filters, itemTagIds: [] },
              itemSort,
              sourceSort
            })}
          >
            Clear tags
          </a>
        </div>
      ) : null}
    </div>
  );
}
