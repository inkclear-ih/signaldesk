import { RECENT_RUN_LIMIT } from "./constants";
import { cleanTags, cleanText, maxIsoDate, parseDateValue } from "./formatting";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  Freshness,
  LatestRun,
  MetricItem,
  ScanState,
  SourceMetric,
  TopMetrics,
  UserSource
} from "./types";

export async function getLatestRunsBySource(
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

export function buildTopMetrics(
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

export function buildSourceMetrics(
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
    stat.latestItemAt = maxIsoDate(
      stat.latestItemAt,
      item.published_at ?? item.first_seen_at
    );
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
    const latestScanState = getLatestScanState(latestRun);
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
      latestRunStartedAt: latestRun?.started_at ?? null,
      latestRunFinishedAt: latestRun?.finished_at ?? null,
      latestScanState,
      latestRunStatus: latestRun?.status ?? null,
      latestRunError: runError,
      snapshotCount: stat.snapshotCount,
      newCount: stat.newCount,
      attentionCount: stat.attentionCount,
      latestItemAt: stat.latestItemAt,
      lastFetchedAt,
      freshness: getFreshness(
        lastFetchedAt,
        latestScanState === "running" ? null : latestRun?.status ?? null,
        source.last_error ?? runError
      )
    };
  });
}

function getLatestScanState(latestRun: LatestRun | null): ScanState | null {
  if (!latestRun) {
    return null;
  }

  if (latestRun.finished_at === null) {
    return "running";
  }

  return latestRun.status;
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
