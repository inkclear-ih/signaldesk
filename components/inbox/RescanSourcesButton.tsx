"use client";

import { useFormStatus } from "react-dom";

export function RescanSourcesButton({
  disabled,
  label = "Rescan sources",
  pendingLabel = "Scanning..."
}: {
  disabled: boolean;
  label?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={`button button-secondary button-compact${pending ? " button-pending" : ""}`}
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
