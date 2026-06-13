import { NextResponse } from "next/server";

import { extractRowsFromTranscript, transcribeAudio } from "@/lib/ai";
import { buildWorkbook } from "@/lib/excel";
import type { ExtractionRow } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function normalizeDisplaySummary(summary: string) {
  return summary
    .replace(/\bcars\b/gi, "two wheelers")
    .replace(/\bcar\b/gi, "two wheeler");
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

    const transcription = await transcribeAudio(audioFile);
    let rows;

    try {
      rows = await extractRowsFromTranscript({
        transcript: transcription.text
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unexpected extraction error.";

      return NextResponse.json(
        {
          error: `Transcription succeeded with ${transcription.provider}, but transcript extraction failed via OpenAI: ${message}`,
          transcriptionProvider: transcription.provider,
          summary: normalizeDisplaySummary(transcription.text)
        },
        { status: 500 }
      );
    }

    const workbookBuffer = buildWorkbook(rows);

    return NextResponse.json({
      fileName: `${audioFile.name.replace(/\.[^/.]+$/, "") || "conversation"}-data.xlsx`,
      transcriptionProvider: transcription.provider,
      summary: normalizeDisplaySummary(transcription.text),
      workbookBase64: workbookBuffer.toString("base64")
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected processing error.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
