import { VIEW_TABS } from "@/lib/inbox/constants";
import { buildHref } from "@/lib/inbox/navigation";
import type { InboxView, ItemFilters, ItemsByView, SourceSort } from "@/lib/inbox/types";

export function TabsNav({
  activeView,
  filters,
  itemsByView,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  itemsByView: ItemsByView;
  sourceSort: SourceSort;
}) {
  return (
    <nav className="view-tabs" aria-label="Item views">
      {VIEW_TABS.map((tab) => (
        <a
          aria-current={tab.key === activeView ? "page" : undefined}
          className={tab.key === activeView ? "view-tab active" : "view-tab"}
          href={buildHref({ view: tab.key, filters, sourceSort })}
          key={tab.key}
        >
          <span>{tab.label}</span>
          <span className="view-count">{itemsByView[tab.key].length}</span>
        </a>
      ))}
    </nav>
  );
}

