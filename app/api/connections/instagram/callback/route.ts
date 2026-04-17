import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  INSTAGRAM_SOURCE_FAMILY,
  META_INSTAGRAM_PROVIDER,
  MetaInstagramApiError,
  MetaInstagramConfigurationError,
  computeNextInstagramRefreshAt,
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getConnectedInstagramAccounts,
  getMetaInstagramAppConfig
} from "@/lib/instagram/meta";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addConnectionFeedbackParam,
  clearInstagramStateCookie,
  decodeInstagramStateCookie,
  getInstagramStateCookieName
} from "../state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const stateCookie = decodeInstagramStateCookie(
    cookies().get(getInstagramStateCookieName())?.value
  );
  const returnTo = stateCookie?.returnTo ?? "/";
  const redirectUrl = new URL(returnTo, request.url);

  if (!stateCookie || requestUrl.searchParams.get("state") !== stateCookie.state) {
    return clearInstagramStateCookie(
      NextResponse.redirect(
        addConnectionFeedbackParam(
          redirectUrl,
          "sourceError",
          "Instagram connection expired. Try connecting again."
        )
      )
    );
  }

  const deniedError =
    requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error_message") ??
    requestUrl.searchParams.get("error");
  if (deniedError) {
    return clearInstagramStateCookie(
      NextResponse.redirect(
        addConnectionFeedbackParam(
          redirectUrl,
          "sourceError",
          `Instagram connection was not completed: ${deniedError}`
        )
      )
    );
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return clearInstagramStateCookie(
      NextResponse.redirect(
        addConnectionFeedbackParam(
          redirectUrl,
          "sourceError",
          "Instagram connection did not return an OAuth code."
        )
      )
    );
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return clearInstagramStateCookie(NextResponse.redirect(new URL("/", request.url)));
  }

  try {
    const now = new Date().toISOString();
    const config = getMetaInstagramAppConfig(getRequestOrigin(request));
    const shortLivedToken = await exchangeCodeForShortLivedToken({
      code,
      config
    });
    const longLivedToken = await exchangeForLongLivedToken({
      accessToken: shortLivedToken.accessToken,
      config
    });
    const accounts = await getConnectedInstagramAccounts({
      accessToken: longLivedToken.accessToken,
      config
    });
    const account = accounts[0];

    if (!account) {
      return clearInstagramStateCookie(
        NextResponse.redirect(
          addConnectionFeedbackParam(
            redirectUrl,
            "sourceError",
            "No Instagram professional account was found. Connect an Instagram professional account to a Facebook Page, then try again."
          )
        )
      );
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("user_provider_connections").upsert(
      {
        user_id: user.id,
        source_family: INSTAGRAM_SOURCE_FAMILY,
        provider: META_INSTAGRAM_PROVIDER,
        status: "connected",
        access_token: longLivedToken.accessToken,
        refresh_token: null,
        token_type: longLivedToken.tokenType,
        token_expires_at: longLivedToken.expiresAt,
        refresh_expires_at: null,
        last_refreshed_at: now,
        next_refresh_at: computeNextInstagramRefreshAt(longLivedToken.expiresAt),
        refresh_attempted_at: null,
        refresh_error: null,
        refresh_metadata: {
          supports_refresh: true,
          refresh_method: "fb_exchange_token",
          token_source: "facebook_login_long_lived_user_token",
          last_exchange_at: now,
          last_exchange_expires_in: longLivedToken.expiresIn
        },
        instagram_business_account_id: account.instagramBusinessAccountId,
        connected_username: account.username,
        display_name: account.displayName,
        metadata: {
          page_id: account.pageId,
          page_name: account.pageName,
          profile_picture_url: account.profilePictureUrl,
          available_instagram_account_count: accounts.length,
          scopes: config.scopes
        },
        disconnected_at: null
      },
      { onConflict: "user_id,provider" }
    );

    if (error) {
      throw new Error(`Could not save Instagram connection: ${error.message}`);
    }

    return clearInstagramStateCookie(
      NextResponse.redirect(
        addConnectionFeedbackParam(
          redirectUrl,
          "sourceMessage",
          `Instagram connected${
            account.username ? ` as @${account.username}` : ""
          }.`
        )
      )
    );
  } catch (error) {
    return clearInstagramStateCookie(
      NextResponse.redirect(
        addConnectionFeedbackParam(redirectUrl, "sourceError", getConnectionErrorMessage(error))
      )
    );
  }
}

function getRequestOrigin(request: Request): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const url = new URL(request.url);
  return url.origin;
}

function getConnectionErrorMessage(error: unknown): string {
  if (
    error instanceof MetaInstagramApiError ||
    error instanceof MetaInstagramConfigurationError
  ) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Could not connect Instagram.";
}
