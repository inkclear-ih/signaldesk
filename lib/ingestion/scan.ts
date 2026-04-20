import { cleanText } from "@/lib/inbox/formatting";
import {
  InstagramGraphApiError,
  fetchInstagramProfessionalAccountPosts,
  normalizeInstagramMediaItem
} from "@/lib/ingestion/instagram";
import { resolveInstagramCredentialForSource } from "@/lib/instagram/connections";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const DEFAULT_LIMIT_PER_SOURCE = 25;
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_FEED_BYTES = 1024 * 1024;
const USER_AGENT = "Signaldesk/0.2 source scanner";

type SourceRow = {
  id: string;
  type: "rss" | "atom" | "instagram";
  name: string;
  feed_url: string | null;
  url: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

type ExistingItem = {
  id: string;
  seen_count: number;
};

type NormalizedEntry = {
  item_key?: string | null;
  title: string | null;
  link: string | null;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  raw_guid: string | null;
  raw_payload: Record<string, unknown>;
};

export type SourceScanScope = "instagram" | "web_feed";
export type SourceType = SourceRow["type"];

export type SourceScanResult = {
  sourceId: string;
  sourceName: string;
  status: "ok" | "error";
  fetchedCount: number;
  newCount: number;
  knownCount: number;
  error: string | null;
};

export type SourceScanSummary = {
  sourceCount: number;
  okCount: number;
  errorCount: number;
  fetchedCount: number;
  newCount: number;
  knownCount: number;
  results: SourceScanResult[];
};

const SOURCE_TYPES_BY_SCOPE = {
  instagram: ["instagram"],
  web_feed: ["rss", "atom"]
} satisfies Record<SourceScanScope, SourceType[]>;

export function getSourceTypesForScanScope(scope: SourceScanScope): SourceType[] {
  return SOURCE_TYPES_BY_SCOPE[scope];
}

export async function scanSources({
  ownerUserId,
  sourceIds,
  scope,
  limitPerSource = getNumberEnv("SIGNALDESK_SCAN_LIMIT_PER_SOURCE") ??
    DEFAULT_LIMIT_PER_SOURCE,
  timeoutMs = getNumberEnv("SIGNALDESK_SCAN_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS
}: {
  ownerUserId?: string;
  sourceIds?: string[];
  scope?: SourceScanScope;
  limitPerSource?: number;
  timeoutMs?: number;
} = {}): Promise<SourceScanSummary> {
  const supabase = createSupabaseAdminClient();
  const sourceTypes = scope ? SOURCE_TYPES_BY_SCOPE[scope] : null;
  const activeSourceIds =
    sourceIds && sourceIds.length
      ? [...new Set(sourceIds)]
      : await getActiveSubscribedSourceIds(supabase, sourceTypes);

  if (!activeSourceIds.length) {
    return emptySummary();
  }

  let query = supabase
    .from("sources")
    .select("id,type,name,feed_url,url,status,metadata")
    .in("status", ["active", "validating"])
    .in("id", activeSourceIds)
    .order("name", { ascending: true });

  if (sourceTypes) {
    query = query.in("type", sourceTypes);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not load active sources: ${error.message}`);
  }

  const sources = (data ?? []) as SourceRow[];
  const results: SourceScanResult[] = [];

  for (const source of sources) {
    results.push(
      await scanSource(supabase, source, {
        limitPerSource,
        ownerUserId,
        timeoutMs
      })
    );
  }

  return summarizeResults(results);
}

async function getActiveSubscribedSourceIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  sourceTypes: SourceType[] | null = null
): Promise<string[]> {
  if (!sourceTypes) {
    const { data, error } = await supabase
      .from("user_sources")
      .select("source_id")
      .eq("status", "active");

    if (error) {
      throw new Error(`Could not load active subscriptions: ${error.message}`);
    }

    return getUniqueSourceIds(data);
  }

  const query = supabase
    .from("user_sources")
    .select("source_id, sources!inner(type)")
    .eq("status", "active")
    .in("sources.type", sourceTypes);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not load active subscriptions: ${error.message}`);
  }

  return getUniqueSourceIds(data);
}

function getUniqueSourceIds(data: { source_id: unknown }[] | null): string[] {
  return [
    ...new Set(
      (data ?? [])
        .map((row) => String(row.source_id ?? ""))
        .filter((sourceId) => sourceId.length > 0)
    )
  ];
}

async function scanSource(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  source: SourceRow,
  {
    limitPerSource,
    ownerUserId,
    timeoutMs
  }: {
    limitPerSource: number;
    ownerUserId?: string;
    timeoutMs: number;
  }
): Promise<SourceScanResult> {
  if (source.type === "instagram") {
    return scanInstagramSource(supabase, source, {
      ownerUserId,
      timeoutMs
    });
  }

  if (!source.feed_url) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "error",
      fetchedCount: 0,
      newCount: 0,
      knownCount: 0,
      error: "Feed URL is missing."
    };
  }

  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({
      source_id: source.id,
      started_at: startedAt,
      status: "partial"
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(
      `Could not create ingestion run for ${source.name}: ${
        runError?.message ?? "missing run"
      }`
    );
  }

  try {
    const response = await fetch(source.feed_url, {
      cache: "no-store",
      headers: {
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
        "user-agent": USER_AGENT
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      throw new FeedScanError(
        `Feed returned HTTP ${response.status}.`,
        response.status
      );
    }

    const xml = await readLimitedResponse(response);
    const entries = parseFeedEntries(xml, source).slice(0, limitPerSource);
    const { fetchedCount, knownCount, newCount } = await persistNormalizedEntries(
      supabase,
      {
        entries,
        runId: run.id,
        sourceId: source.id
      }
    );

    const finishedAt = new Date().toISOString();
    await supabase
      .from("ingestion_runs")
      .update({
        finished_at: finishedAt,
        status: "ok",
        fetched_count: fetchedCount,
        new_count: newCount,
        known_count: knownCount,
        error_message: null,
        http_status: null
      })
      .eq("id", run.id);
    await supabase
      .from("sources")
      .update({
        last_fetched_at: finishedAt,
        last_error: null
      })
      .eq("id", source.id);

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "ok",
      fetchedCount,
      newCount,
      knownCount,
      error: null
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const finishedAt = new Date().toISOString();
    await supabase
      .from("ingestion_runs")
      .update({
        finished_at: finishedAt,
        status: "error",
        error_message: message,
        http_status: error instanceof FeedScanError ? error.httpStatus : null
      })
      .eq("id", run.id);
    await supabase
      .from("sources")
      .update({
        last_fetched_at: finishedAt,
        last_error: message
      })
      .eq("id", source.id);

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "error",
      fetchedCount: 0,
      newCount: 0,
      knownCount: 0,
      error: message
    };
  }
}

async function scanInstagramSource(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  source: SourceRow,
  {
    ownerUserId,
    timeoutMs
  }: {
    ownerUserId?: string;
    timeoutMs: number;
  }
): Promise<SourceScanResult> {
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({
      source_id: source.id,
      started_at: startedAt,
      status: "partial"
    })
    .select("id")
    .single();

  if (runError || !run) {
    throw new Error(
      `Could not create ingestion run for ${source.name}: ${
        runError?.message ?? "missing run"
      }`
    );
  }

  try {
    const credential = await resolveInstagramCredentialForSource(supabase, {
      preferredUserId: ownerUserId,
      sourceId: source.id
    });
    const posts = await fetchInstagramProfessionalAccountPosts(
      {
        id: source.id,
        name: source.name,
        url: source.url,
        metadata: source.metadata
      },
      {
        credential,
        timeoutMs
      }
    );
    const entries = posts.map((post) =>
      normalizeInstagramMediaItem(
        {
          id: source.id,
          name: source.name,
          url: source.url,
          metadata: source.metadata
        },
        post
      )
    );
    const { fetchedCount, knownCount, newCount } = await persistNormalizedEntries(
      supabase,
      {
        entries,
        runId: run.id,
        sourceId: source.id
      }
    );

    const finishedAt = new Date().toISOString();
    await supabase
      .from("ingestion_runs")
      .update({
        finished_at: finishedAt,
        status: "ok",
        fetched_count: fetchedCount,
        new_count: newCount,
        known_count: knownCount,
        error_message: null,
        http_status: null
      })
      .eq("id", run.id);

    await supabase
      .from("sources")
      .update({
        status: "active",
        last_fetched_at: finishedAt,
        last_error: null,
        metadata: mergeSourceMetadata(source.metadata, {
          api_status: "connected",
          last_ingestion_adapter: "instagram_graph_business_discovery"
        })
      })
      .eq("id", source.id);

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "ok",
      fetchedCount,
      newCount,
      knownCount,
      error: null
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const finishedAt = new Date().toISOString();

    await supabase
      .from("ingestion_runs")
      .update({
        finished_at: finishedAt,
        status: "error",
        error_message: message,
        http_status: error instanceof InstagramGraphApiError ? error.httpStatus : null
      })
      .eq("id", run.id);
    await supabase
      .from("sources")
      .update({
        last_fetched_at: finishedAt,
        last_error: message,
        metadata: mergeSourceMetadata(source.metadata, {
          api_status: "error",
          last_ingestion_adapter: "instagram_graph_business_discovery"
        })
      })
      .eq("id", source.id);

    return {
      sourceId: source.id,
      sourceName: source.name,
      status: "error",
      fetchedCount: 0,
      newCount: 0,
      knownCount: 0,
      error: message
    };
  }
}

async function persistNormalizedEntries(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    entries,
    runId,
    sourceId
  }: {
    entries: NormalizedEntry[];
    runId: string;
    sourceId: string;
  }
): Promise<{
  fetchedCount: number;
  knownCount: number;
  newCount: number;
}> {
  const seenKeys = new Set<string>();
  let fetchedCount = 0;
  let newCount = 0;
  let knownCount = 0;

  for (const entry of entries) {
    fetchedCount += 1;
    const itemKey =
      textOrNull(entry.item_key ?? null) ??
      computeItemKey({
        sourceId,
        title: entry.title,
        link: entry.link
      });

    if (seenKeys.has(itemKey)) {
      continue;
    }
    seenKeys.add(itemKey);

    const existing = await getExistingItem(supabase, sourceId, itemKey);
    const seenAt = new Date().toISOString();

    if (existing) {
      await updateExistingItem(supabase, {
        itemId: existing.id,
        normalized: entry,
        runId,
        seenAt,
        seenCount: existing.seen_count + 1
      });
      knownCount += 1;
    } else {
      await insertNewItem(supabase, {
        itemKey,
        normalized: entry,
        runId,
        seenAt,
        sourceId
      });
      newCount += 1;
    }
  }

  return { fetchedCount, knownCount, newCount };
}

