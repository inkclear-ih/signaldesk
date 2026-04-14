import type { InboxView } from "./types";

export const ITEM_LIMIT = 100;
export const METRIC_ITEM_LIMIT = 1000;
export const RECENT_RUN_LIMIT = 1000;

export const VIEW_TABS: Array<{ key: InboxView; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "saved", label: "Saved" },
  { key: "archived", label: "Archived" },
  { key: "hidden", label: "Hidden" },
  { key: "reviewed", label: "Reviewed" }
];

export const VIEW_DETAILS: Record<
  InboxView,
  { title: string; description: string; emptyMessage: string }
> = {
  inbox: {
    title: "Active inbox",
    description: "Unreviewed items with no saved, archived, or hidden state.",
    emptyMessage: "No active items need review."
  },
  saved: {
    title: "Saved",
    description: "Items you kept for later.",
    emptyMessage: "Saved items will appear here."
  },
  archived: {
    title: "Archived",
    description: "Items removed from the active inbox for traceability.",
    emptyMessage: "Archived items will appear here."
  },
  hidden: {
    title: "Hidden",
    description: "Items suppressed from normal views.",
    emptyMessage: "Hidden items will appear here."
  },
  reviewed: {
    title: "Reviewed",
    description: "Reviewed items with no saved, archived, or hidden state.",
    emptyMessage: "Reviewed items without a disposition will appear here."
  }
};

