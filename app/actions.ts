"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getSourceTypesForScanScope,
  scanSources,
  type SourceScanScope,
  type SourceScanSummary
} from "@/lib/ingestion/scan";
import {
  FeedValidationError,
  validateFeedUrl,
  type FeedValidationDiagnostics
} from "@/lib/sources/feed";
import {
  FeedDiscoveryError,
  discoverFeedsFromWebsite,
  type FeedDiscoveryCandidate
} from "@/lib/sources/discovery";
import {
  InstagramSourceInputError,
  normalizeInstagramAccountInput
} from "@/lib/sources/instagram";

type DispositionState = "none" | "saved" | "archived" | "hidden";
type UserSourceStatus = "active" | "paused" | "archived";
type ActiveSourceForScan = {
  source_id: string | null;
  source_type: string | null;
};
type StoredItemState = {
  review_state: "reviewed" | null;
  disposition_state: DispositionState;
  reviewed_at: string | null;
};
type ExistingUserSource = {
  user_source_status: UserSourceStatus;
  source_name: string | null;
};

const DISPOSITION_STATES = new Set(["saved", "archived", "hidden"]);

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect("/?error=missing-email");
  }

  const origin =
    headers().get("origin") ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000";

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`
    }
  });

  if (error) {
    redirect(`/?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/?sent=1");
}

