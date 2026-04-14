import { InboxGuide } from "./InboxGuide";
import type { TopMetrics } from "@/lib/inbox/types";

export function InboxOverview({ metrics }: { metrics: TopMetrics }) {
  return (
    <section className="overview-panel" aria-label="Inbox overview">
      <div className="metric-strip" aria-label="Inbox totals">
        <MetricCard label="Total items" value={metrics.totalItems} />
        <MetricCard label="Need attention" value={metrics.needsAttention} />
        <MetricCard label="New items" value={metrics.newItems} />
        <MetricCard label="Reviewed" value={metrics.reviewedItems} />
        <MetricCard label="Sources" value={metrics.sources} />
      </div>

      <InboxGuide />
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

