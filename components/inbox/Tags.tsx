import { cleanSourceTags } from "@/lib/inbox/source-tags";
import type { SourceTag } from "@/lib/inbox/types";

export function Tags({
  compact,
  tags
}: {
  compact?: boolean;
  tags: SourceTag[];
}) {
  const cleanedTags = cleanSourceTags(tags);
  if (!cleanedTags.length) {
    return null;
  }

  return (
    <div className={compact ? "tags tags-compact" : "tags"}>
      {cleanedTags.map((tag) => (
        <span className={`tag-chip tag-chip-${tag.color}`} key={tag.id}>
          {tag.name}
        </span>
      ))}
    </div>
  );
}
