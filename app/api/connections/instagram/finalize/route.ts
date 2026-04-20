import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  INSTAGRAM_SOURCE_FAMILY,
  META_INSTAGRAM_PROVIDER,
  MetaInstagramApiError,
  MetaInstagramConfigurationError,
  computeNextInstagramRefreshAt,
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

type FinalizePayload = {
  fragment?: Record<string, unknown>;
};

type FinalizeResponse = {
  ok: boolean;
  redirectTo: string;
  error?: string;
};

export async function POST(request: Request) {
  const stateCookie = decodeInstagramStateCookie(
    cookies().get(getInstagramStateCookieName())?.value
  );
  const returnTo = stateCookie?.returnTo ?? "/";
  const redirectUrl = new URL(returnTo, request.url);
  const fragment = await readFragmentPayload(request);

  if (!stateCookie || getFragmentString(fragment, "state") !== stateCookie.state) {
    return jsonAndClearState(
      addConnectionFeedbackParam(
        redirectUrl,
        "sourceError",
        "Instagram connection expired. Try connecting again."
      ),
      false
    );
  }

  const deniedError =
    getFragmentString(fragment, "error_description") ??
    getFragmentString(fragment, "error_message") ??
    getFragmentString(fragment, "error");
  if (deniedError) {
    return jsonAndClearState(
      addConnectionFeedbackParam(
        redirectUrl,
        "sourceError",
        `Instagram connection was not completed: ${deniedError}`
      ),
      false
    );
  }

  const tokenSource = getFragmentString(fragment, "long_lived_token")
    ? "facebook_login_business_fragment_long_lived_token"
    : "facebook_login_business_fragment_access_token";
  const accessToken =
    getFragmentString(fragment, "long_lived_token") ??
    getFragmentString(fragment, "access_token");

  if (!accessToken) {
    return jsonAndClearState(
      addConnectionFeedbackParam(
        redirectUrl,
        "sourceError",
        "Instagram connection did not return an access token."
      ),
      false
    );
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonAndClearState(new URL("/", request.url), false);
  }

  try {
    const now = new Date().toISOString();
    const config = getMetaInstagramAppConfig(getRequestOrigin(request));
    const expiresIn = getFragmentNumber(fragment, "expires_in");
    const expiresAt =
      typeof expiresIn === "number"
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : null;
    const dataAccessExpiresAt = getUnixTimestampAsIso(
      getFragmentNumber(fragment, "data_access_expiration_time")
    );
    const accounts = await getConnectedInstagramAccounts({
      accessToken,
      config
    });
    const account = accounts[0];

    if (!account) {
      return jsonAndClearState(
        addConnectionFeedbackParam(
          redirectUrl,
          "sourceError",
          "No Instagram professional account was found. Connect an Instagram professional account to a Facebook Page, then try again."
        ),
        false
      );
    }

    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("user_provider_connections").upsert(
      {
        user_id: user.id,
        source_family: INSTAGRAM_SOURCE_FAMILY,
        provider: META_INSTAGRAM_PROVIDER,
        status: "connected",
        access_token: accessToken,
        refresh_token: null,
        token_type: getFragmentString(fragment, "token_type"),
        token_expires_at: expiresAt,
        refresh_expires_at: null,
        last_refreshed_at: now,
        next_refresh_at: computeNextInstagramRefreshAt(expiresAt),
        refresh_attempted_at: null,
        refresh_error: null,
        refresh_metadata: {
          supports_refresh: false,
          refresh_method: null,
          token_source: tokenSource,
          last_exchange_at: now,
          last_exchange_expires_in: expiresIn,
          data_access_expires_at: dataAccessExpiresAt
        },
        instagram_business_account_id: account.instagramBusinessAccountId,
        connected_username: account.username,
        display_name: account.displayName,
        metadata: {
          page_id: account.pageId,
          page_name: account.pageName,
          profile_picture_url: account.profilePictureUrl,
          available_instagram_account_count: accounts.length,
          scopes: config.scopes,
          fragment_fields: getSafeFragmentMetadata(fragment)
        },
        disconnected_at: null
      },
      { onConflict: "user_id,provider" }
    );

    if (error) {
      throw new Error(`Could not save Instagram connection: ${error.message}`);
    }

    return jsonAndClearState(
      addConnectionFeedbackParam(
        redirectUrl,
        "sourceMessage",
        `Instagram connected${
          account.username ? ` as @${account.username}` : ""
        }.`
      ),
      true
    );
  } catch (error) {
    return jsonAndClearState(
      addConnectionFeedbackParam(
        redirectUrl,
        "sourceError",
        getConnectionErrorMessage(error)
      ),
      false
    );
  }
}

async function readFragmentPayload(
  request: Request
): Promise<Record<string, string>> {
  const payload = (await request.json().catch(() => ({}))) as FinalizePayload;
  const fragment = payload.fragment ?? {};

  return Object.fromEntries(
    Object.entries(fragment)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, value]) => [key, value.trim()])
  );
}

function getFragmentString(
  fragment: Record<string, string>,
  key: string
): string | null {
  const value = fragment[key];
  return value ? value : null;
}

function getFragmentNumber(
  fragment: Record<string, string>,
  key: string
): number | null {
  const value = getFragmentString(fragment, key);
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getUnixTimestampAsIso(value: number | null): string | null {
  if (typeof value !== "number") {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function getSafeFragmentMetadata(
  fragment: Record<string, string>
): Record<string, string> {
  const sensitiveKeys = new Set(["access_token", "long_lived_token"]);

  return Object.fromEntries(
    Object.entries(fragment)
      .filter(([key]) => !sensitiveKeys.has(key))
      .map(([key, value]) => [key, value.slice(0, 512)])
  );
}

function jsonAndClearState(url: URL, ok: boolean) {
  const response = NextResponse.json<FinalizeResponse>({
    ok,
    redirectTo: url.toString(),
    error: ok ? undefined : url.searchParams.get("sourceError") ?? undefined
  });
  return clearInstagramStateCookie(response);
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
