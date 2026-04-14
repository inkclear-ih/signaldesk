from __future__ import annotations

import html
import json
import re
from pathlib import Path
from typing import Any

from signaldesk.time import utc_now_iso

SUMMARY_MAX_CHARS = 700


def write_report(*, input_path: Path, output_path: Path) -> int:
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    source_stats = _as_list(payload.get("source_stats"))
    items = _as_list(payload.get("items"))

    html_report = render_report(
        generated_at=utc_now_iso(),
        input_path=input_path,
        source_stats=source_stats,
        items=items,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_report, encoding="utf-8")
    return len(items)


def render_report(
    *,
    generated_at: str,
    input_path: Path,
    source_stats: list[dict[str, Any]],
    items: list[dict[str, Any]],
) -> str:
    sources_ok = sum(1 for stat in source_stats if stat.get("status") == "ok")
    sources_error = sum(1 for stat in source_stats if stat.get("status") == "error")
    new_items = sum(1 for item in items if item.get("is_new") is True)
    source_names = sorted(
        {
            _clean_text(item.get("source_name")) or _clean_text(item.get("source_id")) or "Unknown source"
            for item in items
        }
    )

    return "\n".join(
        [
            "<!doctype html>",
            '<html lang="en">',
            "<head>",
            '  <meta charset="utf-8">',
            '  <meta name="viewport" content="width=device-width, initial-scale=1">',
            "  <title>Signaldesk Report</title>",
            "  <style>",
            _css(),
            "  </style>",
            "</head>",
            "<body>",
            '  <main class="page">',
            "    <header>",
            "      <h1>Signaldesk Report</h1>",
            f"      <p>Input: <code>{_escape(str(input_path))}</code></p>",
            "    </header>",
            _render_snapshot_context(
                generated_at=generated_at,
                total_items=len(items),
                new_items=new_items,
                sources_ok=sources_ok,
                sources_error=sources_error,
            ),
            '    <section class="summary" aria-label="Summary">',
            _summary_row("Total items", len(items)),
            _summary_row("New items", new_items),
            _summary_row("Sources ok", sources_ok),
            _summary_row("Sources error", sources_error),
            "    </section>",
            "    <section>",
            "      <h2>Sources</h2>",
            _render_sources(source_stats),
            "    </section>",
            "    <section>",
            "      <h2>Items</h2>",
            '      <div class="controls">',
            '        <label for="source-filter">Source</label>',
            '        <select id="source-filter">',
            '          <option value="">All sources</option>',
            *[
                f'          <option value="{_escape_attr(source_name)}">{_escape(source_name)}</option>'
                for source_name in source_names
            ],
            "        </select>",
            '        <label class="checkbox"><input type="checkbox" id="new-only"> Show new only</label>',
            '        <label class="checkbox"><input type="checkbox" id="unreviewed-only"> Show unreviewed only</label>',
            "      </div>",
            '      <p class="muted" id="item-count"></p>',
            _render_items(items),
            "    </section>",
            "  </main>",
            "  <script>",
            _js(),
            "  </script>",
            "</body>",
            "</html>",
        ]
    )


def _render_snapshot_context(
    *,
    generated_at: str,
    total_items: int,
    new_items: int,
    sources_ok: int,
    sources_error: int,
) -> str:
    return "\n".join(
        [
            '    <section class="snapshot-context" aria-label="Snapshot context">',
            '      <div class="snapshot-note">',
            "        <h2>How to read this snapshot</h2>",
            "        <p>This static page is one selected report snapshot. It does not update continuously after it is generated.</p>",
            "        <p><strong>New</strong> means this is the first time the system has seen the item. <strong>Unreviewed</strong> means this browser has not marked the item as reviewed yet.</p>",
            "      </div>",
            '      <dl class="snapshot-meta">',
            _snapshot_meta_row("Generated", generated_at),
            _snapshot_meta_row("Total items", str(total_items)),
            _snapshot_meta_row("New items", str(new_items)),
            _snapshot_meta_row("Sources ok", str(sources_ok)),
            _snapshot_meta_row("Sources error", str(sources_error)),
            "      </dl>",
            "    </section>",
        ]
    )


def _snapshot_meta_row(label: str, value: str) -> str:
    return "\n".join(
        [
            "        <div>",
            f"          <dt>{_escape(label)}</dt>",
            f"          <dd>{_escape(value)}</dd>",
            "        </div>",
        ]
    )


