import { NextResponse } from "next/server";

import { getAudioProcessingJob } from "@/lib/audio-job-queue";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const job = getAudioProcessingJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job was not found." }, { status: 404 });
  }

  return NextResponse.json({ job });
}
