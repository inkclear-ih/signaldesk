import { ItemSection } from "./ItemSection";
import { VIEW_DETAILS } from "@/lib/inbox/constants";
import type { InboxItem, InboxView } from "@/lib/inbox/types";

export function ItemsView({
  activeItems,
  activeView,
  filtersActive,
  knownInboxItems,
  newInboxItems,
  returnTo,
  sourceTags
}: {
  activeItems: InboxItem[];
  activeView: InboxView;
  filtersActive: boolean;
  knownInboxItems: InboxItem[];
  newInboxItems: InboxItem[];
  returnTo: string;
  sourceTags: Map<string, string[]>;
}) {
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

