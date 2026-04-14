import {
  clearItemDisposition,
  markItemReviewed,
  markItemUnreviewed,
  restoreItemToInbox,
  setItemDisposition,
  signIn,
  signOut
} from "./actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ReactNode } from "react";

type SearchParams = {
  sent?: string;
  error?: string;
  view?: string;
  source?: string;
  new?: string;
  unreviewed?: string;
  sourceSort?: string;
  sourceDir?: string;
};

type DispositionState = "none" | "saved" | "archived" | "hidden";
type InboxView = "inbox" | "saved" | "archived" | "hidden" | "reviewed";
type SourceSortKey =
  | "source"
  | "new"
  | "attention"
  | "snapshot"
  | "fetched"
  | "latest"
  | "freshness";
type SortDirection = "asc" | "desc";

type InboxItem = {
  id: string;
  source_id: string;
  title: string | null;
  link: string | null;
  summary: string | null;
  published_at: string | null;
  first_seen_at: string;
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

type UserSource = {
  user_source_id: string;
  source_id: string;
  display_name: string | null;
  user_source_status: string;
  tags: string[] | null;
  source_name: string;
  feed_url: string;
  source_status: string;
  last_fetched_at: string | null;
  last_error: string | null;
};

type MetricItem = Pick<
  InboxItem,
  | "id"
  | "source_id"
  | "published_at"
  | "first_seen_at"
  | "system_state"
  | "review_state"
  | "disposition_state"
>;

type LatestRun = {
  id: string;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "error" | "partial";
  fetched_count: number;
  new_count: number;
  error_message: string | null;
};

type ItemFilters = {
  sourceId: string;
  newOnly: boolean;
  unreviewedOnly: boolean;
};

type SourceSort = {
  key: SourceSortKey;
  direction: SortDirection;
};

type Freshness = {
  label: string;
  state: "fresh" | "aging" | "stale" | "never" | "error";
  timestamp: number;
};

type SourceMetric = {
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

type TopMetrics = {
  totalItems: number;
  newItems: number;
  needsAttention: number;
  reviewedItems: number;
  sources: number;
};

const SUMMARY_MAX_CHARS = 360;
const ITEM_LIMIT = 100;
const METRIC_ITEM_LIMIT = 1000;
const RECENT_RUN_LIMIT = 1000;

const VIEW_TABS: Array<{ key: InboxView; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "saved", label: "Saved" },
  { key: "archived", label: "Archived" },
  { key: "hidden", label: "Hidden" },
  { key: "reviewed", label: "Reviewed" }
];

const VIEW_DETAILS: Record<
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

const SOURCE_COLUMNS: Array<{
  key: SourceSortKey;
  label: string;
  className?: string;
}> = [
  { key: "source", label: "Source" },
  { key: "new", label: "New", className: "source-number" },
  { key: "attention", label: "Open", className: "source-number" },
  { key: "snapshot", label: "Items", className: "source-number" },
  { key: "fetched", label: "Fetched", className: "source-number" },
  { key: "latest", label: "Latest item" },
  { key: "freshness", label: "Fetched at" }
];

export default async function Home({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return <SignedOut sent={searchParams?.sent} error={searchParams?.error} />;
  }

  await supabase.from("profiles").upsert({
    id: user.id,
    email: user.email,
    last_seen_at: new Date().toISOString()
  });

  const activeView = parseView(searchParams?.view);
  const sourceSort = parseSourceSort(searchParams);
  const [
    { data: inboxItems },
    { data: savedItems },
    { data: archivedItems },
    { data: hiddenItems },
    { data: reviewedItems },
    { data: sources },
    { data: metricItems },
    { count: totalItemCount },
    { count: newItemCount },
    { count: attentionItemCount },
    { count: reviewedItemCount }
  ] = await Promise.all([
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "none")
      .eq("review_state", "unreviewed")
      .order("system_state_rank", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "saved")
      .order("saved_at", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "archived")
      .order("archived_at", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "hidden")
      .order("hidden_at", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "none")
      .eq("review_state", "reviewed")
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_sources")
      .select("*")
      .order("source_name", { ascending: true }),
    supabase
      .from("current_user_items")
      .select(
        "id, source_id, published_at, first_seen_at, system_state, review_state, disposition_state"
      )
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(METRIC_ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("current_user_items")
      .select("id", { count: "exact", head: true })
      .eq("system_state", "new"),
    supabase
      .from("current_user_items")
      .select("id", { count: "exact", head: true })
      .eq("review_state", "unreviewed")
      .eq("disposition_state", "none"),
    supabase
      .from("current_user_items")
      .select("id", { count: "exact", head: true })
      .eq("review_state", "reviewed")
  ]);

  const itemsByView: Record<InboxView, InboxItem[]> = {
    inbox: (inboxItems ?? []) as InboxItem[],
    saved: (savedItems ?? []) as InboxItem[],
    archived: (archivedItems ?? []) as InboxItem[],
    hidden: (hiddenItems ?? []) as InboxItem[],
    reviewed: (reviewedItems ?? []) as InboxItem[]
  };
  const typedSources = (sources ?? []) as UserSource[];
  const sourceIds = new Set(typedSources.map((source) => source.source_id));
  const filters = parseFilters(searchParams, sourceIds);
  const latestRunsBySource = await getLatestRunsBySource(
    supabase,
    typedSources.map((source) => source.source_id)
  );
  const sourceMetrics = sortSourceMetrics(
    buildSourceMetrics(
      typedSources,
      (metricItems ?? []) as MetricItem[],
      latestRunsBySource
    ),
    sourceSort
  );
  const sourceTags = new Map(
    typedSources.map((source) => [source.source_id, cleanTags(source.tags)])
  );
  const filteredItemsByView = filterItemsByView(itemsByView, filters);
  const activeItems = filteredItemsByView[activeView];
  const newInboxItems = filteredItemsByView.inbox.filter(
    (item) => item.system_state === "new"
  );
  const knownInboxItems = filteredItemsByView.inbox.filter(
    (item) => item.system_state === "known"
  );
  const filtersActive = hasActiveFilters(filters);
  const currentHref = buildHref({ view: activeView, filters, sourceSort });
  const topMetrics = buildTopMetrics(
    (metricItems ?? []) as MetricItem[],
    typedSources.length,
    totalItemCount ?? (metricItems ?? []).length,
    newItemCount,
    attentionItemCount,
    reviewedItemCount
  );

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <span className="eyebrow">Signaldesk v2 bootstrap</span>
          <h1>Inbox</h1>
          <p className="muted">{user.email}</p>
        </div>
        <form action={signOut}>
          <button className="button button-secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>

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

      <OverviewPanel metrics={topMetrics} />

      <SourcesPanel
        activeView={activeView}
        filters={filters}
        metrics={sourceMetrics}
        sourceSort={sourceSort}
      />

      <FiltersPanel
        activeView={activeView}
        filters={filters}
        filtersActive={filtersActive}
        shownCount={activeItems.length}
        sourceMetrics={sourceMetrics}
        sourceSort={sourceSort}
        totalCount={itemsByView[activeView].length}
      />

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
              returnTo={currentHref}
            />
            <ItemSection
              title="Known, still unreviewed"
              items={knownInboxItems}
              emptyMessage="Known items are previously seen by Signaldesk but still unreviewed. Empty is good: nothing older is waiting on you."
              sourceTags={sourceTags}
              activeView={activeView}
              filtersActive={filtersActive}
              returnTo={currentHref}
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
              returnTo={currentHref}
            />
          </div>
        )}
      </section>
    </main>
  );
}

