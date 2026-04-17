import { cleanText } from "@/lib/inbox/formatting";
import type { InstagramCredential } from "@/lib/instagram/connections";
import { getInstagramHandleFromMetadata } from "@/lib/sources/instagram";

export const INSTAGRAM_CONFIG_REQUIRED_MESSAGE =
  "Instagram monitoring requires a connected Instagram professional account. Connect Instagram in Signaldesk, or set INSTAGRAM_GRAPH_ACCESS_TOKEN and INSTAGRAM_GRAPH_BUSINESS_ACCOUNT_ID for the legacy dev fallback.";
export const INSTAGRAM_UNSUPPORTED_SOURCE_MESSAGE =
  "Instagram did not return media for this account. It may be private, unavailable, personal, or outside Instagram professional account discovery access.";

const DEFAULT_INSTAGRAM_GRAPH_API_VERSION = "v24.0";
const DEFAULT_INSTAGRAM_GRAPH_HOST = "https://graph.facebook.com";
const BUSINESS_DISCOVERY_MEDIA_LIMIT = 10;
const BUSINESS_DISCOVERY_ACCOUNT_FIELDS = [
  "username",
  "name",
  "ig_id",
  "profile_picture_url",
  "followers_count",
  "follows_count",
  "media_count"
];
const BUSINESS_DISCOVERY_MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "timestamp"
];

export type InstagramSourceForIngestion = {
  id: string;
  name: string;
  url: string;
  metadata: Record<string, unknown> | null;
};

export type InstagramRawMediaItem = {
  id: string;
  caption?: string | null;
  media_permalink?: string | null;
  permalink?: string | null;
  timestamp?: string | null;
  media_type?: string | null;
  media_product_type?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
  username?: string | null;
  shortcode?: string | null;
  comments_count?: number | null;
  like_count?: number | null;
};

export type NormalizedInstagramEntry = {
  item_key: string | null;
  title: string | null;
  link: string | null;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  raw_guid: string | null;
  raw_payload: Record<string, unknown>;
};

export class InstagramConfigurationError extends Error {
  constructor() {
    super(INSTAGRAM_CONFIG_REQUIRED_MESSAGE);
    this.name = "InstagramConfigurationError";
  }
}

export class InstagramUnsupportedSourceError extends Error {
  constructor(message = INSTAGRAM_UNSUPPORTED_SOURCE_MESSAGE) {
    super(message);
    this.name = "InstagramUnsupportedSourceError";
  }
}

export class InstagramGraphApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null
  ) {
    super(message);
    this.name = "InstagramGraphApiError";
  }
}

