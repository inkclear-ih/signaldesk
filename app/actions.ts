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
import {
  INSTAGRAM_SOURCE_FAMILY,
  META_INSTAGRAM_PROVIDER,
  MetaInstagramApiError,
  MetaInstagramConfigurationError,
  resolveBootstrapInstagramAccount
} from "@/lib/instagram/meta";
import {
  isItemTagColor,
  normalizeItemTagName
} from "@/lib/inbox/item-tags";
import {
  isSourceTagColor,
  normalizeSourceTagName
} from "@/lib/inbox/source-tags";
import type { ItemTag, SourceTag } from "@/lib/inbox/types";

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

export async function bootstrapInstagramConnection(formData: FormData) {
  if (!isInstagramBootstrapAllowed()) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Instagram bootstrap is not enabled."
    });
  }

  const rawAccount = String(formData.get("instagramBootstrapAccount") ?? "").trim();
  if (!rawAccount) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Enter an Instagram username, profile URL, or account id."
    });
  }

  const { userId } = await getAuthenticatedContext();

  let account;
  try {
    account = await resolveBootstrapInstagramAccount({ accountInput: rawAccount });
  } catch (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: getInstagramBootstrapErrorMessage(error)
    });
  }

  const accessToken = process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN;
  if (!accessToken) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Instagram bootstrap token is not configured."
    });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("user_provider_connections").upsert(
    {
      user_id: userId,
      source_family: INSTAGRAM_SOURCE_FAMILY,
      provider: META_INSTAGRAM_PROVIDER,
      status: "connected",
      access_token: accessToken,
      refresh_token: null,
      token_type: null,
      token_expires_at: null,
      refresh_expires_at: null,
      last_refreshed_at: now,
      next_refresh_at: null,
      refresh_attempted_at: null,
      refresh_error: null,
      refresh_metadata: {
        supports_refresh: false,
        refresh_method: null,
        token_source: "instagram_graph_env_bootstrap",
        last_exchange_at: now
      },
      instagram_business_account_id: account.instagramBusinessAccountId,
      connected_username: account.username,
      display_name: account.displayName,
      metadata: {
        connection_method: "bootstrap",
        bootstrap_source: "manual_known_account",
        bootstrap_resolution_method: account.resolutionMethod,
        profile_picture_url: account.profilePictureUrl,
        configured_business_account_id:
          process.env.INSTAGRAM_GRAPH_BUSINESS_ACCOUNT_ID ?? null
      },
      disconnected_at: null
    },
    { onConflict: "user_id,provider" }
  );

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not save Instagram bootstrap connection."
    });
  }

  finishSourceMutation(formData, {
    type: "message",
    message: `Instagram bootstrap connected${
      account.username ? ` as @${account.username}` : ""
    }.`
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

export async function createSourceTag(formData: FormData) {
  const rawName = String(formData.get("tagName") ?? "");
  const name = normalizeSourceTagName(rawName);
  const color = String(formData.get("tagColor") ?? "");
  const assignUserSourceId = String(formData.get("assignUserSourceId") ?? "").trim();

  if (!name) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Enter a tag name."
    });
  }

  if (!isSourceTagColor(color)) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Choose a tag color from the palette."
    });
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const existingTag = await findExistingSourceTag(supabase, name);

  let sourceTagId = existingTag?.id ?? null;
  let message = existingTag
    ? `${existingTag.name} already exists.`
    : `Created ${name}.`;

  if (!sourceTagId) {
    const { data, error } = await supabase
      .from("source_tags")
      .insert({
        user_id: userId,
        name,
        color
      })
      .select("id,name,color")
      .single();

    if (error) {
      const duplicateTag = await findExistingSourceTag(supabase, name);
      if (!duplicateTag) {
        finishSourceMutation(formData, {
          type: "error",
          message: "Could not create that source tag."
        });
      }

      sourceTagId = duplicateTag.id;
      message = `${duplicateTag.name} already exists.`;
    } else {
      const createdTag = data as SourceTag;
      sourceTagId = createdTag.id;
      message = `Created ${createdTag.name}.`;
    }
  }

  if (assignUserSourceId && sourceTagId) {
    const assigned = await assignTagToSource({
      supabase,
      userId,
      sourceTagId,
      userSourceId: assignUserSourceId
    });

    if (!assigned) {
      finishSourceMutation(formData, {
        type: "error",
        message: "Could not add that tag to the source."
      });
    }

    message = existingTag
      ? `${existingTag.name} added to the source.`
      : `${name} created and added to the source.`;
  }

  finishSourceMutation(formData, {
    type: "message",
    message
  });
}

