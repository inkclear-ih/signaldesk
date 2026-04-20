import { Tags } from "./Tags";
import { RescanSourcesButton } from "./RescanSourcesButton";
import {
  addFeedSource,
  addInstagramSource,
  archiveSourceSubscription,
  disconnectInstagramConnection,
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
import { getInstagramHandleFromMetadata } from "@/lib/sources/instagram";
import type {
  InboxView,
  ItemFilters,
  ItemSort,
  SourceMetric,
  SourceSort,
  SourceSortKey,
  UserInstagramConnection,
  UserSource
} from "@/lib/inbox/types";
import type { FeedDiscoveryCandidate } from "@/lib/sources/discovery";
import type { SourceScanScope } from "@/lib/ingestion/scan";

type SourceDiscoveryState = {
  pageUrl: string;
  candidates: FeedDiscoveryCandidate[];
};

export function SourcesPanel({
  activeView,
  filters,
  inactiveSources,
  instagramConnection,
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
  instagramConnection: UserInstagramConnection | null;
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
  const webFeedMetrics = metrics.filter((metric) =>
    isWebFeedSource(metric.source)
  );
  const instagramMetrics = metrics.filter(
    (metric) => metric.source.source_type === "instagram"
  );
  const scannableSourceCount = getScannableMetricCount(metrics);
  const scannableWebFeedSourceCount = getScannableMetricCount(webFeedMetrics);
  const scannableInstagramSourceCount =
    getScannableMetricCount(instagramMetrics);
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
          <RescanSourcesButton disabled={scannableSourceCount === 0} />
        </form>
      </div>

      <div className="source-family-layout" aria-label="Source families">
        <section className="source-family-section">
          <div className="source-family-copy">
            <h3>Web and feed sources</h3>
            <p className="muted">
              RSS, Atom, and website feed discovery stay on the proven feed path.
            </p>
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
        </section>

        <section className="source-family-section source-family-instagram">
          <div className="source-family-copy">
            <h3>Instagram professional accounts</h3>
            <p className="muted">
              Add creator or professional account profiles. Monitoring uses
              your connected Instagram professional account; posting and DMs stay
              out of scope.
            </p>
          </div>
          <div className="instagram-source-tools">
            <InstagramConnectionPanel
              connection={instagramConnection}
              returnTo={currentHref}
            />
            <form className="add-source-form" action={addInstagramSource}>
              <input type="hidden" name="returnTo" value={currentHref} />
              <label className="filter-field">
                <span>Add Instagram account</span>
                <input
                  className="input"
                  name="instagramAccount"
                  placeholder="@studio or https://instagram.com/studio/"
                  required
                />
              </label>
              <button className="button button-compact" type="submit">
                Add account
              </button>
            </form>
          </div>
        </section>
      </div>

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

      <div className="source-family-heading">
        <div className="section-title">
          <h3>Web/feed sources</h3>
          <span className="section-count">({webFeedMetrics.length})</span>
        </div>
        <RescanScopeForm
          disabled={scannableWebFeedSourceCount === 0}
          label="Rescan Web/Feeds"
          returnTo={currentHref}
          scope="web_feed"
        />
      </div>

      {webFeedMetrics.length ? (
        <div className="source-table" role="table" aria-label="Web and feed source scan table">
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
            {webFeedMetrics.map((metric) => (
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
        <p className="muted source-family-empty">
          No active web/feed sources yet. Add a website URL to start.
        </p>
      )}

      <InstagramSourcesSection
        scannableSourceCount={scannableInstagramSourceCount}
        metrics={instagramMetrics}
        returnTo={currentHref}
      />

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

function InstagramConnectionPanel({
  connection,
  returnTo
}: {
  connection: UserInstagramConnection | null;
  returnTo: string;
}) {
  const connectHref = `/api/connections/instagram/start?returnTo=${encodeURIComponent(
    returnTo
  )}`;
  const isExpired = isConnectionExpired(connection?.token_expires_at ?? null);
  const isConnected = connection?.status === "connected" && !isExpired;
  const needsReconnect =
    connection?.status === "needs_reconnect" ||
    (connection?.status === "connected" && isExpired);
  const username =
    connection?.connected_username ??
    connection?.display_name?.replace(/^@/, "") ??
    null;
  const expiry = formatConnectionExpiry(connection?.token_expires_at ?? null);

  return (
    <div className="instagram-connection-panel">
      <div className="instagram-connection-copy">
        <span
          className={`status status-${
            isConnected ? "active" : needsReconnect ? "error" : "paused"
          }`}
        >
          {isConnected
            ? "Connected"
            : needsReconnect
              ? "Reconnect needed"
              : "Not connected"}
        </span>
        <p className="muted">
          {isConnected
            ? `Using ${username ? `@${username}` : "your connected account"}${
                expiry ? ` until ${expiry}` : ""
              }.`
            : needsReconnect
              ? "Reconnect Instagram before scanning professional account sources."
              : "Connect a Meta account that manages an Instagram professional account."}
        </p>
        {connection?.refresh_error ? (
          <span className="source-error">{connection.refresh_error}</span>
        ) : null}
      </div>
      <div className="instagram-connection-actions">
        <a className="button button-compact" href={connectHref}>
          {isConnected ? "Reconnect" : "Connect Instagram"}
        </a>
        {connection && connection.status !== "disconnected" ? (
          <form action={disconnectInstagramConnection}>
            <input type="hidden" name="returnTo" value={returnTo} />
            <button className="item-action" type="submit">
              Disconnect
            </button>
          </form>
        ) : null}
      </div>
    </div>
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
          title={getSourceReference(metric.source)}
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

function InstagramSourcesSection({
  metrics,
  returnTo,
  scannableSourceCount
}: {
  metrics: SourceMetric[];
  returnTo: string;
  scannableSourceCount: number;
}) {
  return (
    <section className="instagram-source-section" aria-labelledby="instagram-sources-heading">
      <div className="source-family-heading">
        <div className="section-title">
          <h3 id="instagram-sources-heading">Instagram professional accounts</h3>
          <span className="section-count">({metrics.length})</span>
        </div>
        <RescanScopeForm
          disabled={scannableSourceCount === 0}
          label="Rescan Instagram"
          returnTo={returnTo}
          scope="instagram"
        />
      </div>

      {metrics.length ? (
        <div className="instagram-source-list">
          {metrics.map((metric) => (
            <InstagramSourceRow
              key={metric.source.user_source_id}
              metric={metric}
              returnTo={returnTo}
            />
          ))}
        </div>
      ) : (
        <p className="muted source-family-empty">
          No Instagram accounts yet. Add a professional or creator profile handle
          to monitor account posts.
        </p>
      )}
    </section>
  );
}

function RescanScopeForm({
  disabled,
  label,
  returnTo,
  scope
}: {
  disabled: boolean;
  label: string;
  returnTo: string;
  scope: SourceScanScope;
}) {
  return (
    <form className="rescan-form source-family-rescan" action={rescanSources}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="scanScope" value={scope} />
      <RescanSourcesButton
        disabled={disabled}
        label={label}
        pendingLabel="Scanning..."
      />
    </form>
  );
}

function InstagramSourceRow({
  metric,
  returnTo
}: {
  metric: SourceMetric;
  returnTo: string;
}) {
  const handle =
    getInstagramHandleFromMetadata(metric.source.metadata) ??
    metric.name.replace(/^@/, "");
  const error = metric.latestRunError || metric.source.last_error;

  return (
    <div className="instagram-source-row">
      <div className="instagram-source-primary">
        <a
          className="source-name"
          href={metric.source.source_url}
          rel="noreferrer"
          target="_blank"
          title={metric.source.source_url}
        >
          @{handle}
        </a>
        <span className="source-meta">
          <span className="status status-instagram">Instagram</span>
          <span className={`status status-${metric.status}`}>
            {formatStatus(metric.status)}
          </span>
          {metric.latestRunStatus ? (
            <span className={`status status-${metric.latestRunStatus}`}>
              run {formatStatus(metric.latestRunStatus)}
            </span>
          ) : null}
        </span>
        <p className="muted instagram-source-note">
          Account posts flow through Instagram Graph API professional account
          discovery when the account and workspace token allow access.
        </p>
        {error ? <span className="source-error">Last error: {error}</span> : null}
      </div>
      <div className="instagram-source-state">
        <span>{metric.fetchedCount ?? 0} fetched</span>
        <span>{metric.newCount} new</span>
        <span className={`freshness freshness-${metric.freshness.state}`}>
          {metric.freshness.label}
        </span>
        <SourceActions returnTo={returnTo} source={metric.source} />
      </div>
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
        <span className="source-name" title={getSourceReference(source)}>
          {getSourceName(source)}
        </span>
        <span className="source-meta">
          <span className="status status-source-type">
            {formatSourceType(source)}
          </span>
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

function getSourceReference(source: UserSource): string {
  return source.feed_url ?? source.source_url;
}

function isWebFeedSource(source: UserSource): boolean {
  return source.source_type === "rss" || source.source_type === "atom";
}

function getScannableMetricCount(metrics: SourceMetric[]): number {
  return metrics.filter(
    (metric) =>
      metric.source.source_status === "active" ||
      metric.source.source_status === "validating"
  ).length;
}

function formatSourceType(source: UserSource): string {
  if (source.source_type === "instagram") {
    return "Instagram";
  }

  return source.source_type.toUpperCase();
}

function formatConnectionExpiry(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function isConnectionExpired(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && timestamp <= Date.now();
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
