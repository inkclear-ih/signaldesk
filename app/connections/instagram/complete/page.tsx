"use client";

import { useEffect, useState } from "react";

type CompletionState =
  | { status: "working"; message: string }
  | { status: "error"; message: string };

type FinalizeResponse = {
  ok?: boolean;
  redirectTo?: string;
  error?: string;
};

export default function InstagramConnectionCompletePage() {
  const [completion, setCompletion] = useState<CompletionState>({
    status: "working",
    message: "Completing Instagram connection..."
  });

  useEffect(() => {
    const finalizeConnection = async () => {
      const fragment = parseHashFragment(window.location.hash);

      if (!Object.keys(fragment).length) {
        setCompletion({
          status: "error",
          message: "Instagram did not return connection details."
        });
        return;
      }

      window.history.replaceState(
        null,
        document.title,
        `${window.location.pathname}${window.location.search}`
      );

      try {
        const response = await fetch("/api/connections/instagram/finalize", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ fragment })
        });
        const payload = (await response.json().catch(() => ({}))) as FinalizeResponse;

        if (payload.redirectTo) {
          window.location.replace(payload.redirectTo);
          return;
        }

        setCompletion({
          status: "error",
          message:
            payload.error ??
            "Instagram connection could not be completed. Return to Signaldesk and try again."
        });
      } catch {
        setCompletion({
          status: "error",
          message:
            "Instagram connection could not be completed. Return to Signaldesk and try again."
        });
      }
    };

    void finalizeConnection();
  }, []);

  return (
    <main className="page">
      <section className="panel">
        <div className="brand">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <span className="eyebrow">Signaldesk</span>
          </div>
          <h1>Instagram</h1>
          <p className="muted">{completion.message}</p>
        </div>

        {completion.status === "working" ? (
          <p className="muted">Keep this tab open for a moment.</p>
        ) : (
          <a className="button" href="/">
            Return to Signaldesk
          </a>
        )}
      </section>
    </main>
  );
}

function parseHashFragment(hash: string): Record<string, string> {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(fragment);

  return Object.fromEntries(
    Array.from(params.entries()).filter(([, value]) => value.length > 0)
  );
}