async function getExistingItem(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  sourceId: string,
  itemKey: string
): Promise<ExistingItem | null> {
  const { data, error } = await supabase
    .from("items")
    .select("id,seen_count")
    .eq("source_id", sourceId)
    .eq("item_key", itemKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not check existing item: ${error.message}`);
  }

  return (data as ExistingItem | null) ?? null;
}

async function insertNewItem(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    itemKey,
    normalized,
    runId,
    seenAt,
    sourceId
  }: {
    itemKey: string;
    normalized: NormalizedEntry;
    runId: string;
    seenAt: string;
    sourceId: string;
  }
) {
  const { error } = await supabase.from("items").insert({
    source_id: sourceId,
    item_key: itemKey,
    title: normalized.title,
    link: normalized.link,
    summary: normalized.summary,
    author: normalized.author,
    published_at: normalized.published_at,
    first_seen_at: seenAt,
    last_seen_at: seenAt,
    seen_count: 1,
    first_seen_run_id: runId,
    last_seen_run_id: runId,
    raw_guid: normalized.raw_guid,
    raw_payload: normalized.raw_payload
  });

  if (error) {
    throw new Error(`Could not insert item: ${error.message}`);
  }
}

async function updateExistingItem(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    itemId,
    normalized,
    runId,
    seenAt,
    seenCount
  }: {
    itemId: string;
    normalized: NormalizedEntry;
    runId: string;
    seenAt: string;
    seenCount: number;
  }
) {
  const { error } = await supabase
    .from("items")
    .update({
      title: normalized.title,
      link: normalized.link,
      summary: normalized.summary,
      author: normalized.author,
      published_at: normalized.published_at,
      last_seen_at: seenAt,
      seen_count: seenCount,
      last_seen_run_id: runId,
      raw_guid: normalized.raw_guid,
      raw_payload: normalized.raw_payload
    })
    .eq("id", itemId);

  if (error) {
    throw new Error(`Could not update item: ${error.message}`);
  }
}

async function readLimitedResponse(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_FEED_BYTES) {
      throw new Error("Feed response is too large.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    received += value.byteLength;
    if (received > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("Feed response is too large.");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function parseFeedEntries(xml: string, source: SourceRow): NormalizedEntry[] {
  if (source.type === "atom" || /<feed[\s>]/i.test(xml)) {
    return extractElements(xml, "entry").map((entry) => normalizeAtomEntry(entry));
  }

  const channel = extractRawElement(xml, "channel") ?? xml;
  return extractElements(channel, "item").map((item) => normalizeRssItem(item));
}

function normalizeRssItem(item: string): NormalizedEntry {
  const rawGuid = extractTextElement(item, "guid");
  const title = extractTextElement(item, "title");
  const link = extractTextElement(item, "link") ?? rawGuid;
  const summary =
    extractTextElement(item, "description") ?? extractTextElement(item, "summary");
  const author =
    extractTextElement(item, "author") ?? extractTextElement(item, "dc:creator");
  const published =
    extractTextElement(item, "pubDate") ??
    extractTextElement(item, "published") ??
    extractTextElement(item, "updated");

  return {
    title,
    link,
    summary,
    author,
    published_at: parseDate(published),
    raw_guid: rawGuid,
    raw_payload: {
      id: rawGuid,
      title,
      link,
      summary,
      author,
      published,
      updated: extractTextElement(item, "updated")
    }
  };
}

function normalizeAtomEntry(entry: string): NormalizedEntry {
  const rawGuid = extractTextElement(entry, "id");
  const title = extractTextElement(entry, "title");
  const link = extractAtomLink(entry) ?? rawGuid;
  const summary =
    extractTextElement(entry, "summary") ?? extractTextElement(entry, "content");
  const author = extractTextElement(extractRawElement(entry, "author") ?? "", "name");
  const published =
    extractTextElement(entry, "published") ??
    extractTextElement(entry, "updated") ??
    extractTextElement(entry, "created");

  return {
    title,
    link,
    summary,
    author,
    published_at: parseDate(published),
    raw_guid: rawGuid,
    raw_payload: {
      id: rawGuid,
      title,
      link,
      summary,
      author,
      published,
      updated: extractTextElement(entry, "updated")
    }
  };
}

function extractAtomLink(xml: string): string | null {
  const links = Array.from(xml.matchAll(/<link\b([^>]*?)\/?>/gi));
  const alternate =
    links.find((link) => {
      const rel = extractAttribute(link[1], "rel");
      return !rel || rel.toLowerCase() === "alternate";
    }) ?? links[0];

  return alternate ? cleanText(extractAttribute(alternate[1], "href")) : null;
}

function extractElements(xml: string, name: string): string[] {
  const tagName = escapeRegExp(name);
  return Array.from(
    xml.matchAll(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi"))
  ).map((match) => match[1]);
}

function extractTextElement(xml: string, name: string): string | null {
  const rawValue = extractRawElement(xml, name);
  return rawValue ? cleanText(unwrapCdata(rawValue)) : null;
}

function extractRawElement(xml: string, name: string): string | null {
  const tagName = escapeRegExp(name);
  const match = xml.match(
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i")
  );
  return match?.[1] ?? null;
}

function extractAttribute(attributes: string, name: string): string | null {
  const attributeName = escapeRegExp(name);
  const match = attributes.match(
    new RegExp(`${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return match?.[1] ?? match?.[2] ?? null;
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function computeItemKey({
  link,
  sourceId,
  title
}: {
  link: string | null;
  sourceId: string;
  title: string | null;
}): string {
  const normalizedLink = normalizeLink(link);
  if (normalizedLink) {
    return `link:${normalizedLink}`;
  }

  return `title:${normalizeTitle(sourceId) ?? "unknown-source"}:${
    normalizeTitle(title) ?? "untitled"
  }`;
}

function normalizeLink(value: string | null): string | null {
  const text = textOrNull(value);
  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    return url.toString();
  } catch {
    return text;
  }
}

function normalizeTitle(value: string | null): string | null {
  const text = textOrNull(value);
  return text ? text.replace(/\s+/g, " ").toLowerCase() : null;
}

function textOrNull(value: string | null): string | null {
  const text = value?.trim();
  return text || null;
}

function mergeSourceMetadata(
  metadata: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    ...patch
  };
}

function getNumberEnv(name: string): number | null {
  const value = process.env[name];
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function summarizeResults(results: SourceScanResult[]): SourceScanSummary {
  return {
    sourceCount: results.length,
    okCount: results.filter((result) => result.status === "ok").length,
    errorCount: results.filter((result) => result.status === "error").length,
    fetchedCount: results.reduce((sum, result) => sum + result.fetchedCount, 0),
    newCount: results.reduce((sum, result) => sum + result.newCount, 0),
    knownCount: results.reduce((sum, result) => sum + result.knownCount, 0),
    results
  };
}

function emptySummary(): SourceScanSummary {
  return {
    sourceCount: 0,
    okCount: 0,
    errorCount: 0,
    fetchedCount: 0,
    newCount: 0,
    knownCount: 0,
    results: []
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown source scan error.";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class FeedScanError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number
  ) {
    super(message);
  }
}