export async function signOut() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function markItemReviewed(formData: FormData) {
  const itemId = getItemId(formData);
  if (!itemId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();

  const now = new Date().toISOString();
  await supabase.from("user_item_states").upsert(
    {
      user_id: userId,
      item_id: itemId,
      review_state: "reviewed",
      reviewed_at: now,
      updated_at: now
    },
    { onConflict: "user_id,item_id" }
  );

  finishItemMutation(formData);
}

export async function markItemUnreviewed(formData: FormData) {
  const itemId = getItemId(formData);
  if (!itemId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const existing = await getExistingItemState(supabase, userId, itemId);

  if (!existing) {
    return;
  }

  if (existing.disposition_state === "none") {
    await supabase
      .from("user_item_states")
      .delete()
      .eq("user_id", userId)
      .eq("item_id", itemId);
  } else {
    await supabase
      .from("user_item_states")
      .update({
        review_state: null,
        reviewed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .eq("item_id", itemId);
  }

  finishItemMutation(formData);
}

export async function setItemDisposition(formData: FormData) {
  const itemId = getItemId(formData);
  const disposition = String(formData.get("disposition") ?? "");
  if (!itemId || !isDisposition(disposition)) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const existing = await getExistingItemState(supabase, userId, itemId);
  const now = new Date().toISOString();

  await supabase.from("user_item_states").upsert(
    {
      user_id: userId,
      item_id: itemId,
      review_state: "reviewed",
      reviewed_at: existing?.reviewed_at ?? now,
      disposition_state: disposition,
      saved_at: disposition === "saved" ? now : null,
      archived_at: disposition === "archived" ? now : null,
      hidden_at: disposition === "hidden" ? now : null,
      updated_at: now
    },
    { onConflict: "user_id,item_id" }
  );

  finishItemMutation(formData);
}

export async function clearItemDisposition(formData: FormData) {
  const itemId = getItemId(formData);
  if (!itemId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const existing = await getExistingItemState(supabase, userId, itemId);

  if (!existing || existing.disposition_state === "none") {
    return;
  }

  if (existing.review_state === "reviewed") {
    const now = new Date().toISOString();
    await supabase
      .from("user_item_states")
      .update({
        disposition_state: "none",
        reviewed_at: now,
        saved_at: null,
        archived_at: null,
        hidden_at: null,
        updated_at: now
      })
      .eq("user_id", userId)
      .eq("item_id", itemId);
  } else {
    await supabase
      .from("user_item_states")
      .delete()
      .eq("user_id", userId)
      .eq("item_id", itemId);
  }

  finishItemMutation(formData);
}

export async function restoreItemToInbox(formData: FormData) {
  const itemId = getItemId(formData);
  if (!itemId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  await supabase
    .from("user_item_states")
    .delete()
    .eq("user_id", userId)
    .eq("item_id", itemId);

  revalidatePath("/");
  const returnTo = getSafeReturnTo(formData);
  if (returnTo) {
    redirect(toInboxPath(returnTo));
  }
  redirect("/");
}

export async function addFeedSource(formData: FormData) {
  const rawFeedUrl = String(formData.get("feedUrl") ?? "").trim();
  logFeedSubscription("start", { inputUrl: rawFeedUrl });
  if (!rawFeedUrl) {
    logFeedSubscription("validation skipped", {
      inputUrl: rawFeedUrl,
      reason: "missing-url"
    });
    finishSourceMutation(formData, {
      type: "error",
      message: "Enter a feed URL."
    });
  }

  const { supabase } = await getAuthenticatedContext();

  let feed;
  try {
    feed = await validateFeedUrl(rawFeedUrl);
    logFeedSubscription("validation ok", feed.diagnostics);
  } catch (error) {
    logFeedSubscription("validation failed", getFeedValidationLog(error, rawFeedUrl));
    finishSourceMutation(formData, {
      type: "error",
      message: getErrorMessage(error)
    });
  }

  const existingSource = await getExistingUserSourceByFeedUrl(
    supabase,
    feed.feedUrl
  );
  const { error } = await supabase.rpc("subscribe_to_feed_source", {
    p_feed_url: feed.feedUrl,
    p_name: feed.name,
    p_site_url: feed.siteUrl,
    p_type: feed.type
  });

  if (error) {
    logFeedSubscription("rpc failed", {
      inputUrl: rawFeedUrl,
      normalizedUrl: feed.diagnostics.normalizedUrl,
      finalUrl: feed.feedUrl,
      detection: feed.type,
      title: feed.name,
      siteUrl: feed.siteUrl,
      supabase: getSupabaseErrorLog(error)
    });
    finishSourceMutation(formData, {
      type: "error",
      message: getSubscribeErrorMessage(error)
    });
  }

  logFeedSubscription("subscribed", {
    inputUrl: rawFeedUrl,
    normalizedUrl: feed.diagnostics.normalizedUrl,
    finalUrl: feed.feedUrl,
    detection: feed.type,
    title: feed.name,
    siteUrl: feed.siteUrl
  });
  finishSourceMutation(formData, {
    type: "message",
    message: getSubscriptionSuccessMessage(feed.name, existingSource)
  });
}

export async function addInstagramSource(formData: FormData) {
  const rawAccount = String(formData.get("instagramAccount") ?? "").trim();
  if (!rawAccount) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Enter an Instagram handle or profile URL."
    });
  }

  const { supabase } = await getAuthenticatedContext();

  let account;
  try {
    account = normalizeInstagramAccountInput(rawAccount);
  } catch (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: getInstagramInputErrorMessage(error)
    });
  }

  const existingSource = await getExistingUserSourceBySourceKey(
    supabase,
    account.sourceKey
  );
  const { error } = await supabase.rpc("subscribe_to_instagram_source", {
    p_handle: account.handle,
    p_profile_url: account.profileUrl,
    p_display_name: account.displayName,
    p_metadata: account.metadata
  });

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: getInstagramSubscribeErrorMessage(error)
    });
  }

  finishSourceMutation(formData, {
    type: "message",
    message: getInstagramSubscriptionSuccessMessage(
      account.displayName,
      existingSource
    )
  });
}

export async function discoverWebsiteFeeds(formData: FormData) {
  const rawWebsiteUrl = String(formData.get("websiteUrl") ?? "").trim();
  logFeedDiscovery("start", { inputUrl: rawWebsiteUrl });
  if (!rawWebsiteUrl) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Enter a website URL."
    });
  }

  await getAuthenticatedContext();

  let discovery;
  try {
    discovery = await discoverFeedsFromWebsite(rawWebsiteUrl);
  } catch (error) {
    logFeedDiscovery("failed", {
      inputUrl: rawWebsiteUrl,
      error: getErrorMessage(error)
    });
    finishSourceMutation(formData, {
      type: "error",
      message: getFeedDiscoveryErrorMessage(error)
    });
  }

  logFeedDiscovery("complete", {
    inputUrl: rawWebsiteUrl,
    pageUrl: discovery.pageUrl,
    candidates: discovery.candidates.map((candidate: FeedDiscoveryCandidate) => ({
      feedUrl: candidate.feedUrl,
      type: candidate.type,
      source: candidate.source
    }))
  });

  if (!discovery.candidates.length) {
    finishSourceMutation(formData, {
      type: "error",
      message:
        "No RSS or Atom feed was found for that website. You can use the advanced feed URL fallback below."
    });
  }

  finishSourceDiscovery(formData, {
    pageUrl: discovery.pageUrl,
    candidates: discovery.candidates
  });
}

