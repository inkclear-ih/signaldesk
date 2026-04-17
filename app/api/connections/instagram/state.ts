import { NextResponse } from "next/server";

const STATE_COOKIE = "signaldesk_ig_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export type InstagramOAuthState = {
  state: string;
  returnTo: string;
};

export function getInstagramStateCookieName(): string {
  return STATE_COOKIE;
}

export function getInstagramStateCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure
  };
}

export function encodeInstagramStateCookie(value: InstagramOAuthState): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeInstagramStateCookie(
  value: string | undefined
): InstagramOAuthState | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as {
      state?: unknown;
      returnTo?: unknown;
    };

    if (typeof parsed.state !== "string") {
      return null;
    }

    return {
      state: parsed.state,
      returnTo: getSafeReturnTo(
        typeof parsed.returnTo === "string" ? parsed.returnTo : null
      )
    };
  } catch {
    return null;
  }
}

export function clearInstagramStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax"
  });
  return response;
}

export function getSafeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  try {
    const url = new URL(value, "http://signaldesk.local");
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

export function addConnectionFeedbackParam(
  url: URL,
  key: "sourceMessage" | "sourceError",
  message: string
): URL {
  url.searchParams.delete("sourceMessage");
  url.searchParams.delete("sourceError");
  url.searchParams.delete("sourceDiscovery");
  url.searchParams.set(key, message);
  return url;
}
