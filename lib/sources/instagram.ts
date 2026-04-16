const INSTAGRAM_PROFILE_HOSTS = new Set([
  "instagram.com",
  "www.instagram.com"
]);

const RESERVED_PROFILE_PATHS = new Set([
  "accounts",
  "explore",
  "p",
  "reel",
  "reels",
  "stories",
  "tv"
]);

export type NormalizedInstagramAccount = {
  handle: string;
  displayName: string;
  profileUrl: string;
  sourceKey: string;
  metadata: {
    platform: "instagram";
    handle: string;
    profile_url: string;
    account_kind: "professional_or_creator";
    monitoring_scope: "account_posts";
    ingestion_adapter: "instagram_professional_account";
    api_status: "pending_connection";
  };
};

export class InstagramSourceInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramSourceInputError";
  }
}

export function normalizeInstagramAccountInput(
  value: string
): NormalizedInstagramAccount {
  const input = value.trim();
  if (!input) {
    throw new InstagramSourceInputError(
      "Enter an Instagram handle or profile URL."
    );
  }

  const handle = normalizeInstagramHandle(extractHandle(input));
  const profileUrl = `https://www.instagram.com/${handle}/`;

  return {
    handle,
    displayName: `@${handle}`,
    profileUrl,
    sourceKey: `instagram:${handle}`,
    metadata: {
      platform: "instagram",
      handle,
      profile_url: profileUrl,
      account_kind: "professional_or_creator",
      monitoring_scope: "account_posts",
      ingestion_adapter: "instagram_professional_account",
      api_status: "pending_connection"
    }
  };
}

export function getInstagramHandleFromMetadata(
  metadata: unknown
): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const handle = (metadata as { handle?: unknown }).handle;
  return typeof handle === "string" && handle ? handle : null;
}

function extractHandle(input: string): string {
  if (looksLikeInstagramUrl(input)) {
    return extractHandleFromUrl(input);
  }

  return input.replace(/^@+/, "");
}

function looksLikeInstagramUrl(input: string): boolean {
  return /^(https?:\/\/)?(www\.)?instagram\.com\//i.test(input);
}

function extractHandleFromUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input)
    ? input
    : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new InstagramSourceInputError(
      "Enter a valid Instagram profile URL or handle."
    );
  }

  if (!INSTAGRAM_PROFILE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new InstagramSourceInputError(
      "Enter an Instagram profile URL from instagram.com."
    );
  }

  const [firstSegment] = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!firstSegment || RESERVED_PROFILE_PATHS.has(firstSegment.toLowerCase())) {
    throw new InstagramSourceInputError(
      "Paste an Instagram profile URL, not a post, reel, story, or explore page."
    );
  }

  return firstSegment;
}

function normalizeInstagramHandle(value: string): string {
  const handle = value.trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) {
    throw new InstagramSourceInputError(
      "Instagram handles can use letters, numbers, periods, and underscores."
    );
  }

  if (handle.startsWith(".") || handle.endsWith(".") || handle.includes("..")) {
    throw new InstagramSourceInputError(
      "Enter a clean Instagram profile handle."
    );
  }

  return handle;
}
