import { InboxOverview } from "@/components/inbox/InboxOverview";
import { ItemFilters } from "@/components/inbox/ItemFilters";
import { ItemsView } from "@/components/inbox/ItemsView";
import { SourcesPanel } from "@/components/inbox/SourcesPanel";
import { TabsNav } from "@/components/inbox/TabsNav";
import { signIn, signOut } from "./actions";
import { ITEM_LIMIT, METRIC_ITEM_LIMIT } from "@/lib/inbox/constants";
import { cleanTags } from "@/lib/inbox/formatting";
import {
  filterItemsByView,
  hasActiveFilters,
  parseFilters
} from "@/lib/inbox/filters";
import { parseItemSort, sortItems } from "@/lib/inbox/item-sort";
import { buildSourceMetrics, buildTopMetrics, getLatestRunsBySource } from "@/lib/inbox/metrics";
import { buildHref, parseView } from "@/lib/inbox/navigation";
import { parseSourceSort, sortSourceMetrics } from "@/lib/inbox/source-table";
import type {
  InboxItem,
  ItemsByView,
  MetricItem,
  SearchParams,
  UserInstagramConnection,
  UserSource
} from "@/lib/inbox/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const itemSort = parseItemSort(searchParams);
  const sourceSort = parseSourceSort(searchParams);
  const [
    { data: newInboxItemsData },
    { data: knownInboxItemsData },
    { data: savedItems },
    { data: archivedItems },
    { data: hiddenItems },
    { data: reviewedItems },
    { data: sources },
    { data: instagramConnection },
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
      .eq("system_state", "new")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "none")
      .eq("review_state", "unreviewed")
      .eq("system_state", "known")
      .order("became_known_at", { ascending: false, nullsFirst: false })
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
      .from("current_user_instagram_connections")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
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

  const inboxItems = [
    ...((newInboxItemsData ?? []) as InboxItem[]),
    ...((knownInboxItemsData ?? []) as InboxItem[])
  ];
  const itemsByView: ItemsByView = {
    inbox: inboxItems,
    saved: (savedItems ?? []) as InboxItem[],
    archived: (archivedItems ?? []) as InboxItem[],
    hidden: (hiddenItems ?? []) as InboxItem[],
    reviewed: (reviewedItems ?? []) as InboxItem[]
  };
  const typedSources = (sources ?? []) as UserSource[];
  const activeSources = typedSources.filter(
    (source) => source.user_source_status === "active"
  );
  const inactiveSources = typedSources.filter(
    (source) => source.user_source_status !== "active"
  );
  const metricItemsList = (metricItems ?? []) as MetricItem[];
  const sourceIds = new Set(activeSources.map((source) => source.source_id));
  const filters = parseFilters(searchParams, sourceIds);
  const latestRunsBySource = await getLatestRunsBySource(
    supabase,
    activeSources.map((source) => source.source_id)
  );
  const sourceMetrics = sortSourceMetrics(
    buildSourceMetrics(activeSources, metricItemsList, latestRunsBySource),
    sourceSort
  );
  const sourceTags = new Map(
    activeSources.map((source) => [source.source_id, cleanTags(source.tags)])
  );
  const filteredItemsByView = filterItemsByView(itemsByView, filters);
  const sortedItemsByView: ItemsByView = {
    inbox: sortItems(filteredItemsByView.inbox, itemSort),
    saved: sortItems(filteredItemsByView.saved, itemSort),
    archived: sortItems(filteredItemsByView.archived, itemSort),
    hidden: sortItems(filteredItemsByView.hidden, itemSort),
    reviewed: sortItems(filteredItemsByView.reviewed, itemSort)
  };
  const activeItems = sortedItemsByView[activeView];
  const newInboxItems = sortedItemsByView.inbox.filter(
    (item) => item.system_state === "new"
  );
  const knownInboxItems = sortedItemsByView.inbox.filter(
    (item) => item.system_state === "known"
  );
  const filtersActive = hasActiveFilters(filters);
  const currentHref = buildHref({
    view: activeView,
    filters,
    itemSort,
    sourceSort
  });
  const topMetrics = buildTopMetrics(
    metricItemsList,
    activeSources.length,
    totalItemCount ?? metricItemsList.length,
    newItemCount,
    attentionItemCount,
    reviewedItemCount
  );

  return (
    <main className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <span className="eyebrow">Signaldesk v2 bootstrap</span>
          </div>
          <h1>Inbox</h1>
          <p className="muted">{user.email}</p>
        </div>
        <form action={signOut}>
          <button className="button button-secondary" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <TabsNav
        activeView={activeView}
        filters={filters}
        itemSort={itemSort}
        itemsByView={itemsByView}
        sourceSort={sourceSort}
      />

      <InboxOverview metrics={topMetrics} />

      <SourcesPanel
        activeView={activeView}
        allowInstagramBootstrap={process.env.ALLOW_INSTAGRAM_BOOTSTRAP === "true"}
        filters={filters}
        inactiveSources={inactiveSources}
        instagramConnection={
          (instagramConnection as UserInstagramConnection | null) ?? null
        }
        itemSort={itemSort}
        metrics={sourceMetrics}
        sourceError={searchParams?.sourceError}
        sourceDiscovery={searchParams?.sourceDiscovery}
        sourceMessage={searchParams?.sourceMessage}
        sourceSort={sourceSort}
      />

      <ItemFilters
        activeView={activeView}
        filters={filters}
        filtersActive={filtersActive}
        itemSort={itemSort}
        shownCount={activeItems.length}
        sourceMetrics={sourceMetrics}
        sourceSort={sourceSort}
        totalCount={itemsByView[activeView].length}
      />

      <ItemsView
        activeItems={activeItems}
        activeView={activeView}
        filtersActive={filtersActive}
        itemSort={itemSort}
        knownInboxItems={knownInboxItems}
        newInboxItems={newInboxItems}
        returnTo={currentHref}
        sourceTags={sourceTags}
      />
    </main>
  );
}
function SignedOut({ sent, error }: Pick<SearchParams, "sent" | "error">) {
  return (
    <main className="page">
      <section className="panel">
        <div className="brand">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <span className="eyebrow">Signaldesk v2 bootstrap</span>
          </div>
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
