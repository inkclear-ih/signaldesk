import { cleanText } from "@/lib/inbox/formatting";
import { validateFeedUrl, type ValidatedFeed } from "@/lib/sources/feed";

const MAX_PAGE_BYTES = 1024 * 1024;
const PAGE_TIMEOUT_MS = 8000;
const MAX_HTML_FEED_LINKS = 8;
const MAX_FALLBACK_LINKS = 10;

const FEED_LINK_TYPES = new Set([
  "application/atom+xml",
  "application/rss+xml"
]);

const ROOT_FALLBACK_PATHS = [
  "/feed",
  "/feed/",
  "/feed.xml",
  "/rss.xml",
  "/atom.xml"
];

const SECTION_FALLBACK_PATHS = ["feed", "feed/", "rss.xml", "atom.xml"];

type CandidateSource = "html" | "fallback" | "direct";

type CandidateInput = {
  url: string;
  title: string | null;
  source: CandidateSource;
};

export type FeedDiscoveryCandidate = Pick<
  ValidatedFeed,
  "feedUrl" | "name" | "siteUrl" | "type"
> & {
  discoveryTitle: string | null;
  source: CandidateSource;
};

export type FeedDiscoveryResult = {
  pageUrl: string;
  candidates: FeedDiscoveryCandidate[];
};

type FeedDiscoveryErrorCode =
  | "invalid-url"
  | "fetch-error"
  | "http-error"
  | "unsupported-page"
  | "page-too-large";

export class FeedDiscoveryError extends Error {
  constructor(
    message: string,
    readonly code: FeedDiscoveryErrorCode
  ) {
    super(message);
    this.name = "FeedDiscoveryError";
  }
}

export async function discoverFeedsFromWebsite(
  input: string
): Promise<FeedDiscoveryResult> {
  const requestedUrl = normalizeWebsiteUrl(input);
  const response = await fetchWebsitePage(requestedUrl);
  const pageUrl = normalizeDiscoveredUrl(response.url || requestedUrl, requestedUrl);
  const contentType = response.headers.get("content-type");
  const pageText = await readLimitedResponse(response);

  const directFeed = await validateDirectFeed(pageText, pageUrl);
  if (directFeed) {
    return {
      pageUrl,
      candidates: [
        {
          feedUrl: directFeed.feedUrl,
          name: directFeed.name,
          siteUrl: directFeed.siteUrl,
          type: directFeed.type,
          discoveryTitle: directFeed.name,
          source: "direct"
        }
      ]
    };
  }

  const htmlCandidates = extractHtmlFeedLinks(pageText, pageUrl).slice(
    0,
    MAX_HTML_FEED_LINKS
  );
  const validatedHtmlCandidates = await validateCandidates(htmlCandidates);

  if (validatedHtmlCandidates.length > 0) {
    return {
      pageUrl,
      candidates: validatedHtmlCandidates
    };
  }

  if (!isLikelyHtml(contentType, pageText)) {
    throw new FeedDiscoveryError(
      "That URL did not return an HTML page or RSS/Atom feed.",
      "unsupported-page"
    );
  }

  const fallbackCandidates = buildSameOriginFallbacks(pageUrl).slice(
    0,
    MAX_FALLBACK_LINKS
  );

  return {
    pageUrl,
    candidates: await validateCandidates(fallbackCandidates)
  };
}

function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new FeedDiscoveryError("Enter a website URL.", "invalid-url");
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new FeedDiscoveryError("Enter a valid website URL.", "invalid-url");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FeedDiscoveryError(
      "Website URL must start with http:// or https://.",
      "invalid-url"
    );
  }

  if (url.username || url.password) {
    throw new FeedDiscoveryError(
      "Website URL cannot include credentials.",
      "invalid-url"
    );
  }

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

async function fetchWebsitePage(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept:
          "text/html, application/xhtml+xml, application/rss+xml;q=0.9, application/atom+xml;q=0.9, application/xml;q=0.7, text/xml;q=0.7, */*;q=0.4",
        "user-agent": "Signaldesk/0.1 feed discovery"
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    });
  } catch (error) {
    throw new FeedDiscoveryError(
      `Could not fetch that website: ${getErrorMessage(error)}`,
      "fetch-error"
    );
  }

  if (!response.ok) {
    throw new FeedDiscoveryError(
      `Website returned HTTP ${response.status}.`,
      "http-error"
    );
  }

  return response;
}

