const DEFAULT_INSTAGRAM_GRAPH_API_VERSION = "v24.0";
const DEFAULT_INSTAGRAM_GRAPH_HOST = "https://graph.facebook.com";
const DEFAULT_META_OAUTH_HOST = "https://www.facebook.com";
const DEFAULT_META_INSTAGRAM_REDIRECT_ORIGIN =
  "https://signaldesk-kappa.vercel.app";
const DEFAULT_META_SCOPES = [
  "instagram_basic",
  "pages_show_list",
  "pages_read_engagement"
];
const META_INSTAGRAM_BUSINESS_LOGIN_EXTRAS = {
  setup: {
    channel: "IG_API_ONBOARDING"
  }
};
const REFRESH_BEFORE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

export const META_INSTAGRAM_PROVIDER = "meta_instagram";
export const INSTAGRAM_SOURCE_FAMILY = "instagram";

export type MetaInstagramAppConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphHost: string;
  oauthHost: string;
  graphVersion: string;
  scopes: string[];
};

export type MetaAccessToken = {
  accessToken: string;
  tokenType: string | null;
  expiresAt: string | null;
  expiresIn: number | null;
};

export type MetaInstagramAccount = {
  instagramBusinessAccountId: string;
  username: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
  pageId: string;
  pageName: string | null;
};

type MetaTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: MetaGraphError;
};

type MetaAccountsResponse = {
  data?: Array<{
    id?: string;
    name?: string | null;
    instagram_business_account?: {
      id?: string;
      username?: string | null;
      name?: string | null;
      profile_picture_url?: string | null;
    } | null;
  }>;
  error?: MetaGraphError;
};

type MetaGraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

export class MetaInstagramConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaInstagramConfigurationError";
  }
}

export class MetaInstagramApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null
  ) {
    super(message);
    this.name = "MetaInstagramApiError";
  }
}

export function getMetaInstagramAppConfig(origin: string): MetaInstagramAppConfig {
  const appId = process.env.META_APP_ID ?? process.env.INSTAGRAM_META_APP_ID;
  const appSecret =
    process.env.META_APP_SECRET ?? process.env.INSTAGRAM_META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new MetaInstagramConfigurationError(
      "Meta app credentials are not configured for Instagram connection."
    );
  }

  return {
    appId,
    appSecret,
    redirectUri:
      process.env.META_INSTAGRAM_REDIRECT_URI ??
      `${getPublicRedirectOrigin(origin)}/connections/instagram/complete`,
    graphHost:
      process.env.INSTAGRAM_GRAPH_HOST ?? DEFAULT_INSTAGRAM_GRAPH_HOST,
    oauthHost: process.env.META_OAUTH_HOST ?? DEFAULT_META_OAUTH_HOST,
    graphVersion:
      process.env.INSTAGRAM_GRAPH_API_VERSION ??
      DEFAULT_INSTAGRAM_GRAPH_API_VERSION,
    scopes: getConfiguredScopes()
  };
}

export function getMetaInstagramRefreshConfig(): Pick<
  MetaInstagramAppConfig,
  "appId" | "appSecret" | "graphHost" | "graphVersion"
> {
  const appId = process.env.META_APP_ID ?? process.env.INSTAGRAM_META_APP_ID;
  const appSecret =
    process.env.META_APP_SECRET ?? process.env.INSTAGRAM_META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new MetaInstagramConfigurationError(
      "Meta app credentials are not configured for Instagram token refresh."
    );
  }

  return {
    appId,
    appSecret,
    graphHost:
      process.env.INSTAGRAM_GRAPH_HOST ?? DEFAULT_INSTAGRAM_GRAPH_HOST,
    graphVersion:
      process.env.INSTAGRAM_GRAPH_API_VERSION ??
      DEFAULT_INSTAGRAM_GRAPH_API_VERSION
  };
}

export function buildMetaInstagramOAuthUrl(
  config: MetaInstagramAppConfig,
  state: string
): string {
  const url = new URL(
    `${config.oauthHost.replace(/\/$/, "")}/dialog/oauth`
  );
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("display", "page");
  url.searchParams.set(
    "extras",
    JSON.stringify(META_INSTAGRAM_BUSINESS_LOGIN_EXTRAS)
  );
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("response_type", "token");
  return url.toString();
}

export async function exchangeCodeForShortLivedToken({
  code,
  config
}: {
  code: string;
  config: MetaInstagramAppConfig;
}): Promise<MetaAccessToken> {
  const url = graphUrl(config, "/oauth/access_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code", code);

  return parseTokenResponse(
    await fetchGraphJson<MetaTokenResponse>(url, "OAuth code exchange")
  );
}

