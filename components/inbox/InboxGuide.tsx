export function InboxGuide() {
  return (
    <div className="read-guide" aria-labelledby="read-guide-heading">
      <h2 id="read-guide-heading">How to read this inbox</h2>
      <div className="guide-terms">
        <p>
          <strong>New</strong> first appeared in the latest successful source
          run. <strong>Known</strong> has appeared before.
        </p>
        <p>
          <strong>Unreviewed</strong> still needs a decision.{" "}
          <strong>Reviewed</strong> has been acknowledged and leaves the active
          inbox unless you save, archive, or hide it.
        </p>
        <p>
          <strong>Saved</strong> is kept for later.{" "}
          <strong>Archived</strong> is cleared out but traceable.{" "}
          <strong>Hidden</strong> is suppressed from normal work.
        </p>
      </div>
    </div>
  );
}

