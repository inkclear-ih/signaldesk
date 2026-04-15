"use client";

import { useFormStatus } from "react-dom";

export function RescanSourcesButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="button button-secondary button-compact"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? "Scanning..." : "Rescan sources"}
    </button>
  );
}
