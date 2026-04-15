import { Tags } from "./Tags";
import { RescanSourcesButton } from "./RescanSourcesButton";
import {
  addFeedSource,
  archiveSourceSubscription,
  discoverWebsiteFeeds,
  pauseSourceSubscription,
  rescanSources,
  resumeSourceSubscription
} from "@/app/actions";
import { formatShortDate, formatStatus } from "@/lib/inbox/formatting";
import { buildHref } from "@/lib/inbox/navigation";
import {
  nextSourceSort,
  SOURCE_COLUMNS,
  summarizeSources
} from "@/lib/inbox/source-table";
import type {
  InboxView,
  ItemFilters,
  ItemSort,
  SourceMetric,
  SourceSort,
  SourceSortKey,
  UserSource
} from "@/lib/inbox/types";
import type { FeedDiscoveryCandidate } from "@/lib/sources/discovery";

type SourceDiscoveryState = {
  pageUrl: string;
  candidates: FeedDiscoveryCandidate[];
};

export function SourcesPanel({
  activeView,
  filters,
  inactiveSources,
  itemSort,
  metrics,
  sourceError,
  sourceMessage,
  sourceDiscovery,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  inactiveSources: UserSource[];
  itemSort: ItemSort;
  metrics: SourceMetric[];
  sourceError?: string;
  sourceMessage?: string;
  sourceDiscovery?: string;
  sourceSort: SourceSort;
}) {
  const { sourcesWithNew, staleSources, sourcesWithErrors } =
    summarizeSources(metrics);
  const currentHref = buildHref({ view: activeView, filters, itemSort, sourceSort });
  const sortedInactiveSources = [...inactiveSources].sort((a, b) =>
    getSourceName(a).localeCompare(getSourceName(b), undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );
  const discovery = parseSourceDiscovery(sourceDiscovery);

  return (
    <section className="panel sources-panel" aria-labelledby="sources-heading">
      <div className="section-header section-header-panel">
        <div className="section-title">
          <h2 id="sources-heading">Sources</h2>
          <span className="section-count">({metrics.length})</span>
        </div>
        <form className="rescan-form" action={rescanSources}>
          <input type="hidden" name="returnTo" value={currentHref} />
          <RescanSourcesButton disabled={metrics.length === 0} />
        </form>
      </div>

      <form className="add-source-form" action={discoverWebsiteFeeds}>
        <input type="hidden" name="returnTo" value={currentHref} />
        <label className="filter-field">
          <span>Add a website</span>
          <input
            className="input"
            inputMode="url"
            name="websiteUrl"
            placeholder="https://example.com/blog"
            required
          />
        </label>
        <button className="button button-compact" type="submit">
          Find feeds
        </button>
      </form>

      {discovery ? (
        <FeedCandidateChooser discovery={discovery} returnTo={currentHref} />
      ) : null}

      {sourceMessage ? (
        <p className="source-feedback source-feedback-ok">{sourceMessage}</p>
      ) : null}
      {sourceError ? (
        <p className="source-feedback source-feedback-error">{sourceError}</p>
      ) : null}

      <details className="advanced-source-form">
        <summary>Advanced: paste a feed URL</summary>
        <form className="feed-url-form" action={addFeedSource}>
          <input type="hidden" name="returnTo" value={currentHref} />
          <label className="filter-field">
            <span>RSS or Atom feed URL</span>
            <input
              className="input"
              name="feedUrl"
              type="url"
              placeholder="https://example.com/feed.xml"
              required
            />
          </label>
          <button className="button button-secondary button-compact" type="submit">
            Add feed
          </button>
        </form>
      </details>

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
                    itemSort,
                    sourceSort: nextSourceSort(sourceSort, column.key)
                  })}
                >
                  {column.label}
                  <SortArrow sourceSort={sourceSort} columnKey={column.key} />
                </a>
              </span>
            ))}
            <span className="source-actions" role="columnheader">
              Actions
            </span>
          </div>
          <div className="source-body" role="rowgroup">
            {metrics.map((metric) => (
              <SourceRow
                activeView={activeView}
                filters={filters}
                itemSort={itemSort}
                key={metric.source.user_source_id}
                metric={metric}
                returnTo={currentHref}
                sourceSort={sourceSort}
              />
            ))}
          </div>
        </div>
      ) : (
        <p className="muted">No active sources yet. Add a website URL to start.</p>
      )}

      {sortedInactiveSources.length ? (
        <div className="inactive-sources" aria-label="Paused and archived sources">
          <h3>Paused and archived</h3>
          <div className="inactive-source-list">
            {sortedInactiveSources.map((source) => (
              <InactiveSourceRow
                key={source.user_source_id}
                returnTo={currentHref}
                source={source}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FeedCandidateChooser({
  discovery,
  returnTo
}: {
  discovery: SourceDiscoveryState;
  returnTo: string;
}) {
  const candidateCount = discovery.candidates.length;
  const heading =
    candidateCount === 1
      ? "One feed found"
      : `${candidateCount} feeds found`;

  return (
    <div className="feed-candidates" aria-label="Discovered feed candidates">
      <div className="feed-candidates-header">
        <div>
          <h3>{heading}</h3>
          <p className="muted">{discovery.pageUrl}</p>
        </div>
      </div>
      <div className="feed-candidate-list">
        {discovery.candidates.map((candidate) => (
          <form
            className="feed-candidate-row"
            action={addFeedSource}
            key={candidate.feedUrl}
          >
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="feedUrl" value={candidate.feedUrl} />
            <div className="feed-candidate-primary">
              <span className="source-name">
                {candidate.discoveryTitle || candidate.name}
              </span>
              <span className="source-meta">
                <span className="status status-active">
                  {candidate.type.toUpperCase()}
                </span>
                <span className="source-feed-url">{candidate.feedUrl}</span>
              </span>
            </div>
            <button className="item-action item-action-primary" type="submit">
              Subscribe
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}

function SourceRow({
  activeView,
  filters,
  itemSort,
  metric,
  returnTo,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  itemSort: ItemSort;
  metric: SourceMetric;
  returnTo: string;
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
            itemSort,
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
        <span
          className={
            metric.newCount > 0 ? "source-new-count active" : "source-new-count"
          }
        >
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
      <SourceActions returnTo={returnTo} source={metric.source} />
    </div>
  );
}

function InactiveSourceRow({
  returnTo,
  source
}: {
  returnTo: string;
  source: UserSource;
}) {
  return (
    <div className="inactive-source-row">
      <div className="inactive-source-primary">
        <span className="source-name" title={source.feed_url}>
          {getSourceName(source)}
        </span>
        <span className="source-meta">
          <span className={`status status-${source.user_source_status}`}>
            {formatStatus(source.user_source_status)}
          </span>
          {source.source_status !== "active" ? (
            <span className={`status status-${source.source_status}`}>
              catalog {formatStatus(source.source_status)}
            </span>
          ) : null}
        </span>
      </div>
      <SourceActions returnTo={returnTo} source={source} />
    </div>
  );
}

function SourceActions({
  returnTo,
  source
}: {
  returnTo: string;
  source: UserSource;
}) {
  if (source.user_source_status === "active") {
    return (
      <span className="source-actions" role="cell">
        <SourceActionForm
          action={pauseSourceSubscription}
          label="Pause"
          returnTo={returnTo}
          userSourceId={source.user_source_id}
        />
        <SourceActionForm
          action={archiveSourceSubscription}
          label="Archive"
          returnTo={returnTo}
          userSourceId={source.user_source_id}
        />
      </span>
    );
  }

  return (
    <span className="source-actions" role="cell">
      <SourceActionForm
        action={resumeSourceSubscription}
        label={source.user_source_status === "archived" ? "Restore" : "Resume"}
        returnTo={returnTo}
        userSourceId={source.user_source_id}
      />
      {source.user_source_status === "paused" ? (
        <SourceActionForm
          action={archiveSourceSubscription}
          label="Archive"
          returnTo={returnTo}
          userSourceId={source.user_source_id}
        />
      ) : null}
    </span>
  );
}

function SourceActionForm({
  action,
  label,
  returnTo,
  userSourceId
}: {
  action: (formData: FormData) => void | Promise<void>;
  label: string;
  returnTo: string;
  userSourceId: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="userSourceId" value={userSourceId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button className="item-action" type="submit">
        {label}
      </button>
    </form>
  );
}

function getSourceName(source: UserSource): string {
  return source.display_name || source.source_name || "Unknown source";
}

function parseSourceDiscovery(value: string | undefined): SourceDiscoveryState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SourceDiscoveryState>;
    if (!parsed.pageUrl || !Array.isArray(parsed.candidates)) {
      return null;
    }

    const candidates = parsed.candidates.filter(isFeedDiscoveryCandidate);
    if (!candidates.length) {
      return null;
    }

    return {
      pageUrl: parsed.pageUrl,
      candidates
    };
  } catch {
    return null;
  }
}

function isFeedDiscoveryCandidate(
  value: unknown
): value is FeedDiscoveryCandidate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<FeedDiscoveryCandidate>;
  return (
    typeof candidate.feedUrl === "string" &&
    typeof candidate.name === "string" &&
    (candidate.type === "rss" || candidate.type === "atom") &&
    (candidate.siteUrl === null || typeof candidate.siteUrl === "string") &&
    (candidate.discoveryTitle === null ||
      typeof candidate.discoveryTitle === "string") &&
    (candidate.source === "html" ||
      candidate.source === "fallback" ||
      candidate.source === "direct")
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