export async function assignSourceTagToSource(formData: FormData) {
  const userSourceId = getUserSourceId(formData);
  const sourceTagId = String(formData.get("sourceTagId") ?? "").trim();

  if (!userSourceId || !sourceTagId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const assigned = await assignTagToSource({
    supabase,
    userId,
    sourceTagId,
    userSourceId
  });

  if (!assigned) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not add that tag to the source."
    });
  }

  finishSourceMutation(formData, {
    type: "message",
    message: "Source tag added."
  });
}

export async function removeSourceTagFromSource(formData: FormData) {
  const userSourceId = getUserSourceId(formData);
  const sourceTagId = String(formData.get("sourceTagId") ?? "").trim();

  if (!userSourceId || !sourceTagId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const { error } = await supabase
    .from("user_source_tags")
    .delete()
    .eq("user_id", userId)
    .eq("user_source_id", userSourceId)
    .eq("source_tag_id", sourceTagId);

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not remove that tag from the source."
    });
  }

  finishSourceMutation(formData, {
    type: "message",
    message: "Source tag removed."
  });
}

export async function clearSourceTagsFromSource(formData: FormData) {
  const userSourceId = getUserSourceId(formData);

  if (!userSourceId) {
    return;
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const { error } = await supabase
    .from("user_source_tags")
    .delete()
    .eq("user_id", userId)
    .eq("user_source_id", userSourceId);

  if (error) {
    finishSourceMutation(formData, {
      type: "error",
      message: "Could not clear tags from that source."
    });
  }

  finishSourceMutation(formData, {
    type: "message",
    message: "Source tags cleared."
  });
}

export async function createItemTag(formData: FormData) {
  const rawName = String(formData.get("tagName") ?? "");
  const name = normalizeItemTagName(rawName);
  const color = String(formData.get("tagColor") ?? "");
  const assignItemId = getAssignItemId(formData);

  if (!name) {
    finishItemMutation(formData, {
      type: "error",
      message: "Enter a tag name."
    });
  }

  if (!isItemTagColor(color)) {
    finishItemMutation(formData, {
      type: "error",
      message: "Choose a tag color from the palette."
    });
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const existingTag = await findExistingItemTag(supabase, name);

  let itemTagId = existingTag?.id ?? null;
  let message = existingTag
    ? `${existingTag.name} already exists.`
    : `Created ${name}.`;

  if (!itemTagId) {
    const { data, error } = await supabase
      .from("item_tags")
      .insert({
        user_id: userId,
        name,
        color
      })
      .select("id,name,color")
      .single();

    if (error) {
      const duplicateTag = await findExistingItemTag(supabase, name);
      if (!duplicateTag) {
        finishItemMutation(formData, {
          type: "error",
          message: "Could not create that item tag."
        });
        return;
      }

      itemTagId = duplicateTag.id;
      message = `${duplicateTag.name} already exists.`;
    } else {
      const createdTag = data as ItemTag;
      itemTagId = createdTag.id;
      message = `Created ${createdTag.name}.`;
    }
  }

  if (assignItemId && itemTagId) {
    const assigned = await assignTagToItem({
      supabase,
      userId,
      itemId: assignItemId,
      itemTagId
    });

    if (!assigned) {
      finishItemMutation(formData, {
        type: "error",
        message: "Could not add that tag to the item."
      });
    }

    message = existingTag
      ? `${existingTag.name} added to the item.`
      : `${name} created and added to the item.`;
  }

  finishItemMutation(formData, {
    type: "message",
    message
  });
}

export async function assignItemTagToItem(formData: FormData) {
  const itemId = getItemId(formData);
  const itemTagId = String(formData.get("itemTagId") ?? "").trim();

  if (!itemId || !itemTagId) {
    finishItemMutation(formData, {
      type: "error",
      message: "Could not add that tag to the item."
    });
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const assigned = await assignTagToItem({
    supabase,
    userId,
    itemId,
    itemTagId
  });

  if (!assigned) {
    finishItemMutation(formData, {
      type: "error",
      message: "Could not add that tag to the item."
    });
  }

  finishItemMutation(formData, {
    type: "message",
    message: "Item tag added."
  });
}

export async function removeItemTagFromItem(formData: FormData) {
  const itemId = getItemId(formData);
  const itemTagId = String(formData.get("itemTagId") ?? "").trim();

  if (!itemId || !itemTagId) {
    finishItemMutation(formData, {
      type: "error",
      message: "Could not remove that tag from the item."
    });
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const { error } = await supabase
    .from("user_item_tags")
    .delete()
    .eq("user_id", userId)
    .eq("item_id", itemId)
    .eq("item_tag_id", itemTagId);

  if (error) {
    finishItemMutation(formData, {
      type: "error",
      message: "Could not remove that tag from the item."
    });
  }

  finishItemMutation(formData, {
    type: "message",
    message: "Item tag removed."
  });
}

export async function clearItemTagsFromItem(formData: FormData) {
  const itemId = getItemId(formData);

  if (!itemId) {
    finishItemMutation(formData, {
      type: "error",
      message: "Could not clear tags from that item."
    });
  }

  const { supabase, userId } = await getAuthenticatedContext();
  const { error } = await supabase
    .from("user_item_tags")
    .delete()
    .eq("user_id", userId)
    .eq("item_id", itemId);

  if (error) {
    finishItemMutation(formData, {
      type: "error",
      message: "Could not clear tags from that item."
    });
  }

  finishItemMutation(formData, {
    type: "message",
    message: "Item tags cleared."
  });
}

function getItemId(formData: FormData): string {
  return String(formData.get("itemId") ?? "");
}

function getAssignItemId(formData: FormData): string {
  return String(formData.get("assignItemId") ?? "").trim();
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

async function findExistingSourceTag(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  name: string
): Promise<SourceTag | null> {
  const { data, error } = await supabase
    .from("source_tags")
    .select("id,name,color")
    .order("name", { ascending: true });

  if (error) {
    return null;
  }

  const normalizedName = name.toLocaleLowerCase();
  return (
    ((data ?? []) as SourceTag[]).find(
      (tag) => tag.name.toLocaleLowerCase() === normalizedName
    ) ?? null
  );
}

async function findExistingItemTag(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  name: string
): Promise<ItemTag | null> {
  const { data, error } = await supabase
    .from("item_tags")
    .select("id,name,color")
    .order("name", { ascending: true });

  if (error) {
    return null;
  }

  const normalizedName = name.toLocaleLowerCase();
  return (
    ((data ?? []) as ItemTag[]).find(
      (tag) => tag.name.toLocaleLowerCase() === normalizedName
    ) ?? null
  );
}

function isDisposition(value: string): value is Exclude<DispositionState, "none"> {
  return DISPOSITION_STATES.has(value);
}

async function assignTagToSource({
  supabase,
  userId,
  sourceTagId,
  userSourceId
}: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  userId: string;
  sourceTagId: string;
  userSourceId: string;
}): Promise<boolean> {
  const { error } = await supabase.from("user_source_tags").insert({
    user_id: userId,
    user_source_id: userSourceId,
    source_tag_id: sourceTagId
  });

  if (!error) {
    return true;
  }

  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code: string }).code as string)
      : null;

  return errorCode === "23505";
}

async function assignTagToItem({
  supabase,
  userId,
  itemId,
  itemTagId
}: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  userId: string;
  itemId: string;
  itemTagId: string;
}): Promise<boolean> {
  const { error } = await supabase.from("user_item_tags").insert({
    user_id: userId,
    item_id: itemId,
    item_tag_id: itemTagId
  });

  if (!error) {
    return true;
  }

  const errorCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? ((error as { code: string }).code as string)
      : null;

  return errorCode === "23505";
}