export async function rescanSources(formData: FormData) {
  const { supabase, userId } = await getAuthenticatedContext();
  const scope = getSourceScanScope(formData);
  const sourceTypes = scope ? getSourceTypesForScanScope(scope) : null;
  let query = supabase
    .from("current_user_sources")
    .select("source_id,source_type")
    .eq("user_source_status", "active")
    .in("source_status", ["active", "validating"]);

  if (sourceTypes) {
    query = query.in("source_type", sourceTypes);
  }

  const { data, error } = await query;

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: `Could not load ${getActiveScanScopeLabel(scope)} to scan.`
    });
  }

  const sourceIds = [
    ...new Set(
      ((data ?? []) as ActiveSourceForScan[])
        .map((source) => String(source.source_id ?? ""))
        .filter((sourceId) => sourceId.length > 0)
    )
  ];

  if (!sourceIds.length) {
    finishSourceMutation(formData, {
      type: "message",
      message: `No ${getActiveScanScopeLabel(scope)} to scan.`
    });
  }

  let summary: SourceScanSummary;
  try {
    summary = await scanSources({ ownerUserId: userId, sourceIds, scope });
  } catch (scanError) {
    finishSourceMutation(formData, {
      type: "error",
      message: `${getScanScopeTitle(scope)} scan failed: ${getErrorMessage(
        scanError
      )}`
    });
  }

  finishSourceMutation(formData, getScanFeedback(summary, scope));
}

export async function disconnectInstagramConnection(formData: FormData) {
  const { userId } = await getAuthenticatedContext();
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("user_provider_connections")
    .update({
      status: "disconnected",
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      refresh_expires_at: null,
      next_refresh_at: null,
      refresh_attempted_at: null,
      refresh_error: null,
      disconnected_at: now
    })
    .eq("user_id", userId)
    .eq("provider", "meta_instagram");

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not disconnect Instagram."
    });
  }

  finishSourceMutation(formData, {
    type: "message",
    message: "Instagram disconnected."
  });
}

export async function pauseSourceSubscription(formData: FormData) {
  await setSourceSubscriptionStatus(formData, "paused");
}

export async function resumeSourceSubscription(formData: FormData) {
  await setSourceSubscriptionStatus(formData, "active");
}

export async function archiveSourceSubscription(formData: FormData) {
  await setSourceSubscriptionStatus(formData, "archived");
}

function getItemId(formData: FormData): string {
  return String(formData.get("itemId") ?? "");
}

function getUserSourceId(formData: FormData): string {
  return String(formData.get("userSourceId") ?? "");
}

async function getAuthenticatedContext() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  return { supabase, userId: user.id };
}

async function getExistingItemState(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  userId: string,
  itemId: string
): Promise<StoredItemState | null> {
  const { data } = await supabase
    .from("user_item_states")
    .select("review_state, disposition_state, reviewed_at")
    .eq("user_id", userId)
    .eq("item_id", itemId)
    .maybeSingle();

  return (data as StoredItemState | null) ?? null;
}

function isDisposition(value: string): value is Exclude<DispositionState, "none"> {
  return DISPOSITION_STATES.has(value);
}

function finishItemMutation(formData: FormData): never | void {
  revalidatePath("/");
  const returnTo = getSafeReturnTo(formData);
  if (returnTo) {
    redirect(returnTo);
  }

  const view = String(formData.get("view") ?? "");

  if (view && view !== "inbox") {
    redirect(`/?view=${encodeURIComponent(view)}`);
  }
}

