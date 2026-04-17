import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  MetaInstagramConfigurationError,
  buildMetaInstagramOAuthUrl,
  getMetaInstagramAppConfig
} from "@/lib/instagram/meta";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  addConnectionFeedbackParam,
  encodeInstagramStateCookie,
  getInstagramStateCookieOptions,
  getInstagramStateCookieName,
  getSafeReturnTo
} from "../state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = getSafeReturnTo(requestUrl.searchParams.get("returnTo"));
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    const state = randomUUID();
    const config = getMetaInstagramAppConfig(getRequestOrigin(request));
    cookies().set(
      getInstagramStateCookieName(),
      encodeInstagramStateCookie({ state, returnTo }),
      getInstagramStateCookieOptions(requestUrl.protocol === "https:")
    );

    return NextResponse.redirect(buildMetaInstagramOAuthUrl(config, state));
  } catch (error) {
    return NextResponse.redirect(
      addConnectionFeedbackParam(
        new URL(returnTo, request.url),
        "sourceError",
        error instanceof MetaInstagramConfigurationError
          ? error.message
          : "Could not start Instagram connection."
      )
    );
  }
}

function getRequestOrigin(request: Request): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const url = new URL(request.url);
  return url.origin;
}
