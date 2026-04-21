import type { TagColor } from "@/lib/inbox/types";

export function Tags({
  compact,
  tags
}: {
  compact?: boolean;
  tags: Array<{
    id: string;
    name: string;
    color: TagColor;
  }>;
}) {
  if (!tags.length) {
    return null;
  }

  return (
    <div className={compact ? "tags tags-compact" : "tags"}>
      {tags.map((tag) => (
        <span className={`tag-chip tag-chip-${tag.color}`} key={tag.id}>
          {tag.name}
        </span>
      ))}
    </div>
  );
}