async function setSourceSubscriptionStatus(
  formData: FormData,
  status: UserSourceStatus
) {
  const userSourceId = getUserSourceId(formData);
  if (!userSourceId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const now = new Date().toISOString();
  const statusDates = {
    active: {
      paused_at: null,
      archived_at: null
    },
    paused: {
      paused_at: now,
      archived_at: null
    },
    archived: {
      paused_at: null,
      archived_at: now
    }
  } satisfies Record<
    UserSourceStatus,
    { paused_at: string | null; archived_at: string | null }
  >;

  const { error } = await supabase
    .from("user_sources")
    .update({
      status,
      ...statusDates[status]
    })
    .eq("id", userSourceId)
    .eq("user_id", userId);

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not update that source."
    });
  }

  const messages: Record<UserSourceStatus, string> = {
    active: "Source reactivated.",
    paused: "Source paused.",
    archived: "Source archived."
  };

  finishSourceMutation(formData, {
    type: "message",
    message: messages[status]
  });
}

function finishSourceMutation(
  formData: FormData,
  feedback: { type: "message" | "error"; message: string }
): never {
  revalidatePath("/");
  const returnTo = getSafeReturnTo(formData) ?? "/";
  redirect(addFeedbackParam(returnTo, feedback));
}

function finishSourceDiscovery(
  formData: FormData,
  discovery: {
    pageUrl: string;
    candidates: FeedDiscoveryCandidate[];
  }
): never {
  revalidatePath("/");
  const returnTo = getSafeReturnTo(formData) ?? "/";
  redirect(addDiscoveryParam(returnTo, discovery));
}

function getSafeReturnTo(formData: FormData): string | null {
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return null;
  }

  try {
    const url = new URL(returnTo, "http://signaldesk.local");
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function addFeedbackParam(
  path: string,
  feedback: { type: "message" | "error"; message: string }
): string {
  const url = new URL(path, "http://signaldesk.local");
  url.searchParams.delete("sourceMessage");
  url.searchParams.delete("sourceError");
  url.searchParams.delete("sourceDiscovery");
  url.searchParams.set(
    feedback.type === "message" ? "sourceMessage" : "sourceError",
    feedback.message
  );
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

function addDiscoveryParam(
  path: string,
  discovery: {
    pageUrl: string;
    candidates: FeedDiscoveryCandidate[];
  }
): string {
  const url = new URL(path, "http://signaldesk.local");
  url.searchParams.delete("sourceMessage");
  url.searchParams.delete("sourceError");
  url.searchParams.set("sourceDiscovery", JSON.stringify(discovery));
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Could not validate that feed.";
}

function getSubscribeErrorMessage(error: unknown): string {
  if (isLocalDebug()) {
    return `Could not subscribe to that feed: ${getErrorMessage(error)}`;
  }

  return "Could not subscribe to that feed.";
}

function getSubscriptionSuccessMessage(
  name: string,
  existingSource: ExistingUserSource | null
): string {
  if (!existingSource) {
    return `Subscribed to ${name}.`;
  }

  if (existingSource.user_source_status === "active") {
    return `${existingSource.source_name ?? name} is already in your sources.`;
  }

  return `Restored ${existingSource.source_name ?? name}.`;
}

async function getExistingUserSourceByFeedUrl(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  feedUrl: string
): Promise<ExistingUserSource | null> {
  const { data } = await supabase
    .from("current_user_sources")
    .select("user_source_status, source_name")
    .eq("feed_url", feedUrl)
    .maybeSingle();

  return (data as ExistingUserSource | null) ?? null;
}

async function getExistingUserSourceBySourceKey(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sourceKey: string
): Promise<ExistingUserSource | null> {
  const { data } = await supabase
    .from("current_user_sources")
    .select("user_source_status, source_name")
    .eq("source_key", sourceKey)
    .maybeSingle();

  return (data as ExistingUserSource | null) ?? null;
}

function getInstagramInputErrorMessage(error: unknown): string {
  if (error instanceof InstagramSourceInputError) {
    return error.message;
  }

  return "Could not normalize that Instagram account.";
}

function getInstagramSubscribeErrorMessage(error: unknown): string {
  if (isLocalDebug()) {
    return `Could not add that Instagram account: ${getErrorMessage(error)}`;
  }

  return "Could not add that Instagram account.";
}

function getInstagramSubscriptionSuccessMessage(
  name: string,
  existingSource: ExistingUserSource | null
): string {
  if (!existingSource) {
    return `${name} added as an Instagram professional account source. It will be included in scans when Instagram is connected.`;
  }

  if (existingSource.user_source_status === "active") {
    return `${existingSource.source_name ?? name} is already in your Instagram sources.`;
  }

  return `Restored ${existingSource.source_name ?? name}.`;
}

function getFeedDiscoveryErrorMessage(error: unknown): string {
  if (error instanceof FeedDiscoveryError) {
    return error.message;
  }

  return "Could not discover feeds for that website.";
}

function getFeedValidationLog(
  error: unknown,
  inputUrl: string
): FeedValidationDiagnostics & { error: string } {
  if (error instanceof FeedValidationError) {
    return {
      ...error.diagnostics,
      inputUrl,
      error: error.message
    };
  }

  return {
    inputUrl,
    error: getErrorMessage(error)
  };
}

function getSupabaseErrorLog(error: unknown) {
  if (!error || typeof error !== "object") {
    return { message: getErrorMessage(error) };
  }

  const supabaseError = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };

  return {
    message: supabaseError.message,
    details: supabaseError.details,
    hint: supabaseError.hint,
    code: supabaseError.code
  };
}

function logFeedSubscription(stage: string, data: Record<string, unknown>) {
  if (!isLocalDebug()) {
    return;
  }

  console.info("[feed-subscribe]", stage, JSON.stringify(data));
}

function logFeedDiscovery(stage: string, data: Record<string, unknown>) {
  if (!isLocalDebug()) {
    return;
  }

  console.info("[feed-discovery]", stage, JSON.stringify(data));
}

function isLocalDebug(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.SIGNALDESK_DEBUG_FEEDS === "1"
  );
}

