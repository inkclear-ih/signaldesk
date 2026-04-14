import { ItemCard } from "./ItemCard";
import type { InboxItem, InboxView } from "@/lib/inbox/types";

export function ItemSection({
  title,
  items,
  emptyMessage,
  sourceTags,
  activeView,
  filtersActive,
  returnTo
}: {
  title: string;
  items: InboxItem[];
  emptyMessage: string;
  sourceTags: Map<string, string[]>;
  activeView: InboxView;
  filtersActive: boolean;
  returnTo: string;
}) {
  const headingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-heading`;
  const resolvedEmptyMessage = filtersActive
    ? "No items match the current filters."
    : emptyMessage;

  return (
    <section className="item-section" aria-labelledby={headingId}>
      <div className="section-header">
        <h2 id={headingId}>{title}</h2>
        <span className="section-count">({items.length})</span>
      </div>
      {items.length ? (
        <div className="items">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              tags={sourceTags.get(item.source_id) ?? []}
              activeView={activeView}
              returnTo={returnTo}
            />
          ))}
        </div>
      ) : (
        <p className="empty">{resolvedEmptyMessage}</p>
      )}
    </section>
  );
}

