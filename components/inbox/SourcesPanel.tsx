import { Tags } from "./Tags";
import { RescanSourcesButton } from "./RescanSourcesButton";
import { SourceTagEditor } from "./SourceTagEditor";
import { SourceTagFilterForm } from "./SourceTagFilterForm";
import {
  addFeedSource,
  addInstagramSource,
  archiveSourceSubscription,
  bootstrapInstagramConnection,
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
  ScanState,
  SourceMetric,
  SourceSort,
  SourceSortKey,
  SourceTag,
  UserInstagramConnection,
  UserSource
} from "@/lib/inbox/types";
import type { FeedDiscoveryCandidate } from "@/lib/sources/discovery";
import type { SourceScanScope } from "@/lib/ingestion/scan";

type SourceDiscoveryState = {
  pageUrl: string;
  candidates: FeedDiscoveryCandidate[];
};

type ScanStatusSummary = {
  label: string;
  state: ScanState | "idle";
  activeRunCount: number;
  sourceCount: number;
  timestamp: string | null;
  detail: string;
};

function CollapsibleSourceFamilySection({
  children,
  className,
  count,
  rescanControl,
  title
}: {
  children: React.ReactNode;
  className?: string;
  count: number;
  rescanControl?: React.ReactNode;
  title: string;
}) {
  return (
    <details
      className={`advanced-source-form source-family-details${className ? ` ${className}` : ""}`}
      open
    >
      <summary>
        <span className="section-title">
          <span className="source-family-summary-label">{title}</span>
          <span className="section-count">({count})</span>
        </span>
      </summary>
      {rescanControl ? (
        <div className="source-family-heading-actions">{rescanControl}</div>
      ) : null}
      <div className="source-family-details-body">
        {children}
      </div>
    </details>
  );
}

export function SourcesPanel({
  activeView,
  filters,
  inactiveSources,
  instagramConnection,
  itemSort,
  metrics,
  sourceTags,
  sourceError,
  sourceMessage,
  sourceDiscovery,
  sourceSort,
  allowInstagramBootstrap
}: {
  activeView: InboxView;
  allowInstagramBootstrap: boolean;
  filters: ItemFilters;
  inactiveSources: UserSource[];
  instagramConnection: UserInstagramConnection | null;
  itemSort: ItemSort;
  metrics: SourceMetric[];
  sourceTags: SourceTag[];
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
  const runningMetrics = metrics.filter(
    (metric) => metric.latestScanState === "running"
  );
  const overallScanSummary = buildScanStatusSummary("All sources", metrics);
  const webFeedScanSummary = buildScanStatusSummary("Web/feed", webFeedMetrics);
  const instagramScanSummary = buildScanStatusSummary("Instagram", instagramMetrics);

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
              allowBootstrap={allowInstagramBootstrap}
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
      <div className="scan-status-strip" aria-label="Scan status">
        <ScanStatusCard summary={overallScanSummary} />
        <ScanStatusCard summary={webFeedScanSummary} />
        <ScanStatusCard summary={instagramScanSummary} />
      </div>
      {runningMetrics.length ? <ScanRunningBanner metrics={runningMetrics} /> : null}

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

      <SourceTagFilterForm
        activeView={activeView}
        filters={filters}
        itemSort={itemSort}
        sourceSort={sourceSort}
        sourceTags={sourceTags}
      />

      <CollapsibleSourceFamilySection
        count={webFeedMetrics.length}
        rescanControl={
          <RescanScopeForm
            disabled={scannableWebFeedSourceCount === 0}
            label="Rescan Web/Feeds"
            returnTo={currentHref}
            scope="web_feed"
          />
        }
        title="Web/feed sources"
      >
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
                  sourceTags={sourceTags}
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
      </CollapsibleSourceFamilySection>

      <InstagramSourcesSection
        scannableSourceCount={scannableInstagramSourceCount}
        metrics={instagramMetrics}
        returnTo={currentHref}
        sourceTags={sourceTags}
      />

      {sortedInactiveSources.length ? (
        <CollapsibleSourceFamilySection
          count={sortedInactiveSources.length}
          title="Paused and archived"
        >
          <div className="inactive-sources" aria-label="Paused and archived sources">
            <div className="inactive-source-list">
              {sortedInactiveSources.map((source) => (
                <InactiveSourceRow
                  key={source.user_source_id}
                  returnTo={currentHref}
                  source={source}
                  sourceTags={sourceTags}
                />
              ))}
            </div>
          </div>
        </CollapsibleSourceFamilySection>
      ) : null}
    </section>
  );
}

