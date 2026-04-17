import {
  clearItemDisposition,
  markItemReviewed,
  markItemUnreviewed,
  restoreItemToInbox,
  setItemDisposition
} from "@/app/actions";
import { Tags } from "./Tags";
import {
  cleanText,
  formatDate,
  formatDisposition,
  formatDispositionAction,
  trimSummary
} from "@/lib/inbox/formatting";
import { InstagramMediaPreview } from "./InstagramMediaPreview";
import type { ReactNode } from "react";
import type { DispositionState, InboxItem, InboxView } from "@/lib/inbox/types";

export function ItemCard({
  item,
  tags,
  activeView,
  returnTo
}: {
  item: InboxItem;
  tags: string[];
  activeView: InboxView;
  returnTo: string;
}) {
  const reviewed = item.review_state === "reviewed";
  const reviewAction = reviewed ? markItemUnreviewed : markItemReviewed;
  const reviewActionLabel = reviewed ? "Mark unreviewed" : "Mark reviewed";
  const title = cleanText(item.title) ?? item.link ?? "Untitled item";
  const summary = trimSummary(cleanText(item.summary));
  const publishedDate = formatDate(item.published_at);
  const removalTarget = reviewed ? "Reviewed" : "Inbox";
  const instagramMedia = getInstagramMedia(item);
  const itemClassName = [
    "item",
    item.system_state === "new" ? "item-new" : null,
    instagramMedia ? "item-instagram" : null
  ]
    .filter(Boolean)
    .join(" ");
  const cardContent = (
    <>
      <div className="item-source">{item.source_name}</div>
      {item.link ? (
        <a className="item-title" href={item.link} rel="noreferrer" target="_blank">
          {title}
        </a>
      ) : (
        <h3 className="item-title">{title}</h3>
      )}
      <div className="published-date">
        {publishedDate ? (
          <time dateTime={item.published_at ?? undefined}>{publishedDate}</time>
        ) : (
          <span>No published date</span>
        )}
      </div>
      {tags.length ? <Tags tags={tags} /> : <div className="tags" />}
      {summary ? <p className="summary-text">{summary}</p> : null}
      <div className="item-status">
        <span className={item.system_state === "new" ? "badge" : "badge badge-known"}>
          {item.system_state === "new" ? "New" : "Known"}
        </span>
        <span className={reviewed ? "badge badge-reviewed" : "badge badge-unreviewed"}>
          {reviewed ? "Reviewed" : "Unreviewed"}
        </span>
        {item.disposition_state !== "none" ? (
          <span className={`badge badge-${item.disposition_state}`}>
            {formatDisposition(item.disposition_state)}
          </span>
        ) : null}
      </div>
      <div className="item-actions" aria-label={`Actions for ${title}`}>
        <ItemActionForm
          action={reviewAction}
          activeView={activeView}
          itemId={item.id}
          returnTo={returnTo}
        >
          {reviewActionLabel}
        </ItemActionForm>
        {item.disposition_state === "none" ? (
          <>
            <DispositionAction
              activeView={activeView}
              disposition="saved"
              itemId={item.id}
              returnTo={returnTo}
            />
            <DispositionAction
              activeView={activeView}
              disposition="archived"
              itemId={item.id}
              returnTo={returnTo}
            />
            <DispositionAction
              activeView={activeView}
              disposition="hidden"
              itemId={item.id}
              returnTo={returnTo}
            />
          </>
        ) : (
          <>
            <p className="item-action-help">
              Removing {item.disposition_state} keeps the review state, so this
              item moves to {removalTarget}. Restoring resets it to unreviewed
              in Inbox.
            </p>
            <ItemActionForm
              action={clearItemDisposition}
              activeView={activeView}
              itemId={item.id}
              returnTo={returnTo}
            >
              Remove {item.disposition_state} state
            </ItemActionForm>
            <ItemActionForm
              action={restoreItemToInbox}
              activeView={activeView}
              itemId={item.id}
              primary
              returnTo={returnTo}
            >
              Restore to inbox
            </ItemActionForm>
          </>
        )}
      </div>
    </>
  );

  return (
    <article className={itemClassName}>
      {instagramMedia ? (
        <div className="item-instagram-layout">
          <div className="item-instagram-media">
            <InstagramMediaPreview
              mediaType={instagramMedia.mediaType}
              mediaUrl={instagramMedia.mediaUrl}
            />
          </div>
          <div className="item-instagram-content">{cardContent}</div>
        </div>
      ) : (
        cardContent
      )}
    </article>
  );
}

function getInstagramMedia(
  item: InboxItem
): { mediaType: string | null; mediaUrl: string | null } | null {
  if (item.source_type !== "instagram") {
    return null;
  }

  const payload = item.raw_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { mediaType: null, mediaUrl: null };
  }

  return {
    mediaType: getPayloadString(payload.media_type),
    mediaUrl: getPayloadString(payload.media_url)
  };
}

function getPayloadString(value: unknown): string | null {
  return typeof value === "string" ? cleanText(value) : null;
}

function DispositionAction({
  activeView,
  disposition,
  itemId,
  returnTo
}: {
  activeView: InboxView;
  disposition: Exclude<DispositionState, "none">;
  itemId: string;
  returnTo: string;
}) {
  return (
    <ItemActionForm
      action={setItemDisposition}
      activeView={activeView}
      itemId={itemId}
      name="disposition"
      returnTo={returnTo}
      value={disposition}
    >
      {formatDispositionAction(disposition)}
    </ItemActionForm>
  );
}

function ItemActionForm({
  action,
  activeView,
  children,
  itemId,
  name,
  primary,
  returnTo,
  value
}: {
  action: (formData: FormData) => Promise<void>;
  activeView: InboxView;
  children: ReactNode;
  itemId: string;
  name?: string;
  primary?: boolean;
  returnTo: string;
  value?: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="view" value={activeView} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {name && value ? <input type="hidden" name={name} value={value} /> : null}
      <button
        className={primary ? "item-action item-action-primary" : "item-action"}
        type="submit"
      >
        {children}
      </button>
    </form>
  );
}
