import { cleanText } from "@/lib/inbox/formatting";

const MAX_FEED_BYTES = 1024 * 1024;
const FEED_TIMEOUT_MS = 8000;

export type ValidatedFeed = {
  feedUrl: string;
  name: string;
  siteUrl: string | null;
  type: "rss" | "atom";
};

export async function validateFeedUrl(input: string): Promise<ValidatedFeed> {
  const requestedUrl = normalizeFeedUrl(input);
  const response = await fetch(requestedUrl, {
    cache: "no-store",
    headers: {
      accept:
        "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
      "user-agent": "Signaldesk/0.1 feed validator"
    },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`Feed returned HTTP ${response.status}.`);
  }

  const xml = await readLimitedResponse(response);
  const feedUrl = normalizeFeedUrl(response.url || requestedUrl);
  const parsed = parseFeed(xml, feedUrl);

  return {
    feedUrl,
    ...parsed
  };
}

function normalizeFeedUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Enter a feed URL.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid feed URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Feed URL must start with http:// or https://.");
  }

  if (url.username || url.password) {
    throw new Error("Feed URL cannot include credentials.");
  }

  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

async function readLimitedResponse(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_FEED_BYTES) {
      throw new Error("Feed response is too large.");
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
    if (received > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new Error("Feed response is too large.");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function parseFeed(
  xml: string,
  feedUrl: string
): Omit<ValidatedFeed, "feedUrl"> {
  if (!xml.trim()) {
    throw new Error("Feed response was empty.");
  }

  if (/<rss[\s>]/i.test(xml)) {
    const channel = extractRawElement(xml, "channel") ?? xml;
    const name = extractElement(channel, "title") ?? fallbackName(feedUrl);
    const siteUrl = normalizeOptionalUrl(extractElement(channel, "link"), feedUrl);
    return { type: "rss", name, siteUrl };
  }

  if (/<feed[\s>]/i.test(xml)) {
    const name = extractElement(xml, "title") ?? fallbackName(feedUrl);
    const siteUrl = normalizeOptionalUrl(extractAtomSiteUrl(xml), feedUrl);
    return { type: "atom", name, siteUrl };
  }

  throw new Error("That URL did not return an RSS or Atom feed.");
}

function extractElement(xml: string, name: string): string | null {
  const rawValue = extractRawElement(xml, name);
  if (!rawValue) {
    return null;
  }

  return cleanText(unwrapCdata(rawValue));
}

function extractRawElement(xml: string, name: string): string | null {
  const match = xml.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")
  );
  return match?.[1] ?? null;
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function extractAtomSiteUrl(xml: string): string | null {
  const links = Array.from(xml.matchAll(/<link\b([^>]*?)\/?>/gi));
  const alternate =
    links.find((link) => {
      const rel = extractAttribute(link[1], "rel");
      return !rel || rel.toLowerCase() === "alternate";
    }) ?? links[0];

  return alternate ? extractAttribute(alternate[1], "href") : null;
}

function extractAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
  );
  return cleanText(match?.[1] ?? match?.[2] ?? null);
}

function normalizeOptionalUrl(value: string | null, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return null;
  }
}

function fallbackName(feedUrl: string): string {
  return new URL(feedUrl).hostname.replace(/^www\./, "");
}