function OverviewPanel({ metrics }: { metrics: TopMetrics }) {
  return (
    <section className="overview-panel" aria-label="Inbox overview">
      <div className="metric-strip" aria-label="Inbox totals">
        <MetricCard label="Total items" value={metrics.totalItems} />
        <MetricCard label="Need attention" value={metrics.needsAttention} />
        <MetricCard label="New items" value={metrics.newItems} />
        <MetricCard label="Reviewed" value={metrics.reviewedItems} />
        <MetricCard label="Sources" value={metrics.sources} />
      </div>

      <div className="read-guide" aria-labelledby="read-guide-heading">
        <h2 id="read-guide-heading">How to read this inbox</h2>
        <div className="guide-terms">
          <p>
            <strong>New</strong> first appeared in the latest successful source
            run. <strong>Known</strong> has appeared before.
          </p>
          <p>
            <strong>Unreviewed</strong> still needs a decision.{" "}
            <strong>Reviewed</strong> has been acknowledged and leaves the
            active inbox unless you save, archive, or hide it.
          </p>
          <p>
            <strong>Saved</strong> is kept for later.{" "}
            <strong>Archived</strong> is cleared out but traceable.{" "}
            <strong>Hidden</strong> is suppressed from normal work.
          </p>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FiltersPanel({
  activeView,
  filters,
  filtersActive,
  shownCount,
  sourceMetrics,
  sourceSort,
  totalCount
}: {
  activeView: InboxView;
  filters: ItemFilters;
  filtersActive: boolean;
  shownCount: number;
  sourceMetrics: SourceMetric[];
  sourceSort: SourceSort;
  totalCount: number;
}) {
  const selectedSource = sourceMetrics.find(
    (metric) => metric.source.source_id === filters.sourceId
  );

  return (
    <section className="filters-panel" aria-label="Item filters">
      <form className="filters" method="get">
        {activeView !== "inbox" ? (
          <input type="hidden" name="view" value={activeView} />
        ) : null}
        <input type="hidden" name="sourceSort" value={sourceSort.key} />
        <input type="hidden" name="sourceDir" value={sourceSort.direction} />

        <label className="filter-field">
          <span>Source</span>
          <select name="source" defaultValue={filters.sourceId}>
            <option value="">All sources</option>
            {sourceMetrics.map((metric) => (
              <option key={metric.source.source_id} value={metric.source.source_id}>
                {metric.name}
              </option>
            ))}
          </select>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            name="new"
            value="1"
            defaultChecked={filters.newOnly}
          />
          New only
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            name="unreviewed"
            value="1"
            defaultChecked={filters.unreviewedOnly}
          />
          Unreviewed only
        </label>

        <button className="button button-compact" type="submit">
          Apply
        </button>
        {filtersActive ? (
          <a className="filter-clear" href={buildHref({ view: activeView, sourceSort })}>
            Clear
          </a>
        ) : null}
      </form>
      <p className="muted filter-result">
        {shownCount} of {totalCount} items shown
        {selectedSource ? ` from ${selectedSource.name}` : ""}
      </p>
    </section>
  );
}

function SourcesPanel({
  activeView,
  filters,
  metrics,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  metrics: SourceMetric[];
  sourceSort: SourceSort;
}) {
  const sourcesWithNew = metrics.filter((metric) => metric.newCount > 0).length;
  const staleSources = metrics.filter(
    (metric) => metric.freshness.state === "stale" || metric.freshness.state === "never"
  ).length;
  const sourcesWithErrors = metrics.filter(
    (metric) =>
      metric.latestRunStatus === "error" ||
      Boolean(metric.source.last_error) ||
      Boolean(metric.latestRunError)
  ).length;

  return (
    <section className="panel sources-panel" aria-labelledby="sources-heading">
      <div className="section-header section-header-panel">
        <h2 id="sources-heading">Sources</h2>
        <span className="section-count">({metrics.length})</span>
      </div>

      <div className="source-summary" aria-label="Source summary">
        <span>
          <strong>{sourcesWithNew}</strong> with new
        </span>
        <span>
          <strong>{staleSources}</strong> stale
        </span>
        <span>
          <strong>{sourcesWithErrors}</strong> errors
        </span>
      </div>

      {metrics.length ? (
        <div className="source-table" role="table" aria-label="Source scan table">
          <div className="source-row source-head" role="row">
            {SOURCE_COLUMNS.map((column) => (
              <span className={column.className} role="columnheader" key={column.key}>
                <a
                  className="source-sort-button"
                  href={buildHref({
                    view: activeView,
                    filters,
                    sourceSort: nextSourceSort(sourceSort, column.key)
                  })}
                >
                  {column.label}
                  <SortArrow sourceSort={sourceSort} columnKey={column.key} />
                </a>
              </span>
            ))}
          </div>
          <div className="source-body" role="rowgroup">
            {metrics.map((metric) => (
              <SourceRow
                activeView={activeView}
                filters={filters}
                key={metric.source.user_source_id}
                metric={metric}
                sourceSort={sourceSort}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">No sources seeded for this user yet.</p>
      )}
    </section>
  );
}

function SourceRow({
  activeView,
  filters,
  metric,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  metric: SourceMetric;
  sourceSort: SourceSort;
}) {
  const rowClasses = ["source-row"];
  if (metric.newCount > 0) {
    rowClasses.push("source-row-new");
  }
  if (metric.freshness.state === "stale" || metric.freshness.state === "never") {
    rowClasses.push("source-row-stale");
  }
  if (metric.latestRunStatus === "error" || metric.source.last_error) {
    rowClasses.push("source-row-error");
  }
  const error = metric.latestRunError || metric.source.last_error;

  return (
    <div className={rowClasses.join(" ")} role="row">
      <span className="source-primary" role="cell">
        <a
          className="source-name"
          href={buildHref({
            view: activeView,
            filters: { ...filters, sourceId: metric.source.source_id },
            sourceSort
          })}
          title={metric.source.feed_url}
        >
          {metric.name}
        </a>
        <span className="source-meta">
          <span className={`status status-${metric.status}`}>
            {formatStatus(metric.status)}
          </span>
          {metric.latestRunStatus ? (
            <span className={`status status-${metric.latestRunStatus}`}>
              run {formatStatus(metric.latestRunStatus)}
            </span>
          ) : null}
        </span>
        {metric.tags.length ? <Tags tags={metric.tags.slice(0, 3)} compact /> : null}
        {error ? <span className="source-error">Last error: {error}</span> : null}
      </span>
      <span className="source-number" role="cell">
        <span className={metric.newCount > 0 ? "source-new-count active" : "source-new-count"}>
          {metric.newCount}
        </span>
      </span>
      <span className="source-number" role="cell">
        {metric.attentionCount}
      </span>
      <span className="source-number" role="cell">
        {metric.snapshotCount}
      </span>
      <span className="source-number" role="cell">
        {metric.fetchedCount ?? "-"}
      </span>
      <span role="cell">{formatShortDate(metric.latestItemAt) ?? "-"}</span>
      <span role="cell">
        <span className={`freshness freshness-${metric.freshness.state}`}>
          {metric.freshness.label}
        </span>
      </span>
    </div>
  );
}

function SortArrow({
  columnKey,
  sourceSort
}: {
  columnKey: SourceSortKey;
  sourceSort: SourceSort;
}) {
  if (sourceSort.key !== columnKey) {
    return <span className="source-sort-arrow" aria-hidden="true" />;
  }

  return (
    <span className="source-sort-arrow" aria-hidden="true">
      {sourceSort.direction === "asc" ? "^" : "v"}
    </span>
  );
}

function ItemSection({
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

function SignedOut({ sent, error }: SearchParams) {
  return (
    <main className="page">
      <section className="panel">
        <div className="brand">
          <span className="eyebrow">Signaldesk v2 bootstrap</span>
          <h1>Sign in</h1>
          <p className="muted">
            Use Supabase email auth to open the first synced inbox slice.
          </p>
        </div>

        <form className="form" action={signIn}>
          <label>
            Email
            <input
              className="input"
              type="email"
              name="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <button className="button" type="submit">
            Send magic link
          </button>
          {sent ? <p className="muted">Check your email for the sign-in link.</p> : null}
          {error ? <p className="muted">Sign-in error: {error}</p> : null}
        </form>
      </section>
    </main>
  );
}

function ItemCard({
  item,
  tags,
  activeView,
  returnTo
}: {
  item: InboxItem;
  tags: string[];
  activeView: InboxView;
  returnTo: string;
}) {
  const reviewed = item.review_state === "reviewed";
  const reviewAction = reviewed ? markItemUnreviewed : markItemReviewed;
  const reviewActionLabel = reviewed ? "Mark unreviewed" : "Mark reviewed";
  const title = cleanText(item.title) ?? item.link ?? "Untitled item";
  const summary = trimSummary(cleanText(item.summary));
  const publishedDate = formatDate(item.published_at);
  const removalTarget = reviewed ? "Reviewed" : "Inbox";

  return (
    <article className={item.system_state === "new" ? "item item-new" : "item"}>
      <div className="item-source">{item.source_name}</div>
      {item.link ? (
        <a className="item-title" href={item.link} rel="noreferrer" target="_blank">
          {title}
        </a>
      ) : (
        <h3 className="item-title">{title}</h3>
      )}
      <div className="published-date">
        {publishedDate ? (
          <time dateTime={item.published_at ?? undefined}>{publishedDate}</time>
        ) : (
          <span>No published date</span>
        )}
      </div>
      {tags.length ? <Tags tags={tags} /> : <div className="tags" />}
      {summary ? <p className="summary-text">{summary}</p> : null}
      <div className="item-status">
        <span
          className={
            item.system_state === "new" ? "badge" : "badge badge-known"
          }
        >
          {item.system_state === "new" ? "New" : "Known"}
        </span>
        <span className={reviewed ? "badge badge-reviewed" : "badge badge-unreviewed"}>
          {reviewed ? "Reviewed" : "Unreviewed"}
        </span>
        {item.disposition_state !== "none" ? (
          <span className={`badge badge-${item.disposition_state}`}>
            {formatDisposition(item.disposition_state)}
          </span>
        ) : null}
      </div>
      <div className="item-actions" aria-label={`Actions for ${title}`}>
        <ItemActionForm
          action={reviewAction}
          activeView={activeView}
          itemId={item.id}
          returnTo={returnTo}
        >
          {reviewActionLabel}
        </ItemActionForm>
        {item.disposition_state === "none" ? (
          <>
            <DispositionAction
              activeView={activeView}
              disposition="saved"
              itemId={item.id}
              returnTo={returnTo}
            />
            <DispositionAction
              activeView={activeView}
              disposition="archived"
              itemId={item.id}
              returnTo={returnTo}
            />
            <DispositionAction
              activeView={activeView}
              disposition="hidden"
              itemId={item.id}
              returnTo={returnTo}
            />
          </>
        ) : (
          <>
            <p className="item-action-help">
              Removing {item.disposition_state} keeps the review state, so this
              item moves to {removalTarget}. Restoring resets it to unreviewed
              in Inbox.
            </p>
            <ItemActionForm
              action={clearItemDisposition}
              activeView={activeView}
              itemId={item.id}
              returnTo={returnTo}
            >
              Remove {item.disposition_state} state
            </ItemActionForm>
            <ItemActionForm
              action={restoreItemToInbox}
              activeView={activeView}
              itemId={item.id}
              primary
              returnTo={returnTo}
            >
              Restore to inbox
            </ItemActionForm>
          </>
        )}
      </div>
    </article>
  );
}

function DispositionAction({
  activeView,
  disposition,
  itemId,
  returnTo
}: {
  activeView: InboxView;
  disposition: Exclude<DispositionState, "none">;
  itemId: string;
  returnTo: string;
}) {
  return (
    <ItemActionForm
      action={setItemDisposition}
      activeView={activeView}
      itemId={itemId}
      name="disposition"
      returnTo={returnTo}
      value={disposition}
    >
      {formatDispositionAction(disposition)}
    </ItemActionForm>
  );
}

function ItemActionForm({
  action,
  activeView,
  children,
  itemId,
  name,
  primary,
  returnTo,
  value
}: {
  action: (formData: FormData) => Promise<void>;
  activeView: InboxView;
  children: ReactNode;
  itemId: string;
  name?: string;
  primary?: boolean;
  returnTo: string;
  value?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="view" value={activeView} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {name && value ? <input type="hidden" name={name} value={value} /> : null}
      <button className={primary ? "item-action item-action-primary" : "item-action"} type="submit">
        {children}
      </button>
    </form>
  );
}

function Tags({ compact, tags }: { compact?: boolean; tags: string[] }) {
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

async function getLatestRunsBySource(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sourceIds: string[]
): Promise<Map<string, LatestRun>> {
  if (!sourceIds.length) {
    return new Map();
  }

  const { data } = await supabase
    .from("ingestion_runs")
    .select(
      "id, source_id, started_at, finished_at, status, fetched_count, new_count, error_message"
    )
    .in("source_id", sourceIds)
    .order("started_at", { ascending: false })
    .limit(RECENT_RUN_LIMIT);

  const latestRuns = new Map<string, LatestRun>();
  for (const run of (data ?? []) as LatestRun[]) {
    if (!latestRuns.has(run.source_id)) {
      latestRuns.set(run.source_id, run);
    }
  }

  return latestRuns;
}

function buildTopMetrics(
  items: MetricItem[],
  sourceCount: number,
  totalItemCount: number,
  newItemCount: number | null,
  attentionItemCount: number | null,
  reviewedItemCount: number | null
): TopMetrics {
  return {
    totalItems: totalItemCount,
    newItems:
      newItemCount ?? items.filter((item) => item.system_state === "new").length,
    needsAttention:
      attentionItemCount ??
      items.filter(
        (item) =>
          item.review_state === "unreviewed" && item.disposition_state === "none"
      ).length,
    reviewedItems:
      reviewedItemCount ??
      items.filter((item) => item.review_state === "reviewed").length,
    sources: sourceCount
  };
}

function buildSourceMetrics(
  sources: UserSource[],
  items: MetricItem[],
  latestRunsBySource: Map<string, LatestRun>
): SourceMetric[] {
  const stats = new Map<
    string,
    {
      snapshotCount: number;
      newCount: number;
      attentionCount: number;
      latestItemAt: string | null;
    }
  >();

  for (const item of items) {
    const stat =
      stats.get(item.source_id) ??
      {
        snapshotCount: 0,
        newCount: 0,
        attentionCount: 0,
        latestItemAt: null
      };
    stat.snapshotCount += 1;
    if (item.system_state === "new") {
      stat.newCount += 1;
    }
    if (item.review_state === "unreviewed" && item.disposition_state === "none") {
      stat.attentionCount += 1;
    }
    stat.latestItemAt = maxIsoDate(stat.latestItemAt, item.published_at ?? item.first_seen_at);
    stats.set(item.source_id, stat);
  }

  return sources.map((source) => {
    const stat = stats.get(source.source_id) ?? {
      snapshotCount: 0,
      newCount: 0,
      attentionCount: 0,
      latestItemAt: null
    };
    const latestRun = latestRunsBySource.get(source.source_id) ?? null;
    const runError = latestRun?.error_message ?? null;
    const lastFetchedAt =
      source.last_fetched_at ?? latestRun?.finished_at ?? latestRun?.started_at ?? null;
    const status =
      source.source_status !== source.user_source_status
        ? source.source_status
        : source.user_source_status;

    return {
      source,
      name: cleanText(source.display_name) ?? cleanText(source.source_name) ?? "Unknown source",
      status,
      tags: cleanTags(source.tags),
      fetchedCount: latestRun?.fetched_count ?? null,
      latestRunStatus: latestRun?.status ?? null,
      latestRunError: runError,
      snapshotCount: stat.snapshotCount,
      newCount: stat.newCount,
      attentionCount: stat.attentionCount,
      latestItemAt: stat.latestItemAt,
      lastFetchedAt,
      freshness: getFreshness(lastFetchedAt, latestRun?.status ?? null, source.last_error ?? runError)
    };
  });
}

function sortSourceMetrics(metrics: SourceMetric[], sort: SourceSort): SourceMetric[] {
  const multiplier = sort.direction === "asc" ? 1 : -1;

  return [...metrics].sort((a, b) => {
    let result = 0;
    if (sort.key === "source") {
      result = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    } else if (sort.key === "new") {
      result = a.newCount - b.newCount;
    } else if (sort.key === "attention") {
      result = a.attentionCount - b.attentionCount;
    } else if (sort.key === "snapshot") {
      result = a.snapshotCount - b.snapshotCount;
    } else if (sort.key === "fetched") {
      result = (a.fetchedCount ?? -1) - (b.fetchedCount ?? -1);
    } else if (sort.key === "latest") {
      result = compareIsoDate(a.latestItemAt, b.latestItemAt);
    } else if (sort.key === "freshness") {
      result = a.freshness.timestamp - b.freshness.timestamp;
    }

    if (result === 0) {
      return a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    }

    return result * multiplier;
  });
}

function filterItemsByView(
  itemsByView: Record<InboxView, InboxItem[]>,
  filters: ItemFilters
): Record<InboxView, InboxItem[]> {
  return {
    inbox: applyItemFilters(itemsByView.inbox, filters),
    saved: applyItemFilters(itemsByView.saved, filters),
    archived: applyItemFilters(itemsByView.archived, filters),
    hidden: applyItemFilters(itemsByView.hidden, filters),
    reviewed: applyItemFilters(itemsByView.reviewed, filters)
  };
}

function applyItemFilters(items: InboxItem[], filters: ItemFilters): InboxItem[] {
  return items.filter((item) => {
    if (filters.sourceId && item.source_id !== filters.sourceId) {
      return false;
    }
    if (filters.newOnly && item.system_state !== "new") {
      return false;
    }
    if (filters.unreviewedOnly && item.review_state !== "unreviewed") {
      return false;
    }
    return true;
  });
}

function cleanTags(tags: string[] | null): string[] {
  return (tags ?? [])
    .map((tag) => cleanText(tag))
    .filter((tag): tag is string => Boolean(tag));
}

function cleanText(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  const text = decodeHtmlEntities(String(value))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function trimSummary(value: string | null): string | null {
  if (!value || value.length <= SUMMARY_MAX_CHARS) {
    return value;
  }

  let trimmed = value.slice(0, SUMMARY_MAX_CHARS - 3).trimEnd();
  if (trimmed.includes(" ")) {
    trimmed = trimmed.slice(0, trimmed.lastIndexOf(" ")).trimEnd();
  }
  return `${trimmed}...`;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      decodeCodePoint(Number(codePoint), _)
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) =>
      decodeCodePoint(Number.parseInt(codePoint, 16), _)
    )
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity: string) => {
      const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        nbsp: " "
      };
      return entities[entity] ?? _;
    });
}

function decodeCodePoint(codePoint: number, fallback: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return fallback;
  }

  return String.fromCodePoint(codePoint);
}

function formatDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
}

function formatShortDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short"
  }).format(date);
}