async function readLimitedResponse(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_PAGE_BYTES) {
      throw new FeedDiscoveryError("Website response is too large.", "page-too-large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    received += value.byteLength;
    if (received > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new FeedDiscoveryError("Website response is too large.", "page-too-large");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function validateDirectFeed(
  pageText: string,
  pageUrl: string
): Promise<ValidatedFeed | null> {
  if (!looksLikeFeed(pageText)) {
    return null;
  }

  try {
    return await validateFeedUrl(pageUrl);
  } catch {
    return null;
  }
}

async function validateCandidates(
  candidates: CandidateInput[]
): Promise<FeedDiscoveryCandidate[]> {
  const uniqueCandidates = dedupeCandidateInputs(candidates);
  const settled = await Promise.all(
    uniqueCandidates.map(async (candidate) => {
      try {
        const feed = await validateFeedUrl(candidate.url);
        return { candidate, feed };
      } catch {
        return null;
      }
    })
  );

  const seenFeedUrls = new Set<string>();
  const feeds: FeedDiscoveryCandidate[] = [];

  for (const result of settled) {
    if (!result || seenFeedUrls.has(result.feed.feedUrl)) {
      continue;
    }
    seenFeedUrls.add(result.feed.feedUrl);
    feeds.push({
      feedUrl: result.feed.feedUrl,
      name: result.feed.name,
      siteUrl: result.feed.siteUrl,
      type: result.feed.type,
      discoveryTitle: result.candidate.title,
      source: result.candidate.source
    });
  }

  return feeds;
}

function extractHtmlFeedLinks(html: string, baseUrl: string): CandidateInput[] {
  const candidates: CandidateInput[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];

  for (const tag of linkTags) {
    const attributes = parseAttributes(tag);
    const relTokens = (attributes.get("rel") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (!relTokens.includes("alternate")) {
      continue;
    }

    const type = (attributes.get("type") ?? "").toLowerCase().split(";")[0].trim();
    if (!FEED_LINK_TYPES.has(type)) {
      continue;
    }

    const href = attributes.get("href");
    if (!href) {
      continue;
    }

    const normalizedUrl = normalizeOptionalDiscoveredUrl(href, baseUrl);
    if (!normalizedUrl) {
      continue;
    }

    candidates.push({
      url: normalizedUrl,
      title: cleanText(attributes.get("title") ?? null),
      source: "html"
    });
  }

  return candidates;
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const content = tag.replace(/^<link\b/i, "").replace(/\/?>$/i, "");
  const matches = content.matchAll(
    /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  );

  for (const match of matches) {
    const name = match[1]?.toLowerCase();
    if (!name) {
      continue;
    }
    attributes.set(name, decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? ""));
  }

  return attributes;
}

function buildSameOriginFallbacks(pageUrl: string): CandidateInput[] {
  const url = new URL(pageUrl);
  const candidates = ROOT_FALLBACK_PATHS.map((path) => ({
    url: new URL(path, url.origin).toString(),
    title: null,
    source: "fallback" as const
  }));

  const sectionPath = getSectionPath(url.pathname);
  if (sectionPath) {
    for (const path of SECTION_FALLBACK_PATHS) {
      candidates.push({
        url: new URL(`${sectionPath}/${path}`, url.origin).toString(),
        title: null,
        source: "fallback"
      });
    }
  }

  return dedupeCandidateInputs(candidates);
}

function getSectionPath(pathname: string): string | null {
  const trimmed = pathname.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") {
    return null;
  }

  const segments = trimmed.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }

  const lastSegment = segments[segments.length - 1] ?? "";
  if (/\.[a-z0-9]{2,8}$/i.test(lastSegment)) {
    segments.pop();
  }

  if (!segments.length) {
    return null;
  }

  return `/${segments.join("/")}`;
}

function dedupeCandidateInputs(candidates: CandidateInput[]): CandidateInput[] {
  const seen = new Set<string>();
  const unique: CandidateInput[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.url)) {
      continue;
    }
    seen.add(candidate.url);
    unique.push(candidate);
  }

  return unique;
}

function normalizeOptionalDiscoveredUrl(value: string, baseUrl: string): string | null {
  try {
    return normalizeDiscoveredUrl(value, baseUrl);
  } catch {
    return null;
  }
}

function normalizeDiscoveredUrl(value: string, baseUrl: string): string {
  const url = new URL(value, baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported URL protocol.");
  }

  if (url.username || url.password) {
    throw new Error("URL cannot include credentials.");
  }

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

function isLikelyHtml(contentType: string | null, text: string): boolean {
  const normalizedContentType = contentType?.toLowerCase() ?? "";
  return (
    normalizedContentType.includes("text/html") ||
    normalizedContentType.includes("application/xhtml+xml") ||
    /<html[\s>]/i.test(text) ||
    /<link\b/i.test(text)
  );
}

function looksLikeFeed(text: string): boolean {
  const trimmed = text.trimStart().slice(0, 500);
  return /^<\?xml\b/i.test(trimmed)
    ? /<(rss|feed)\b/i.test(trimmed)
    : /^<(rss|feed)\b/i.test(trimmed);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown fetch error.";
}
