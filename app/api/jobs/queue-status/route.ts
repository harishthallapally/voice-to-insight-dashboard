import { NextResponse } from "next/server";

import { getAudioQueueStatus } from "@/lib/audio-job-queue";

export const runtime = "nodejs";
// The queue lives in this process's memory, so the answer is only ever
// about the container serving this request, and it changes second to
// second — never serve it from a cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = getAudioQueueStatus();

  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" }
  });
}
