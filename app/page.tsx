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
};

type DispositionState = "none" | "saved" | "archived" | "hidden";
type InboxView = "inbox" | "saved" | "archived" | "hidden" | "reviewed";

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

const SUMMARY_MAX_CHARS = 360;
const ITEM_LIMIT = 100;

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
  const [
    { data: inboxItems },
    { data: savedItems },
    { data: archivedItems },
    { data: hiddenItems },
    { data: reviewedItems },
    { data: sources }
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
      .order("system_state_rank", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "archived")
      .order("system_state_rank", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "hidden")
      .order("system_state_rank", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_items")
      .select("*")
      .eq("disposition_state", "none")
      .eq("review_state", "reviewed")
      .order("system_state_rank", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(ITEM_LIMIT),
    supabase
      .from("current_user_sources")
      .select("*")
      .order("source_name", { ascending: true })
  ]);

  const itemsByView: Record<InboxView, InboxItem[]> = {
    inbox: (inboxItems ?? []) as InboxItem[],
    saved: (savedItems ?? []) as InboxItem[],
    archived: (archivedItems ?? []) as InboxItem[],
    hidden: (hiddenItems ?? []) as InboxItem[],
    reviewed: (reviewedItems ?? []) as InboxItem[]
  };
  const typedSources = (sources ?? []) as UserSource[];
  const sourceTags = new Map(
    typedSources.map((source) => [source.source_id, cleanTags(source.tags)])
  );
  const newInboxItems = itemsByView.inbox.filter(
    (item) => item.system_state === "new"
  );
  const knownInboxItems = itemsByView.inbox.filter(
    (item) => item.system_state === "known"
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
            href={viewHref(tab.key)}
            key={tab.key}
          >
            <span>{tab.label}</span>
            <span className="view-count">{itemsByView[tab.key].length}</span>
          </a>
        ))}
      </nav>

      <div className="grid">
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
              />
              <ItemSection
                title="Known, still unreviewed"
                items={knownInboxItems}
                emptyMessage="Known items are clear."
                sourceTags={sourceTags}
                activeView={activeView}
              />
            </div>
          ) : (
            <div className="item-sections item-sections-single">
              <ItemSection
                title={VIEW_DETAILS[activeView].title}
                items={itemsByView[activeView]}
                emptyMessage={VIEW_DETAILS[activeView].emptyMessage}
                sourceTags={sourceTags}
                activeView={activeView}
              />
            </div>
          )}
        </section>

        <aside className="panel" aria-labelledby="sources-heading">
          <div className="section-header section-header-panel">
            <h2 id="sources-heading">Sources</h2>
            <span className="section-count">({typedSources.length})</span>
          </div>
          <div className="source-list">
            {typedSources.length ? (
              typedSources.map((source) => (
                <div className="source" key={source.user_source_id}>
                  <p className="source-name">
                    {source.display_name || source.source_name}
                  </p>
                  <div className="source-meta">
                    <span className="status">
                      {formatStatus(source.user_source_status)}
                    </span>
                    {source.source_status !== source.user_source_status ? (
                      <span>Source {formatStatus(source.source_status)}</span>
                    ) : null}
                  </div>
                  {source.tags?.length ? <Tags tags={source.tags} /> : null}
                  <p className="source-url">{source.feed_url}</p>
                  {source.last_error ? (
                    <p className="source-error">Last error: {source.last_error}</p>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="muted">No sources seeded for this user yet.</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function ItemSection({
  title,
  items,
  emptyMessage,
  sourceTags,
  activeView
}: {
  title: string;
  items: InboxItem[];
  emptyMessage: string;
  sourceTags: Map<string, string[]>;
  activeView: InboxView;
}) {
  const headingId = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-heading`;

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
            />
          ))}
        </div>
      ) : (
        <p className="empty">{emptyMessage}</p>
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
  activeView
}: {
  item: InboxItem;
  tags: string[];
  activeView: InboxView;
}) {
  const reviewed = item.review_state === "reviewed";
  const reviewAction = reviewed ? markItemUnreviewed : markItemReviewed;
  const reviewActionLabel = reviewed ? "Mark unreviewed" : "Mark reviewed";
  const title = cleanText(item.title) ?? item.link ?? "Untitled item";
  const summary = trimSummary(cleanText(item.summary));
  const publishedDate = formatDate(item.published_at);

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
        <ItemActionForm action={reviewAction} activeView={activeView} itemId={item.id}>
          {reviewActionLabel}
        </ItemActionForm>
        {item.disposition_state === "none" ? (
          <>
            <DispositionAction
              activeView={activeView}
              disposition="saved"
              itemId={item.id}
            />
            <DispositionAction
              activeView={activeView}
              disposition="archived"
              itemId={item.id}
            />
            <DispositionAction
              activeView={activeView}
              disposition="hidden"
              itemId={item.id}
            />
          </>
        ) : (
          <>
            <ItemActionForm
              action={clearItemDisposition}
              activeView={activeView}
              itemId={item.id}
            >
              Clear {item.disposition_state}
            </ItemActionForm>
            <ItemActionForm
              action={restoreItemToInbox}
              activeView={activeView}
              itemId={item.id}
              primary
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
  itemId
}: {
  activeView: InboxView;
  disposition: Exclude<DispositionState, "none">;
  itemId: string;
}) {
  return (
    <ItemActionForm
      action={setItemDisposition}
      activeView={activeView}
      itemId={itemId}
      name="disposition"
      value={disposition}
    >
      {formatDisposition(disposition)}
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
  value
}: {
  action: (formData: FormData) => Promise<void>;
  activeView: InboxView;
  children: ReactNode;
  itemId: string;
  name?: string;
  primary?: boolean;
  value?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="view" value={activeView} />
      {name && value ? <input type="hidden" name={name} value={value} /> : null}
      <button className={primary ? "item-action item-action-primary" : "item-action"} type="submit">
        {children}
      </button>
    </form>
  );
}

function Tags({ tags }: { tags: string[] }) {
  const cleanedTags = cleanTags(tags);
  if (!cleanedTags.length) {
    return null;
  }

  return (
    <div className="tags">
      {cleanedTags.map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  );
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

function formatDisposition(value: Exclude<DispositionState, "none">): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function parseView(value: string | undefined): InboxView {
  return VIEW_TABS.some((tab) => tab.key === value) ? (value as InboxView) : "inbox";
}

function viewHref(view: InboxView): string {
  return view === "inbox" ? "/" : `/?view=${view}`;
}