def _render_sources(source_stats: list[dict[str, Any]]) -> str:
    if not source_stats:
        return '      <p class="empty">No source stats found.</p>'

    rows = [
        '      <div class="source-table">',
        '        <div class="source-row source-head">',
        "          <span>Source</span><span>Status</span><span>Items</span><span>Error</span>",
        "        </div>",
    ]
    for stat in source_stats:
        source_name = _clean_text(stat.get("source_name")) or _clean_text(stat.get("source_id")) or "Unknown source"
        status = _clean_text(stat.get("status")) or "unknown"
        error = _clean_text(stat.get("error")) or ""
        rows.extend(
            [
                '        <div class="source-row">',
                f"          <span>{_escape(source_name)}</span>",
                f'          <span><span class="status status-{_escape_attr(status)}">{_escape(status)}</span></span>',
                f"          <span>{_escape(str(stat.get('fetched_count', 0)))}</span>",
                f"          <span>{_escape(error)}</span>",
                "        </div>",
            ]
        )
    rows.append("      </div>")
    return "\n".join(rows)


def _render_items(items: list[dict[str, Any]]) -> str:
    new_items = [item for item in items if item.get("is_new") is True]
    seen_items = [item for item in items if item.get("is_new") is not True]

    return "\n".join(
        [
            '      <div class="item-sections">',
            _render_item_section(
                title="New items",
                section_key="new",
                items=new_items,
                empty_message="No new items found.",
            ),
            _render_item_section(
                title="Previously seen items",
                section_key="previous",
                items=seen_items,
                empty_message="No previously seen items found.",
            ),
            "      </div>",
        ]
    )


def _render_item_section(
    *,
    title: str,
    section_key: str,
    items: list[dict[str, Any]],
    empty_message: str,
) -> str:
    filter_message = f"No {title.lower()} match the current filters."
    empty_hidden = " hidden" if items else ""
    rendered = [
        f'        <section class="item-section item-section-{_escape_attr(section_key)}" data-section="{_escape_attr(section_key)}">',
        '          <div class="section-header">',
        f"            <h3>{_escape(title)} <span class=\"section-count\">({len(items)})</span></h3>",
        "          </div>",
        f'          <p class="empty section-empty" data-default-message="{_escape_attr(empty_message)}" data-filter-message="{_escape_attr(filter_message)}"{empty_hidden}>{_escape(empty_message)}</p>',
        '          <div class="items">',
    ]
    for item in items:
        rendered.append(_render_item(item))
    rendered.extend(
        [
            "          </div>",
            "        </section>",
        ]
    )
    return "\n".join(rendered)


def _render_item(item: dict[str, Any]) -> str:
    title = _clean_text(item.get("title")) or "Untitled"
    link = _clean_text(item.get("link"))
    source_name = _clean_text(item.get("source_name")) or _clean_text(item.get("source_id")) or "Unknown source"
    published_at = _clean_text(item.get("published_at"))
    summary = _trim_summary(_clean_text(item.get("summary")))
    tags = [str(tag) for tag in _as_list(item.get("tags")) if str(tag).strip()]
    seen_count = item.get("seen_count")
    item_key = _clean_text(item.get("item_key")) or ""
    is_new = item.get("is_new") is True

    title_html = (
        f'<a class="item-link" href="{_escape_attr(link)}">{_escape(title)}</a>'
        if link
        else f"<span>{_escape(title)}</span>"
    )
    tags_html = " ".join(f"<span>{_escape(tag)}</span>" for tag in tags)
    published_html = f"<span>{_escape(published_at)}</span>" if published_at else ""
    seen_html = f"<span>seen_count: {_escape(str(seen_count))}</span>" if seen_count is not None else ""
    summary_html = f'              <p class="summary-text">{_escape(summary)}</p>' if summary else ""
    new_badge = ' <span class="badge">New</span>' if is_new else ""
    unreviewed_badge = ' <span class="badge badge-unreviewed" data-unreviewed-badge>Unreviewed</span>'

    item_class = "item item-new" if is_new else "item"

    return "\n".join(
        [
            f'            <article class="{item_class}" data-source="{_escape_attr(source_name)}" data-new="{str(is_new).lower()}" data-item-key="{_escape_attr(item_key)}">',
            f"              <h4>{title_html}{new_badge}{unreviewed_badge}</h4>",
            f'              <div class="meta"><span>{_escape(source_name)}</span>{published_html}{seen_html}</div>',
            f'              <div class="tags">{tags_html}</div>' if tags_html else '              <div class="tags"></div>',
            summary_html,
            '              <button class="review-toggle" type="button">Mark reviewed</button>',
            "            </article>",
        ]
    )