function formatDisposition(value: Exclude<DispositionState, "none">): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDispositionAction(value: Exclude<DispositionState, "none">): string {
  const actions: Record<Exclude<DispositionState, "none">, string> = {
    saved: "Save",
    archived: "Archive",
    hidden: "Hide"
  };
  return actions[value];
}

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function parseView(value: string | undefined): InboxView {
  return VIEW_TABS.some((tab) => tab.key === value) ? (value as InboxView) : "inbox";
}

function parseFilters(
  searchParams: SearchParams | undefined,
  validSourceIds: Set<string>
): ItemFilters {
  const sourceId = searchParams?.source ?? "";
  return {
    sourceId: validSourceIds.has(sourceId) ? sourceId : "",
    newOnly: searchParams?.new === "1",
    unreviewedOnly: searchParams?.unreviewed === "1"
  };
}

function parseSourceSort(searchParams: SearchParams | undefined): SourceSort {
  const key = isSourceSortKey(searchParams?.sourceSort)
    ? searchParams.sourceSort
    : "new";
  const direction = searchParams?.sourceDir === "asc" ? "asc" : "desc";
  return { key, direction };
}

function isSourceSortKey(value: string | undefined): value is SourceSortKey {
  return SOURCE_COLUMNS.some((column) => column.key === value);
}

