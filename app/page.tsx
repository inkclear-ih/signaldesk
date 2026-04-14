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
  display_name: string | null;
  user_source_status: string;
  tags: string[] | null;
  source_name: string;
  feed_url: string;
  source_status: string;
  last_fetched_at: string | null;
  last_error: string | null;
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
        <section className="stack" aria-labelledby="unreviewed-heading">
          <h2 id="unreviewed-heading">Needs review</h2>
          {unreviewedItems.length ? (
            unreviewedItems.map((item) => (
              <ItemCard key={item.id} item={item} reviewed={false} />
            ))
          ) : (
            <p className="empty">No unreviewed items from active sources.</p>
          )}

          <h2>Reviewed</h2>
          {reviewedItems.length ? (
            reviewedItems.map((item) => (
              <ItemCard key={item.id} item={item} reviewed={true} />
            ))
          ) : (
            <p className="empty">Reviewed items will appear here.</p>
          )}
        </section>

        <aside className="panel" aria-labelledby="sources-heading">
          <h2 id="sources-heading">Sources</h2>
          <div className="source-list">
            {((sources ?? []) as UserSource[]).length ? (
              ((sources ?? []) as UserSource[]).map((source) => (
                <div className="source" key={source.user_source_id}>
                  <p className="source-name">
                    {source.display_name || source.source_name}
                  </p>
                  <p className="muted">{source.user_source_status}</p>
                  <p className="muted">{source.feed_url}</p>
                  {source.last_error ? (
                    <p className="muted">Last error: {source.last_error}</p>
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

function ItemCard({ item, reviewed }: { item: InboxItem; reviewed: boolean }) {
  const action = reviewed ? markItemUnreviewed : markItemReviewed;
  const actionLabel = reviewed ? "Mark unreviewed" : "Mark reviewed";

  return (
    <article className="item">
      <div className="item-head">
        <div className="stack">
          <div className="meta">
            <span
              className={
                item.system_state === "new" ? "badge" : "badge badge-known"
              }
            >
              {item.system_state === "new" ? "New" : "Known"}
            </span>
            <span>{item.source_name}</span>
            {item.published_at ? (
              <time dateTime={item.published_at}>
                {new Date(item.published_at).toLocaleDateString()}
              </time>
            ) : null}
          </div>
          {item.link ? (
            <a className="item-title" href={item.link} target="_blank">
              {item.title || item.link}
            </a>
          ) : (
            <h3 className="item-title">{item.title || "Untitled item"}</h3>
          )}
        </div>
        <form action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <button className="button button-secondary" type="submit">
            {actionLabel}
          </button>
        </form>
      </div>
      {item.summary ? <p className="summary">{item.summary}</p> : null}
    </article>
  );
}