def _summary_row(label: str, value: int) -> str:
    return "\n".join(
        [
            '      <div class="summary-card">',
            f"        <span>{_escape(label)}</span>",
            f"        <strong>{value}</strong>",
            "      </div>",
        ]
    )


def _css() -> str:
    return """    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #1f2933;
      background: #f7f8fa;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    .page { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    header, section { margin-bottom: 28px; }
    h1, h2, h3, h4 { margin: 0; line-height: 1.2; }
    h1 { font-size: 32px; margin-bottom: 10px; }
    h2 { font-size: 21px; margin-bottom: 12px; }
    h3 { font-size: 17px; margin-bottom: 8px; }
    h4 { font-size: 17px; margin-bottom: 8px; }
    p { margin: 4px 0; }
    code { background: #eef1f4; padding: 2px 5px; border-radius: 4px; }
    a { color: #0b5cad; text-decoration-thickness: 2px; text-underline-offset: 2px; }
    a:hover { color: #083f79; }
    .snapshot-context {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(260px, 0.9fr);
      gap: 16px;
      padding: 16px;
      background: #fff;
      border: 1px solid #d9dee5;
      border-radius: 6px;
    }
    .snapshot-note h2 { margin-bottom: 8px; }
    .snapshot-note p { color: #3f4b57; }
    .snapshot-meta {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      margin: 0;
    }
    .snapshot-meta div { min-width: 0; }
    .snapshot-meta dt { color: #5a6673; font-size: 12px; }
    .snapshot-meta dd { margin: 2px 0 0; font-weight: 700; overflow-wrap: anywhere; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .summary-card, .item, .source-table {
      background: #fff;
      border: 1px solid #d9dee5;
      border-radius: 6px;
    }
    .summary-card { padding: 14px; }
    .summary-card span { display: block; color: #5a6673; font-size: 13px; }
    .summary-card strong { display: block; margin-top: 4px; font-size: 24px; }
    .source-table { overflow: hidden; }
    .source-row {
      display: grid;
      grid-template-columns: 2fr 110px 90px 3fr;
      gap: 12px;
      padding: 10px 12px;
      border-top: 1px solid #e5e9ef;
      align-items: start;
    }
    .source-row:first-child { border-top: 0; }
    .source-head { background: #eef1f4; color: #4a5563; font-weight: 700; font-size: 13px; }
    .status { display: inline-block; padding: 2px 7px; border-radius: 999px; background: #eef1f4; font-size: 12px; }
    .status-ok { background: #e3f5ea; color: #18633a; }
    .status-error { background: #fde7e7; color: #963131; }
    .controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 8px; }
    select { padding: 7px 9px; border: 1px solid #b8c1cc; border-radius: 6px; background: #fff; }
    .checkbox { display: inline-flex; gap: 6px; align-items: center; }
    .muted, .empty { color: #667382; }
    .item-sections { display: grid; gap: 22px; }
    .item-section { margin-bottom: 0; }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid #d9dee5;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .section-header h3 { margin-bottom: 0; }
    .section-count { color: #667382; font-weight: 500; }
    .items { display: grid; gap: 10px; }
    .item { padding: 14px; }
    .item-new { border-color: #d9b44a; border-left: 4px solid #d9b44a; }
    .item[hidden] { display: none; }
    .section-empty[hidden] { display: none; }
    .badge {
      display: inline-block;
      margin-left: 6px;
      padding: 2px 6px;
      border-radius: 6px;
      background: #ffe8a3;
      color: #604200;
      font-size: 12px;
      vertical-align: middle;
    }
    .badge-unreviewed { background: #e6f0ff; color: #17456f; }
    .badge[hidden] { display: none; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; color: #5a6673; font-size: 13px; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
    .tags span { padding: 2px 6px; background: #eef1f4; border-radius: 6px; font-size: 12px; color: #4a5563; }
    .summary-text { margin-top: 10px; color: #2f3b47; }
    .review-toggle {
      margin-top: 10px;
      padding: 5px 8px;
      border: 1px solid #b8c1cc;
      border-radius: 6px;
      background: #fff;
      color: #2f3b47;
      cursor: pointer;
    }
    .review-toggle:hover { background: #eef1f4; }
    @media (min-width: 900px) {
      .item-sections { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
    }
    @media (max-width: 760px) {
      .snapshot-context { grid-template-columns: 1fr; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .source-row { grid-template-columns: 1fr; gap: 4px; }
      .source-head { display: none; }
    }"""


