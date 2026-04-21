import {
  assignSourceTagToSource,
  clearSourceTagsFromSource,
  createSourceTag,
  removeSourceTagFromSource
} from "@/app/actions";
import { SOURCE_TAG_PALETTE } from "@/lib/inbox/source-tags";
import type { SourceTag, UserSource } from "@/lib/inbox/types";

export function SourceTagEditor({
  source,
  sourceTags,
  returnTo
}: {
  source: UserSource;
  sourceTags: SourceTag[];
  returnTo: string;
}) {
  const assignedTagIds = new Set(source.source_tags.map((tag) => tag.id));

  return (
    <details
      className="source-tag-editor"
      data-persist-details-id={`source-tag-editor:${source.user_source_id}`}
    >
      <summary>
        {source.source_tags.length ? "Edit tags" : "Add source tags"}
      </summary>
      <div className="source-tag-editor-body">
        {source.source_tags.length ? (
          <form className="source-tag-clear-form" action={clearSourceTagsFromSource}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <input
              type="hidden"
              name="userSourceId"
              value={source.user_source_id}
            />
            <button className="source-tag-clear-button" type="submit">
              Clear tags
            </button>
          </form>
        ) : null}
        {sourceTags.length ? (
          <div className="source-tag-toggle-list">
            {sourceTags.map((tag) => {
              const assigned = assignedTagIds.has(tag.id);

              return (
                <form
                  action={assigned ? removeSourceTagFromSource : assignSourceTagToSource}
                  key={tag.id}
                >
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <input
                    type="hidden"
                    name="userSourceId"
                    value={source.user_source_id}
                  />
                  <input type="hidden" name="sourceTagId" value={tag.id} />
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
            No source tags yet. Create the first one below.
          </p>
        )}

        <form className="source-tag-create-form" action={createSourceTag}>
          <input type="hidden" name="assignUserSourceId" value={source.user_source_id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="filter-field source-tag-create-field">
            <span>New tag</span>
            <input
              className="input"
              maxLength={48}
              name="tagName"
              placeholder="typographer"
              required
            />
          </label>
          <label className="filter-field source-tag-color-field">
            <span>Color</span>
            <select defaultValue="slate" name="tagColor">
              {SOURCE_TAG_PALETTE.map((option) => (
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
