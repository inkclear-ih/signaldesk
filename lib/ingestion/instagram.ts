import { cleanText } from "@/lib/inbox/formatting";
import { getInstagramHandleFromMetadata } from "@/lib/sources/instagram";

export const INSTAGRAM_INGESTION_PENDING_MESSAGE =
  "Instagram professional account ingestion is not connected yet.";

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
};

export type NormalizedInstagramEntry = {
  title: string | null;
  link: string | null;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  raw_guid: string | null;
  raw_payload: Record<string, string | null>;
};

export class InstagramIngestionPendingError extends Error {
  constructor() {
    super(INSTAGRAM_INGESTION_PENDING_MESSAGE);
    this.name = "InstagramIngestionPendingError";
  }
}

export async function fetchInstagramProfessionalAccountPosts(): Promise<
  InstagramRawMediaItem[]
> {
  throw new InstagramIngestionPendingError();
}

export function normalizeInstagramMediaItem(
  source: InstagramSourceForIngestion,
  item: InstagramRawMediaItem
): NormalizedInstagramEntry {
  const handle = getInstagramHandleFromMetadata(source.metadata) ?? source.name;
  const caption = cleanText(item.caption ?? null);
  const link = cleanText(item.permalink ?? item.media_permalink ?? null);
  const publishedAt = parseInstagramTimestamp(item.timestamp ?? null);

  return {
    title: caption ? firstSentence(caption) : `Instagram post from @${handle}`,
    link,
    summary: caption,
    author: `@${handle}`,
    published_at: publishedAt,
    raw_guid: cleanText(item.id),
    raw_payload: {
      id: cleanText(item.id),
      caption,
      permalink: link,
      media_type: cleanText(item.media_type ?? null),
      timestamp: cleanText(item.timestamp ?? null)
    }
  };
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
