"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type DispositionState = "none" | "saved" | "archived" | "hidden";
type StoredItemState = {
  review_state: "reviewed" | null;
  disposition_state: DispositionState;
  reviewed_at: string | null;
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

function getItemId(formData: FormData): string {
  return String(formData.get("itemId") ?? "");
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

function toInboxPath(path: string): string {
  const url = new URL(path, "http://signaldesk.local");
  url.searchParams.delete("view");
  const search = url.searchParams.toString();
  return search ? `${url.pathname}?${search}` : url.pathname;
}