function getSourceScanScope(formData: FormData): SourceScanScope | undefined {
  const scope = String(formData.get("scanScope") ?? "");
  return scope === "instagram" || scope === "web_feed" ? scope : undefined;
}

function getActiveScanScopeLabel(scope: SourceScanScope | undefined): string {
  if (scope === "instagram") {
    return "active Instagram sources";
  }

  if (scope === "web_feed") {
    return "active web/feed sources";
  }

  return "active sources";
}

function getScanScopeTitle(scope: SourceScanScope | undefined): string {
  if (scope === "instagram") {
    return "Instagram source";
  }

  if (scope === "web_feed") {
    return "Web/feed source";
  }

  return "Source";
}

function getScanFeedback(
  summary: SourceScanSummary,
  scope: SourceScanScope | undefined
): {
  type: "message" | "error";
  message: string;
} {
  const scanLabel = getScanScopeTitle(scope);
  const processed = `${summary.sourceCount} ${pluralize(
    summary.sourceCount,
    "source",
    "sources"
  )}, ${summary.fetchedCount} ${pluralize(
    summary.fetchedCount,
    "item",
    "items"
  )}`;
  const counts = `${summary.newCount} new, ${summary.knownCount} known`;

  if (summary.errorCount > 0) {
    const firstError = summary.results.find(
      (result) => result.status === "error" && result.error
    );
    const errorDetail = firstError
      ? ` First error: ${firstError.sourceName}: ${firstError.error}`
      : "";

    return {
      type: "error",
      message: `${scanLabel} scan finished with ${summary.errorCount} ${pluralize(
        summary.errorCount,
        "error",
        "errors"
      )}: ${processed} processed (${counts}).${errorDetail}`
    };
  }

  return {
    type: "message",
    message: `${scanLabel} scan complete: ${processed} processed (${counts}).`
  };
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function toInboxPath(path: string): string {
  const url = new URL(path, "http://signaldesk.local");
  url.searchParams.delete("view");
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}
