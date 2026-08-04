import { NextResponse } from "next/server";

import { enqueueAudioProcessingJob } from "@/lib/audio-job-queue";
import { safeRecordUploadMetricEvent } from "@/lib/dashboard-metrics-store";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOAD_TRUNCATION_TOLERANCE = 0.95;

function buildTruncationError(receivedBytes: number, declaredBytes: number) {
  return `Upload was truncated on the server (${Math.round(receivedBytes / (1024 * 1024))} MB of ${Math.round(declaredBytes / (1024 * 1024))} MB received). Increase the upload body size limit or split the audio into smaller files.`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");

    if (!(audioFile instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required." },
        { status: 400 }
      );
    }

    if (!audioFile.size) {
      return NextResponse.json(
        { error: "Uploaded audio file is empty." },
        { status: 400 }
      );
    }

    const declaredFileSize = Number(
      request.headers.get("x-original-file-size") || "0"
    );

    if (
      declaredFileSize > 0 &&
      audioFile.size < declaredFileSize * UPLOAD_TRUNCATION_TOLERANCE
    ) {
      return NextResponse.json(
        { error: buildTruncationError(audioFile.size, declaredFileSize) },
        { status: 413 }
      );
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());

    if (!audioBuffer.byteLength) {
      return NextResponse.json(
        { error: "Uploaded audio file is empty." },
        { status: 400 }
      );
    }

    if (
      declaredFileSize > 0 &&
      audioBuffer.byteLength < declaredFileSize * UPLOAD_TRUNCATION_TOLERANCE
    ) {
      return NextResponse.json(
        { error: buildTruncationError(audioBuffer.byteLength, declaredFileSize) },
        { status: 413 }
      );
    }

    const job = await enqueueAudioProcessingJob({
      audioBuffer,
      fileName: audioFile.name
    });
    await safeRecordUploadMetricEvent("upload", audioFile.name);

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected enqueue error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