type InstagramBusinessDiscoveryResponse = {
  business_discovery?: {
    ig_id?: string;
    name?: string;
    username?: string;
    profile_picture_url?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    media?: {
      data?: InstagramRawMediaItem[];
    };
  } | null;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

export async function fetchInstagramProfessionalAccountPosts(
  source: InstagramSourceForIngestion,
  {
    credential,
    timeoutMs
  }: {
    credential?: InstagramCredential;
    timeoutMs: number;
  }
): Promise<InstagramRawMediaItem[]> {
  const handle = getInstagramHandleFromMetadata(source.metadata);
  if (!handle) {
    throw new InstagramUnsupportedSourceError(
      "Instagram source is missing a normalized handle."
    );
  }

  const accessToken =
    credential?.accessToken ?? process.env.INSTAGRAM_GRAPH_ACCESS_TOKEN;
  const businessAccountId =
    credential?.businessAccountId ??
    process.env.INSTAGRAM_GRAPH_BUSINESS_ACCOUNT_ID;
  if (!accessToken || !businessAccountId) {
    throw new InstagramConfigurationError();
  }

  const graphVersion =
    process.env.INSTAGRAM_GRAPH_API_VERSION ??
    DEFAULT_INSTAGRAM_GRAPH_API_VERSION;
  const graphHost =
    process.env.INSTAGRAM_GRAPH_HOST ?? DEFAULT_INSTAGRAM_GRAPH_HOST;
  const endpointPath = `/${graphVersion}/${businessAccountId}`;
  const fields = buildBusinessDiscoveryFields(handle);
  const url = new URL(`${graphHost.replace(/\/$/, "")}${endpointPath}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);
  const requestDiagnostics = {
    endpoint: endpointPath,
    fields,
    target_username: handle,
    base_ig_user_id: businessAccountId,
    credential_source: credential?.source ?? "env_fallback"
  };

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      "user-agent": "Signaldesk/0.2 instagram source scanner"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = (await response.json().catch(() => ({}))) as
    | InstagramBusinessDiscoveryResponse
    | Record<string, unknown>;

  if (!response.ok) {
    logInstagramGraphFailure({
      httpStatus: response.status,
      payload,
      request: requestDiagnostics
    });
    throw new InstagramGraphApiError(
      getInstagramGraphErrorMessage(payload, response.status, requestDiagnostics),
      response.status
    );
  }

  const discovery = (payload as InstagramBusinessDiscoveryResponse)
    .business_discovery;
  const media = discovery?.media?.data;
  if (!discovery || !Array.isArray(media)) {
    throw new InstagramUnsupportedSourceError();
  }

  return media.slice(0, BUSINESS_DISCOVERY_MEDIA_LIMIT);
}

export function normalizeInstagramMediaItem(
  source: InstagramSourceForIngestion,
  item: InstagramRawMediaItem
): NormalizedInstagramEntry {
  const handle =
    cleanText(item.username ?? null) ??
    getInstagramHandleFromMetadata(source.metadata) ??
    source.name.replace(/^@/, "");
  const caption = cleanText(item.caption ?? null);
  const link =
    cleanText(item.permalink ?? item.media_permalink ?? null) ??
    buildInstagramPermalink(item);
  const publishedAt = parseInstagramTimestamp(item.timestamp ?? null);
  const mediaType = cleanText(item.media_type ?? null);
  const mediaProductType = cleanText(item.media_product_type ?? null);
  const id = cleanText(item.id);

  return {
    item_key: id ? `instagram:${id}` : null,
    title: caption ? firstSentence(caption) : getFallbackTitle(handle, item),
    link,
    summary: caption,
    author: `@${handle}`,
    published_at: publishedAt,
    raw_guid: id,
    raw_payload: {
      platform: "instagram",
      ingestion_adapter: "instagram_graph_business_discovery",
      id,
      caption,
      account_handle: handle,
      permalink: link,
      media_type: mediaType,
      media_product_type: mediaProductType,
      media_url: cleanText(item.media_url ?? null),
      thumbnail_url: cleanText(item.thumbnail_url ?? null),
      timestamp: cleanText(item.timestamp ?? null),
      shortcode: cleanText(item.shortcode ?? null),
      comments_count: item.comments_count ?? null,
      like_count: item.like_count ?? null
    }
  };
}

function buildBusinessDiscoveryFields(handle: string): string {
  const accountFields = BUSINESS_DISCOVERY_ACCOUNT_FIELDS.join(",");
  const mediaFields = BUSINESS_DISCOVERY_MEDIA_FIELDS.join(",");

  return [
    `business_discovery.username(${handle}){`,
    `${accountFields},`,
    `media.limit(${BUSINESS_DISCOVERY_MEDIA_LIMIT}){${mediaFields}}`,
    "}"
  ].join("");
}

function getInstagramGraphErrorMessage(
  payload: InstagramBusinessDiscoveryResponse | Record<string, unknown>,
  httpStatus: number,
  request: {
    endpoint: string;
    fields: string;
    target_username: string;
    base_ig_user_id: string;
    credential_source: string;
  }
): string {
  const error =
    payload && typeof payload === "object"
      ? (payload as InstagramBusinessDiscoveryResponse).error
      : null;
  const errorDetails = error ? ` ${JSON.stringify(error)}` : "";
  const requestDetails = `Request: GET ${request.endpoint}?fields=${request.fields}`;
  if (error?.message) {
    return `Instagram Graph API returned HTTP ${httpStatus}: ${error.message}.${errorDetails} ${requestDetails}`;
  }

  return `Instagram Graph API returned HTTP ${httpStatus}.${errorDetails} ${requestDetails}`;
}

function logInstagramGraphFailure({
  httpStatus,
  payload,
  request
}: {
  httpStatus: number;
  payload: InstagramBusinessDiscoveryResponse | Record<string, unknown>;
  request: {
    endpoint: string;
    fields: string;
    target_username: string;
    base_ig_user_id: string;
    credential_source: string;
  };
}) {
  console.warn(
    "[instagram-ingestion] Graph API request failed",
    JSON.stringify({
      httpStatus,
      request,
      graphError:
        payload && typeof payload === "object"
          ? (payload as InstagramBusinessDiscoveryResponse).error ?? null
          : null
    })
  );
}

function buildInstagramPermalink(item: InstagramRawMediaItem): string | null {
  const shortcode = cleanText(item.shortcode ?? null);
  if (!shortcode) {
    return null;
  }

  const productType = cleanText(item.media_product_type ?? null)?.toUpperCase();
  const path = productType === "REELS" ? "reel" : "p";
  return `https://www.instagram.com/${path}/${shortcode}/`;
}

function getFallbackTitle(
  handle: string,
  item: InstagramRawMediaItem
): string {
  const productType = cleanText(item.media_product_type ?? null)?.toUpperCase();
  const mediaType = cleanText(item.media_type ?? null)?.toUpperCase();
  const label =
    productType === "REELS"
      ? "reel"
      : mediaType === "VIDEO"
        ? "video"
        : mediaType === "CAROUSEL_ALBUM"
          ? "carousel"
          : "post";

  return `Instagram ${label} from @${handle}`;
}

function parseInstagramTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function firstSentence(value: string): string {
  const sentenceEnd = value.search(/[.!?]\s/);
  const sentence = sentenceEnd >= 0 ? value.slice(0, sentenceEnd + 1) : value;
  const trimmed = sentence.trim();
  if (trimmed.length <= 96) {
    return trimmed;
  }

  return `${trimmed.slice(0, 93).trimEnd()}...`;
}
