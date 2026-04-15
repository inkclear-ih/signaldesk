export type SearchParams = {
  sent?: string;
  error?: string;
  view?: string;
  source?: string;
  new?: string;
  unreviewed?: string;
  itemSort?: string;
  itemDir?: string;
  sourceSort?: string;
  sourceDir?: string;
  sourceMessage?: string;
  sourceError?: string;
  sourceDiscovery?: string;
};

export type DispositionState = "none" | "saved" | "archived" | "hidden";
export type InboxView = "inbox" | "saved" | "archived" | "hidden" | "reviewed";
export type ItemSortKey = "default" | "seen" | "published" | "source";
export type SourceSortKey =
  | "source"
  | "new"
  | "attention"
  | "snapshot"
  | "fetched"
  | "latest"
  | "freshness";
export type SortDirection = "asc" | "desc";

export type InboxItem = {
  id: string;
  source_id: string;
  title: string | null;
  link: string | null;
  summary: string | null;
  published_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  source_name: string;
  system_state: "new" | "known";
  system_state_rank: number;
  review_state: "unreviewed" | "reviewed";
  disposition_state: DispositionState;
  reviewed_at: string | null;
  saved_at: string | null;
  archived_at: string | null;
  hidden_at: string | null;
};

export type UserSource = {
  user_source_id: string;
  source_id: string;
  display_name: string | null;
  user_source_status: "active" | "paused" | "archived";
  tags: string[] | null;
  source_name: string;
  feed_url: string;
  source_status: string;
  last_fetched_at: string | null;
  last_error: string | null;
};

export type MetricItem = Pick<
  InboxItem,
  | "id"
  | "source_id"
  | "published_at"
  | "first_seen_at"
  | "system_state"
  | "review_state"
  | "disposition_state"
>;

export type LatestRun = {
  id: string;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "error" | "partial";
  fetched_count: number;
  new_count: number;
  error_message: string | null;
};

export type ItemFilters = {
  sourceId: string;
  newOnly: boolean;
  unreviewedOnly: boolean;
};

export type ItemSort = {
  key: ItemSortKey;
  direction: SortDirection;
};

export type SourceSort = {
  key: SourceSortKey;
  direction: SortDirection;
};

export type Freshness = {
  label: string;
  state: "fresh" | "aging" | "stale" | "never" | "error";
  timestamp: number;
};

export type SourceMetric = {
  source: UserSource;
  name: string;
  status: string;
  tags: string[];
  fetchedCount: number | null;
  latestRunStatus: LatestRun["status"] | null;
  latestRunError: string | null;
  snapshotCount: number;
  newCount: number;
  attentionCount: number;
  latestItemAt: string | null;
  lastFetchedAt: string | null;
  freshness: Freshness;
};

export type TopMetrics = {
  totalItems: number;
  newItems: number;
  needsAttention: number;
  reviewedItems: number;
  sources: number;
};

export type ItemsByView = Record<InboxView, InboxItem[]>;