function nextSourceSort(current: SourceSort, key: SourceSortKey): SourceSort {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc"
    };
  }

  return {
    key,
    direction: key === "source" ? "asc" : "desc"
  };
}

function hasActiveFilters(filters: ItemFilters): boolean {
  return Boolean(filters.sourceId || filters.newOnly || filters.unreviewedOnly);
}

function buildHref({
  filters,
  sourceSort,
  view
}: {
  filters?: ItemFilters;
  sourceSort?: SourceSort;
  view?: InboxView;
}): string {
  const params = new URLSearchParams();
  if (view && view !== "inbox") {
    params.set("view", view);
  }
  if (filters?.sourceId) {
    params.set("source", filters.sourceId);
  }
  if (filters?.newOnly) {
    params.set("new", "1");
  }
  if (filters?.unreviewedOnly) {
    params.set("unreviewed", "1");
  }
  if (sourceSort) {
    params.set("sourceSort", sourceSort.key);
    params.set("sourceDir", sourceSort.direction);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function getFreshness(
  lastFetchedAt: string | null,
  latestRunStatus: LatestRun["status"] | null,
  error: string | null
): Freshness {
  if (latestRunStatus === "error" || error) {
    return {
      label: "Error",
      state: "error",
      timestamp: parseDateValue(lastFetchedAt)
    };
  }
  if (!lastFetchedAt) {
    return { label: "Never", state: "never", timestamp: 0 };
  }

  const timestamp = parseDateValue(lastFetchedAt);
  if (!timestamp) {
    return { label: "Unknown", state: "never", timestamp: 0 };
  }

  const diffMs = Date.now() - timestamp;
  const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  if (diffHours < 1) {
    return { label: "Just now", state: "fresh", timestamp };
  }
  if (diffHours < 24) {
    return { label: `${diffHours}h ago`, state: "fresh", timestamp };
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 3) {
    return { label: `${diffDays}d ago`, state: "aging", timestamp };
  }

  return { label: `${diffDays}d ago`, state: "stale", timestamp };
}

function parseDateValue(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function maxIsoDate(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return parseDateValue(candidate) > parseDateValue(current) ? candidate : current;
}

function compareIsoDate(a: string | null, b: string | null): number {
  return parseDateValue(a) - parseDateValue(b);
}
