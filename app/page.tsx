import {
  markItemReviewed,
  markItemUnreviewed,
  signIn,
  signOut
} from "./actions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type SearchParams = {
  sent?: string;
  error?: string;
};

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

  const [{ data: items }, { data: sources }] = await Promise.all([
    supabase
      .from("current_user_items")
      .select("*")
      .order("system_state_rank", { ascending: true })
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("first_seen_at", { ascending: false })
      .limit(100),
    supabase
      .from("current_user_sources")
      .select("*")
      .order("source_name", { ascending: true })
  ]);

  const typedItems = (items ?? []) as InboxItem[];
  const typedSources = (sources ?? []) as UserSource[];
  const sourceTags = new Map(
    typedSources.map((source) => [source.source_id, cleanTags(source.tags)])
  );
  const unreviewedItems = typedItems.filter(
    (item) => item.review_state === "unreviewed"
  );
  const reviewedItems = typedItems.filter(
    (item) => item.review_state === "reviewed"
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

      <div className="grid">
        <section className="inbox" aria-label="Inbox items">
          <div className="item-sections">
            <ItemSection
              title="Needs review"
              items={unreviewedItems}
              reviewed={false}
              emptyMessage="No unreviewed items from active sources."
              sourceTags={sourceTags}
            />
            <ItemSection
              title="Reviewed"
              items={reviewedItems}
              reviewed={true}
              emptyMessage="Reviewed items will appear here."
              sourceTags={sourceTags}
            />
          </div>
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
  reviewed,
  emptyMessage,
  sourceTags
}: {
  title: string;
  items: InboxItem[];
  reviewed: boolean;
  emptyMessage: string;
  sourceTags: Map<string, string[]>;
}) {
  const headingId = `${title.toLowerCase().replace(/\s+/g, "-")}-heading`;

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
              reviewed={reviewed}
              tags={sourceTags.get(item.source_id) ?? []}
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
  reviewed,
  tags
}: {
  item: InboxItem;
  reviewed: boolean;
  tags: string[];
}) {
  const action = reviewed ? markItemUnreviewed : markItemReviewed;
  const actionLabel = reviewed ? "Mark unreviewed" : "Mark reviewed";
  const title = cleanText(item.title) ?? item.link ?? "Untitled item";
  const summary = trimSummary(cleanText(item.summary));
  const publishedDate = formatDate(item.published_at);

  return (
    <article className={item.system_state === "new" ? "item item-new" : "item"}>
      <div className="item-source">{item.source_name}</div>
      {item.link ? (
        <a className="item-title" href={item.link} target="_blank">
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
        <form action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <button className="review-toggle" type="submit">
            {actionLabel}
          </button>
        </form>
      </div>
    </article>
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

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}