function InstagramConnectionPanel({
  allowBootstrap,
  connection,
  returnTo
}: {
  allowBootstrap: boolean;
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
      {allowBootstrap ? (
        <form className="instagram-bootstrap-form" action={bootstrapInstagramConnection}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <label className="filter-field">
            <span>Temporary bootstrap</span>
            <input
              className="input"
              name="instagramBootstrapAccount"
              placeholder="@known_account or IG account id"
              required
            />
          </label>
          <button className="button button-secondary button-compact" type="submit">
            Bootstrap connect
          </button>
          <p className="muted">
            Dev fallback: validates with the configured Instagram Graph token and
            saves this user connection without /me/accounts.
          </p>
        </form>
      ) : null}
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
  sourceTags,
  sourceSort
}: {
  activeView: InboxView;
  filters: ItemFilters;
  itemSort: ItemSort;
  metric: SourceMetric;
  returnTo: string;
  sourceTags: SourceTag[];
  sourceSort: SourceSort;
}) {
  const rowClasses = ["source-row"];
  if (metric.newCount > 0) {
    rowClasses.push("source-row-new");
  }
  if (metric.freshness.state === "stale" || metric.freshness.state === "never") {
    rowClasses.push("source-row-stale");
  }
  if (metric.latestScanState === "error" || metric.source.last_error) {
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
          {metric.latestScanState ? (
            <span className={`status status-${metric.latestScanState}`}>
              {getScanStateLabel(metric.latestScanState)}
            </span>
          ) : null}
        </span>
        {metric.tags.length ? <Tags tags={metric.tags} compact /> : null}
        <SourceTagEditor
          returnTo={returnTo}
          source={metric.source}
          sourceTags={sourceTags}
        />
        {metric.latestScanState ? (
          <span className="source-scan-detail">
            {getScanStateDetail(metric)}
          </span>
        ) : null}
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
  scannableSourceCount,
  sourceTags
}: {
  metrics: SourceMetric[];
  returnTo: string;
  scannableSourceCount: number;
  sourceTags: SourceTag[];
}) {
  return (
    <CollapsibleSourceFamilySection
      className="instagram-source-section"
      count={metrics.length}
      rescanControl={
        <RescanScopeForm
          disabled={scannableSourceCount === 0}
          label="Rescan Instagram"
          returnTo={returnTo}
          scope="instagram"
        />
      }
      title="Instagram professional accounts"
    >
      {metrics.length ? (
        <div className="instagram-source-list">
          {metrics.map((metric) => (
            <InstagramSourceRow
              key={metric.source.user_source_id}
              metric={metric}
              returnTo={returnTo}
              sourceTags={sourceTags}
            />
          ))}
        </div>
      ) : (
        <p className="muted source-family-empty">
          No Instagram accounts yet. Add a professional or creator profile handle
          to monitor account posts.
        </p>
      )}
    </CollapsibleSourceFamilySection>
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
  returnTo,
  sourceTags
}: {
  metric: SourceMetric;
  returnTo: string;
  sourceTags: SourceTag[];
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
          {metric.latestScanState ? (
            <span className={`status status-${metric.latestScanState}`}>
              {getScanStateLabel(metric.latestScanState)}
            </span>
          ) : null}
        </span>
        {metric.tags.length ? <Tags tags={metric.tags} compact /> : null}
        <SourceTagEditor
          returnTo={returnTo}
          source={metric.source}
          sourceTags={sourceTags}
        />
        <p className="muted instagram-source-note">
          Account posts flow through Instagram Graph API professional account
          discovery when the account and workspace token allow access.
        </p>
        {metric.latestScanState ? (
          <span className="source-scan-detail">
            {getScanStateDetail(metric)}
          </span>
        ) : null}
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
  source,
  sourceTags
}: {
  returnTo: string;
  source: UserSource;
  sourceTags: SourceTag[];
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
        {source.source_tags.length ? <Tags tags={source.source_tags} compact /> : null}
        <SourceTagEditor returnTo={returnTo} source={source} sourceTags={sourceTags} />
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

function ScanRunningBanner({ metrics }: { metrics: SourceMetric[] }) {
  const families = new Set(
    metrics.map((metric) =>
      metric.source.source_type === "instagram" ? "Instagram" : "Web/feed"
    )
  );
  const latestStartedAt = metrics.reduce<string | null>((latest, metric) => {
    if (!metric.latestRunStartedAt) {
      return latest;
    }

    if (!latest) {
      return metric.latestRunStartedAt;
    }

    return Date.parse(metric.latestRunStartedAt) > Date.parse(latest)
      ? metric.latestRunStartedAt
      : latest;
  }, null);

  return (
    <div className="scan-status-banner" role="status" aria-live="polite">
      <strong>Scan running</strong>
      <span>
        {metrics.length} {metrics.length === 1 ? "source is" : "sources are"} currently
        scanning{families.size ? ` (${[...families].join(", ")})` : ""}.
        {latestStartedAt ? ` Started ${formatScanTimestamp(latestStartedAt)}.` : ""}
      </span>
    </div>
  );
}

function ScanStatusCard({ summary }: { summary: ScanStatusSummary }) {
  return (
    <div className="scan-status-card">
      <div className="scan-status-card-head">
        <span className="scan-status-card-label">{summary.label}</span>
        <span className={`status status-${summary.state}`}>
          {getScanSummaryLabel(summary)}
        </span>
      </div>
      <strong className="scan-status-card-detail">{summary.detail}</strong>
      <span className="scan-status-card-meta">
        {summary.timestamp ? formatScanTimestamp(summary.timestamp) : "No scan recorded"}
      </span>
    </div>
  );
}

function buildScanStatusSummary(
  label: string,
  metrics: SourceMetric[]
): ScanStatusSummary {
  if (!metrics.length) {
    return {
      label,
      state: "idle",
      activeRunCount: 0,
      sourceCount: 0,
      timestamp: null,
      detail: "No sources"
    };
  }

  const runningMetrics = metrics.filter(
    (metric) => metric.latestScanState === "running"
  );

  if (runningMetrics.length) {
    const startedAt = getLatestTimestamp(
      runningMetrics.map((metric) => metric.latestRunStartedAt)
    );

    return {
      label,
      state: "running",
      activeRunCount: runningMetrics.length,
      sourceCount: metrics.length,
      timestamp: startedAt,
      detail: `${runningMetrics.length} of ${metrics.length} source${
        metrics.length === 1 ? "" : "s"
      } scanning`
    };
  }

  const latestFinishedMetric = getLatestFinishedMetric(metrics);
  if (!latestFinishedMetric || !latestFinishedMetric.latestScanState) {
    return {
      label,
      state: "idle",
      activeRunCount: 0,
      sourceCount: metrics.length,
      timestamp: null,
      detail: `${metrics.length} active source${metrics.length === 1 ? "" : "s"}`
    };
  }

  if (latestFinishedMetric.latestScanState === "ok") {
    return {
      label,
      state: "ok",
      activeRunCount: 0,
      sourceCount: metrics.length,
      timestamp: latestFinishedMetric.latestRunFinishedAt,
      detail: `${latestFinishedMetric.fetchedCount ?? 0} items fetched`
    };
  }

  if (latestFinishedMetric.latestScanState === "partial") {
    return {
      label,
      state: "partial",
      activeRunCount: 0,
      sourceCount: metrics.length,
      timestamp: latestFinishedMetric.latestRunFinishedAt,
      detail: "Completed with partial results"
    };
  }

  return {
    label,
    state: "error",
    activeRunCount: 0,
    sourceCount: metrics.length,
    timestamp: latestFinishedMetric.latestRunFinishedAt,
    detail: "Last scan failed"
  };
}

function getLatestFinishedMetric(metrics: SourceMetric[]): SourceMetric | null {
  let latestMetric: SourceMetric | null = null;

  for (const metric of metrics) {
    if (!metric.latestRunFinishedAt || !metric.latestScanState) {
      continue;
    }

    if (!latestMetric) {
      latestMetric = metric;
      continue;
    }

    if (
      Date.parse(metric.latestRunFinishedAt) >
      Date.parse(latestMetric.latestRunFinishedAt ?? "")
    ) {
      latestMetric = metric;
    }
  }

  return latestMetric;
}

function getLatestTimestamp(values: Array<string | null>): string | null {
  let latest: string | null = null;

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (!latest || Date.parse(value) > Date.parse(latest)) {
      latest = value;
    }
  }

  return latest;
}

function getScanSummaryLabel(summary: ScanStatusSummary): string {
  if (summary.state === "running") {
    return "Running";
  }

  if (summary.state === "ok") {
    return "Completed";
  }

  if (summary.state === "partial") {
    return "Partial";
  }

  if (summary.state === "error") {
    return "Failed";
  }

  return "Idle";
}

function getScanStateLabel(state: ScanState): string {
  if (state === "running") {
    return "scan running";
  }

  if (state === "ok") {
    return "scan complete";
  }

  if (state === "partial") {
    return "scan partial";
  }

  return "scan failed";
}

function getScanStateDetail(metric: SourceMetric): string {
  if (metric.latestScanState === "running") {
    return metric.latestRunStartedAt
      ? `Started ${formatScanTimestamp(metric.latestRunStartedAt)}`
      : "Scan is in progress";
  }

  if (metric.latestScanState === "ok") {
    return metric.latestRunFinishedAt
      ? `Completed ${formatScanTimestamp(metric.latestRunFinishedAt)}`
      : "Completed";
  }

  if (metric.latestScanState === "partial") {
    return metric.latestRunFinishedAt
      ? `Completed with partial results ${formatScanTimestamp(metric.latestRunFinishedAt)}`
      : "Completed with partial results";
  }

  return metric.latestRunFinishedAt
    ? `Failed ${formatScanTimestamp(metric.latestRunFinishedAt)}`
    : "Failed";
}

function formatScanTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "recently";
  }

  return date.toLocaleString("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
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