export async function exchangeForLongLivedToken({
  accessToken,
  config
}: {
  accessToken: string;
  config: Pick<
    MetaInstagramAppConfig,
    "appId" | "appSecret" | "graphHost" | "graphVersion"
  >;
}): Promise<MetaAccessToken> {
  const url = graphUrl(config, "/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("fb_exchange_token", accessToken);

  return parseTokenResponse(
    await fetchGraphJson<MetaTokenResponse>(url, "long-lived token exchange")
  );
}

export async function getConnectedInstagramAccounts({
  accessToken,
  config
}: {
  accessToken: string;
  config: Pick<MetaInstagramAppConfig, "graphHost" | "graphVersion">;
}): Promise<MetaInstagramAccount[]> {
  const url = graphUrl(config, "/me/accounts");
  url.searchParams.set(
    "fields",
    [
      "id",
      "name",
      "instagram_business_account{id,username,name,profile_picture_url}"
    ].join(",")
  );
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", accessToken);

  const payload = await fetchGraphJson<MetaAccountsResponse>(
    url,
    "Instagram account discovery"
  );

  return (payload.data ?? [])
    .map((page) => {
      const account = page.instagram_business_account;
      if (!page.id || !account?.id) {
        return null;
      }

      return {
        instagramBusinessAccountId: account.id,
        username: account.username ?? null,
        displayName: account.name ?? account.username ?? page.name ?? null,
        profilePictureUrl: account.profile_picture_url ?? null,
        pageId: page.id,
        pageName: page.name ?? null
      };
    })
    .filter((account): account is MetaInstagramAccount => Boolean(account));
}

export function computeNextInstagramRefreshAt(
  expiresAt: string | null
): string | null {
  if (!expiresAt) {
    return null;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return null;
  }

  return new Date(expiresAtMs - REFRESH_BEFORE_EXPIRY_MS).toISOString();
}

export function isInstagramTokenNearExpiry(
  expiresAt: string | null,
  now = new Date()
): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= now.getTime() + REFRESH_BEFORE_EXPIRY_MS;
}

export function isInstagramTokenExpired(
  expiresAt: string | null,
  now = new Date()
): boolean {
  if (!expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return false;
  }

  return expiresAtMs <= now.getTime();
}

function graphUrl(
  config: Pick<MetaInstagramAppConfig, "graphHost" | "graphVersion">,
  path: string
): URL {
  return new URL(
    `${config.graphHost.replace(/\/$/, "")}/${config.graphVersion}${path}`
  );
}

async function fetchGraphJson<T>(url: URL, operation: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "Signaldesk/0.2 instagram connection"
    }
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: MetaGraphError;
  };

  if (!response.ok) {
    throw new MetaInstagramApiError(
      getMetaGraphErrorMessage(payload.error, response.status, operation),
      response.status
    );
  }

  return payload;
}

function parseTokenResponse(payload: MetaTokenResponse): MetaAccessToken {
  if (!payload.access_token) {
    throw new MetaInstagramApiError(
      "Meta did not return an access token.",
      null
    );
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? null,
    expiresAt:
      typeof payload.expires_in === "number"
        ? new Date(Date.now() + payload.expires_in * 1000).toISOString()
        : null,
    expiresIn:
      typeof payload.expires_in === "number" ? payload.expires_in : null
  };
}

function getConfiguredScopes(): string[] {
  const raw = process.env.META_INSTAGRAM_SCOPES;
  if (!raw) {
    return DEFAULT_META_SCOPES;
  }

  const scopes = raw
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return scopes.length ? scopes : DEFAULT_META_SCOPES;
}

function getPublicRedirectOrigin(origin: string): string {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredSiteUrl) {
    return configuredSiteUrl.replace(/\/$/, "");
  }

  const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionUrl) {
    return `https://${productionUrl
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")}`;
  }

  const normalizedOrigin = origin.replace(/\/$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizedOrigin)) {
    return DEFAULT_META_INSTAGRAM_REDIRECT_ORIGIN;
  }

  return normalizedOrigin;
}

function getMetaGraphErrorMessage(
  error: MetaGraphError | undefined,
  httpStatus: number,
  operation: string
): string {
  if (error?.message) {
    const details = [
      error.type ? `type ${error.type}` : null,
      typeof error.code === "number" ? `code ${error.code}` : null,
      typeof error.error_subcode === "number"
        ? `subcode ${error.error_subcode}`
        : null
    ]
      .filter(Boolean)
      .join(", ");
    return `Meta ${operation} failed with HTTP ${httpStatus}: ${error.message}${
      details ? ` (${details})` : ""
    }.`;
  }

  return `Meta ${operation} failed with HTTP ${httpStatus}.`;
}
