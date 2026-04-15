import { ItemSection } from "./ItemSection";
import { ITEM_LIMIT, VIEW_DETAILS } from "@/lib/inbox/constants";
import { describeItemSort } from "@/lib/inbox/item-sort";
import type { InboxItem, InboxView, ItemSort } from "@/lib/inbox/types";

export function ItemsView({
  activeItems,
  activeView,
  filtersActive,
  itemSort,
  knownInboxItems,
  newInboxItems,
  returnTo,
  sourceTags
}: {
  activeItems: InboxItem[];
  activeView: InboxView;
  filtersActive: boolean;
  itemSort: ItemSort;
  knownInboxItems: InboxItem[];
  newInboxItems: InboxItem[];
  returnTo: string;
  sourceTags: Map<string, string[]>;
}) {
  const sortDescription = describeItemSort(itemSort);
  const knownDescription =
    itemSort.key === "default"
      ? `Most recently seen again appear first. Showing up to ${ITEM_LIMIT}.`
      : sortDescription;

  return (
    <section className="inbox" aria-label={VIEW_DETAILS[activeView].title}>
      <div className="view-intro">
        <h2>{VIEW_DETAILS[activeView].title}</h2>
        <p className="muted">{VIEW_DETAILS[activeView].description}</p>
      </div>

      {activeView === "inbox" ? (
        <div className="item-sections">
          <ItemSection
            title="New to review"
            items={newInboxItems}
            emptyMessage="No new items need review."
            sourceTags={sourceTags}
            activeView={activeView}
            filtersActive={filtersActive}
            returnTo={returnTo}
          />
          <ItemSection
            title="Known, still unreviewed"
            description={knownDescription}
            items={knownInboxItems}
            emptyMessage="Known items are previously seen by Signaldesk but still unreviewed. Empty is good: nothing older is waiting on you."
            sourceTags={sourceTags}
            activeView={activeView}
            filtersActive={filtersActive}
            returnTo={returnTo}
          />
        </div>
      ) : (
        <div className="item-sections item-sections-single">
          <ItemSection
            title={VIEW_DETAILS[activeView].title}
            description={sortDescription}
            items={activeItems}
            emptyMessage={VIEW_DETAILS[activeView].emptyMessage}
            sourceTags={sourceTags}
            activeView={activeView}
            filtersActive={filtersActive}
            returnTo={returnTo}
          />
        </div>
      )}
    </section>
  );
}
