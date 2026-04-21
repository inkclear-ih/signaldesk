"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type InboxUiSnapshot = {
  details: Record<string, boolean>;
  restoreOnNextLoad: boolean;
  scrollX: number;
  scrollY: number;
};

const STORAGE_KEY = "signaldesk:inbox-ui-state";

function readSnapshot(): InboxUiSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<InboxUiSnapshot>;

    return {
      details:
        parsed.details && typeof parsed.details === "object" ? parsed.details : {},
      restoreOnNextLoad: parsed.restoreOnNextLoad === true,
      scrollX: typeof parsed.scrollX === "number" ? parsed.scrollX : 0,
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0
    };
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: InboxUiSnapshot) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function collectDetailsState() {
  const details: Record<string, boolean> = {};

  for (const element of document.querySelectorAll<HTMLDetailsElement>(
    "details[data-persist-details-id]"
  )) {
    const id = element.dataset.persistDetailsId;
    if (!id) {
      continue;
    }

    details[id] = element.open;
  }

  return details;
}

function saveSnapshot(restoreOnNextLoad: boolean) {
  writeSnapshot({
    details: collectDetailsState(),
    restoreOnNextLoad,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  });
}

function restoreDetails(details: Record<string, boolean>) {
  for (const element of document.querySelectorAll<HTMLDetailsElement>(
    "details[data-persist-details-id]"
  )) {
    const id = element.dataset.persistDetailsId;
    if (!id || !(id in details)) {
      continue;
    }

    element.open = details[id];
  }
}

export function InboxUiStateController() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isRestoringRef = useRef(false);

  useEffect(() => {
    function handleToggle(event: Event) {
      if (isRestoringRef.current) {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLDetailsElement) || !target.dataset.persistDetailsId) {
        return;
      }

      const snapshot = readSnapshot();
      writeSnapshot({
        details: collectDetailsState(),
        restoreOnNextLoad: snapshot?.restoreOnNextLoad ?? false,
        scrollX: snapshot?.scrollX ?? window.scrollX,
        scrollY: snapshot?.scrollY ?? window.scrollY
      });
    }

    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest("a[data-preserve-inbox-ui]");
      if (!link) {
        return;
      }

      saveSnapshot(true);
    }

    document.addEventListener("toggle", handleToggle, true);
    document.addEventListener("click", handleClick, true);

    return () => {
      document.removeEventListener("toggle", handleToggle, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  useLayoutEffect(() => {
    const snapshot = readSnapshot();
    if (!snapshot?.restoreOnNextLoad) {
      return;
    }

    isRestoringRef.current = true;
    restoreDetails(snapshot.details);
    window.scrollTo({
      left: snapshot.scrollX,
      top: snapshot.scrollY,
      behavior: "auto"
    });
    writeSnapshot({
      ...snapshot,
      details: collectDetailsState(),
      restoreOnNextLoad: false
    });
    isRestoringRef.current = false;
  }, [pathname, searchParams.toString()]);

  return null;
}
