"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scanSources, type SourceScanSummary } from "@/lib/ingestion/scan";
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

type DispositionState = "none" | "saved" | "archived" | "hidden";
type UserSourceStatus = "active" | "paused" | "archived";
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
  const { supabase } = await getAuthenticatedContext();
  const { data, error } = await supabase
    .from("current_user_sources")
    .select("source_id")
    .eq("user_source_status", "active")
    .eq("source_status", "active");

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not load active sources to scan."
    });
  }

  const sourceIds = [
    ...new Set(
      (data ?? [])
        .map((source) => String(source.source_id ?? ""))
        .filter((sourceId) => sourceId.length > 0)
    )
  ];

  if (!sourceIds.length) {
    finishSourceMutation(formData, {
      type: "message",
      message: "No active sources to scan."
    });
  }

  let summary: SourceScanSummary;
  try {
    summary = await scanSources({ sourceIds });
  } catch (scanError) {
    finishSourceMutation(formData, {
      type: "error",
      message: `Source scan failed: ${getErrorMessage(scanError)}`
    });
  }

  finishSourceMutation(formData, getScanFeedback(summary));
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

function getScanFeedback(summary: SourceScanSummary): {
  type: "message" | "error";
  message: string;
} {
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
    return {
      type: "error",
      message: `Scan finished with ${summary.errorCount} ${pluralize(
        summary.errorCount,
        "error",
        "errors"
      )}: ${processed} processed (${counts}).`
    };
  }

  return {
    type: "message",
    message: `Scan complete: ${processed} processed (${counts}).`
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
