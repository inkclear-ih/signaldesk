import {
  assignItemTagToItem,
  clearItemTagsFromItem,
  createItemTag,
  removeItemTagFromItem
} from "@/app/actions";
import { ITEM_TAG_PALETTE } from "@/lib/inbox/item-tags";
import type { InboxItem, ItemTag } from "@/lib/inbox/types";

export function ItemTagEditor({
  item,
  itemTags,
  returnTo
}: {
  item: InboxItem;
  itemTags: ItemTag[];
  returnTo: string;
}) {
  const assignedTagIds = new Set(item.item_tags.map((tag) => tag.id));

  return (
    <details className="source-tag-editor item-tag-editor">
      <summary>{item.item_tags.length ? "Edit item tags" : "Add item tags"}</summary>
      <div className="source-tag-editor-body">
        {item.item_tags.length ? (
          <form className="source-tag-clear-form" action={clearItemTagsFromItem}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="source-tag-clear-button" type="submit">
              Clear tags
            </button>
          </form>
        ) : null}
        {itemTags.length ? (
          <div className="source-tag-toggle-list">
            {itemTags.map((tag) => {
              const assigned = assignedTagIds.has(tag.id);

              return (
                <form
                  action={assigned ? removeItemTagFromItem : assignItemTagToItem}
                  key={tag.id}
                >
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="itemTagId" value={tag.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    aria-pressed={assigned}
                    className={`source-tag-toggle source-tag-toggle-${tag.color}${
                      assigned ? " is-selected" : ""
                    }`}
                    type="submit"
                    title={assigned ? `Remove ${tag.name}` : `Add ${tag.name}`}
                  >
                    <span className="source-tag-toggle-name">{tag.name}</span>
                  </button>
                </form>
              );
            })}
          </div>
        ) : (
          <p className="muted source-tag-editor-empty">
            No item tags yet. Create the first one below.
          </p>
        )}

        <form className="source-tag-create-form" action={createItemTag}>
          <input type="hidden" name="assignItemId" value={item.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="filter-field source-tag-create-field">
            <span>New tag</span>
            <input
              className="input"
              maxLength={48}
              name="tagName"
              placeholder="follow-up"
              required
            />
          </label>
          <label className="filter-field source-tag-color-field">
            <span>Color</span>
            <select defaultValue="slate" name="tagColor">
              {ITEM_TAG_PALETTE.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className="item-action item-action-primary" type="submit">
            Create
          </button>
        </form>
      </div>
    </details>
  );
}