function finishItemMutation(
  formData: FormData,
  feedback?: { type: "message" | "error"; message: string }
): never | void {
  revalidatePath("/");
  const returnTo = getSafeReturnTo(formData);
  if (returnTo) {
    redirect(feedback ? addItemFeedbackParam(returnTo, feedback) : clearItemFeedbackParams(returnTo));
  }

  const view = String(formData.get("view") ?? "");

  if (view && view !== "inbox") {
    const path = `/?view=${encodeURIComponent(view)}`;
    redirect(feedback ? addItemFeedbackParam(path, feedback) : clearItemFeedbackParams(path));
  }

  if (feedback) {
    redirect(addItemFeedbackParam("/", feedback));
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

function addItemFeedbackParam(
  path: string,
  feedback: { type: "message" | "error"; message: string }
): string {
  const url = new URL(path, "http://signaldesk.local");
  url.searchParams.delete("itemMessage");
  url.searchParams.delete("itemError");
  url.searchParams.set(
    feedback.type === "message" ? "itemMessage" : "itemError",
    feedback.message
  );
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}

function clearItemFeedbackParams(path: string): string {
  const url = new URL(path, "http://signaldesk.local");
  url.searchParams.delete("itemMessage");
  url.searchParams.delete("itemError");
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

function getInstagramBootstrapErrorMessage(error: unknown): string {
  if (
    error instanceof MetaInstagramApiError ||
    error instanceof MetaInstagramConfigurationError
  ) {
    return error.message;
  }

  return "Could not validate that Instagram account for bootstrap.";
}

function isInstagramBootstrapAllowed(): boolean {
  return process.env.ALLOW_INSTAGRAM_BOOTSTRAP === "true";
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
