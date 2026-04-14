"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const now = new Date().toISOString();
  await supabase.from("user_item_states").upsert(
    {
      user_id: user.id,
      item_id: itemId,
      review_state: "reviewed",
      reviewed_at: now,
      updated_at: now
    },
    { onConflict: "user_id,item_id" }
  );

  revalidatePath("/");
}

export async function markItemUnreviewed(formData: FormData) {
  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) {
    return;
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  await supabase
    .from("user_item_states")
    .delete()
    .eq("user_id", user.id)
    .eq("item_id", itemId);

  revalidatePath("/");
}
