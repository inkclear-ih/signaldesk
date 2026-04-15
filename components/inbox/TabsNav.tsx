import { VIEW_TABS } from "@/lib/inbox/constants";
import { buildHref } from "@/lib/inbox/navigation";
import type {
  InboxView,
  ItemFilters,
  ItemSort,
  ItemsByView,
  SourceSort
} from "@/lib/inbox/types";

export function TabsNav({
  activeView,
  filters,
  itemSort,
  itemsByView,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  itemSort: ItemSort;
  itemsByView: ItemsByView;
  sourceSort: SourceSort;
}) {
  return (
    <nav className="view-tabs" aria-label="Item views">
      {VIEW_TABS.map((tab) => (
        <a
          aria-current={tab.key === activeView ? "page" : undefined}
          className={tab.key === activeView ? "view-tab active" : "view-tab"}
          href={buildHref({ view: tab.key, filters, itemSort, sourceSort })}
          key={tab.key}
        >
          <span>{tab.label}</span>
          <span className="view-count">{itemsByView[tab.key].length}</span>
        </a>
      ))}
    </nav>
  );
}
