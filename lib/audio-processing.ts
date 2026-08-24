import {
  extractRowsFromTranscript,
  generateCallSummary,
  transcribeAudioBuffer
} from "@/lib/ai";
import { buildDriverMetrics, type DriverMetrics } from "@/lib/driver-metrics";
import { buildWorkbook } from "@/lib/excel";

export type AudioProcessingResult = {
  fileName: string;
  transcriptionProvider: string;
  summary: string;
  workbookBase64: string;
  driverMetrics: DriverMetrics;
};

export class AudioProcessingError extends Error {
  payload?: Partial<AudioProcessingResult>;

  constructor(message: string, payload?: Partial<AudioProcessingResult>) {
    super(message);
    this.name = "AudioProcessingError";
    this.payload = payload;
  }
}

export function normalizeDisplaySummary(summary: string) {
  return summary
    .replace(/\bcars\b/gi, "two wheelers")
    .replace(/\bcar\b/gi, "two wheeler");
}

export async function processAudioBuffer(params: {
  audioBuffer: Buffer;
  fileName: string;
}): Promise<AudioProcessingResult> {
  const transcription = await transcribeAudioBuffer(
    params.audioBuffer,
    params.fileName
  );
  const summary = normalizeDisplaySummary(transcription.text);
  let rows;

  try {
    rows = await extractRowsFromTranscript({
      transcript: transcription.text
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected extraction error.";

    throw new AudioProcessingError(
      `Transcription succeeded with ${transcription.provider}, but transcript extraction failed via OpenAI: ${message}`,
      {
        transcriptionProvider: transcription.provider,
        summary
      }
    );
  }

  const driverMetrics = buildDriverMetrics(rows);
  const callSummary = await generateCallSummary({ rows, driverMetrics });
  const workbookBuffer = buildWorkbook(rows, summary, callSummary);

  return {
    fileName: `${params.fileName.replace(/\.[^/.]+$/, "") || "conversation"}-data.xlsx`,
    transcriptionProvider: transcription.provider,
    summary,
    workbookBase64: workbookBuffer.toString("base64"),
    driverMetrics
  };
}
