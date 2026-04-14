import { cleanTags } from "@/lib/inbox/formatting";

export function Tags({ compact, tags }: { compact?: boolean; tags: string[] }) {
  const cleanedTags = cleanTags(tags);
  if (!cleanedTags.length) {
    return null;
  }

  return (
    <div className={compact ? "tags tags-compact" : "tags"}>
      {cleanedTags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
}