def _js() -> str:
    return """    const sourceFilter = document.getElementById("source-filter");
    const newOnly = document.getElementById("new-only");
    const unreviewedOnly = document.getElementById("unreviewed-only");
    const itemCount = document.getElementById("item-count");
    const sections = Array.from(document.querySelectorAll(".item-section"));
    const items = Array.from(document.querySelectorAll(".item"));
    const storagePrefix = "signaldesk.reviewed.";

    function storageKey(item) {
      return `${storagePrefix}${item.dataset.itemKey}`;
    }

    function isReviewed(item) {
      try {
        return item.dataset.itemKey && localStorage.getItem(storageKey(item)) === "1";
      } catch {
        return false;
      }
    }

    function setReviewed(item, reviewed) {
      if (!item.dataset.itemKey) {
        return;
      }
      try {
        if (reviewed) {
          localStorage.setItem(storageKey(item), "1");
        } else {
          localStorage.removeItem(storageKey(item));
        }
      } catch {
      }
    }

    function syncReviewUi(item) {
      const reviewed = isReviewed(item);
      const badge = item.querySelector("[data-unreviewed-badge]");
      const button = item.querySelector(".review-toggle");
      item.dataset.reviewed = reviewed ? "true" : "false";
      badge.hidden = reviewed;
      button.textContent = reviewed ? "Mark unreviewed" : "Mark reviewed";
    }

    function applyFilters() {
      const source = sourceFilter.value;
      const onlyNew = newOnly.checked;
      const onlyUnreviewed = unreviewedOnly.checked;
      let visible = 0;

      for (const section of sections) {
        const sectionItems = Array.from(section.querySelectorAll(".item"));
        const count = section.querySelector(".section-count");
        const empty = section.querySelector(".section-empty");
        let sectionVisible = 0;

        for (const item of sectionItems) {
          const matchesSource = !source || item.dataset.source === source;
          const matchesNew = !onlyNew || item.dataset.new === "true";
          const matchesUnreviewed = !onlyUnreviewed || item.dataset.reviewed !== "true";
          const show = matchesSource && matchesNew && matchesUnreviewed;
          item.hidden = !show;
          if (show) {
            sectionVisible += 1;
            visible += 1;
          }
        }

        count.textContent = `(${sectionVisible})`;
        empty.hidden = sectionVisible > 0;
        empty.textContent = sectionItems.length === 0 ? empty.dataset.defaultMessage : empty.dataset.filterMessage;
      }

      itemCount.textContent = `${visible} of ${items.length} items shown`;
    }

    for (const item of items) {
      syncReviewUi(item);
      const link = item.querySelector(".item-link");
      const button = item.querySelector(".review-toggle");

      if (link) {
        link.addEventListener("click", () => {
          setReviewed(item, true);
          syncReviewUi(item);
          applyFilters();
        });
      }

      button.addEventListener("click", () => {
        setReviewed(item, !isReviewed(item));
        syncReviewUi(item);
        applyFilters();
      });
    }

    sourceFilter.addEventListener("change", applyFilters);
    newOnly.addEventListener("change", applyFilters);
    unreviewedOnly.addEventListener("change", applyFilters);
    applyFilters();"""


def _as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _trim_summary(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= SUMMARY_MAX_CHARS:
        return value
    trimmed = value[: SUMMARY_MAX_CHARS - 3].rstrip()
    if " " in trimmed:
        trimmed = trimmed.rsplit(" ", 1)[0].rstrip()
    return trimmed + "..."


def _escape(value: str) -> str:
    return html.escape(value, quote=False)


def _escape_attr(value: str) -> str:
    return html.escape(value, quote=True)
