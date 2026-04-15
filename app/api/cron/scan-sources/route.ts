import { NextResponse } from "next/server";
import { scanSources } from "@/lib/ingestion/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await scanSources();
    return NextResponse.json({ ok: summary.errorCount === 0, summary });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error && error.message
            ? error.message
            : "Daily source scan failed."
      },
      { status: 500 }
    );
  }
}
