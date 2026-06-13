import OpenAI from "openai";
import { z } from "zod";

import type { ExtractionRow } from "@/lib/types";

const extractionSchema = z.object({
  rows: z.array(
    z.object({
      speaker: z.string().default("Unknown"),
      timestamp: z.string().default(""),
      topic: z.string().default("General"),
      customerName: z.string().default(""),
      company: z.string().default(""),
      email: z.string().default(""),
      phone: z.string().default(""),
      sentiment: z.string().default("neutral"),
      notes: z.string().default(""),
      nextStep: z.string().default(""),
      rating: z
        .union([z.string(), z.number()])
        .transform((value) => String(value))
        .default(""),
      actionItems: z
        .union([z.string(), z.array(z.string())])
        .transform((value) =>
          Array.isArray(value) ? value.filter(Boolean).join("; ") : value
        )
        .default("")
    })
  )
});

type TranscriptionSegment = {
  start?: number;
  end?: number;
  text?: string;
};

type TranscriptionResult = {
  provider: string;
  text: string;
  segments: Array<{
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }>;
};

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

function normalizeSegments(segments: TranscriptionSegment[] = []) {
  return segments.map((segment) => ({
    start: typeof segment.start === "number" ? segment.start : 0,
    end: typeof segment.end === "number" ? segment.end : 0,
    text: typeof segment.text === "string" ? segment.text : ""
  }));
}

function getClient() {
  const apiKey = getRequiredEnv("OPENAI_API_KEY");
  return new OpenAI({ apiKey });
}

function pickMostCommonValue(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  let winner = "";
  let winnerCount = 0;

  for (const [value, count] of counts.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }

  return winner;
}

function preserveSharedConversationFields(rows: ExtractionRow[]) {
  const customerName = pickMostCommonValue(rows.map((row) => row.customerName));
  const company = pickMostCommonValue(rows.map((row) => row.company));

  return rows.map((row) => ({
    ...row,
    customerName: row.customerName.trim() || customerName,
    company: row.company.trim() || company
  }));
}

async function transcribeWithOpenAI(file: File): Promise<TranscriptionResult> {
  const apiKey = getRequiredEnv("OPENAI_API_KEY");
  const configuredModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
  const model = "whisper-1";

  if (configuredModel !== "whisper-1") {
    throw new Error(
      "English-only OpenAI audio output requires whisper-1 because OpenAI translations support only whisper-1."
    );
  }

  const formData = new FormData();
  formData.set("file", file, file.name);
  formData.set("model", model);
  formData.set("response_format", "verbose_json");

  const response = await fetch(
    "https://api.openai.com/v1/audio/translations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    }
  );

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Transcription request failed with status ${response.status}.`;

    throw new Error(message);
  }

  const transcription = (payload ?? {}) as {
    text?: string;
    segments?: TranscriptionSegment[];
  };

  return {
    provider: "openai",
    text: typeof transcription.text === "string" ? transcription.text : "",
    segments: normalizeSegments(
      Array.isArray(transcription.segments) ? transcription.segments : []
    )
  };
}

export async function transcribeAudio(file: File): Promise<TranscriptionResult> {
  return transcribeWithOpenAI(file);
}

export async function extractRowsFromTranscript(params: {
  transcript: string;
}): Promise<ExtractionRow[]> {
  const client = getClient();
  const model = process.env.OPENAI_EXTRACTION_MODEL || "gpt-4.1-mini";

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You convert customer feedback conversations into normalized spreadsheet rows. Return strict JSON with shape {\"rows\": [...]}. Create one row per conversation event, not one row per broad topic. Events include greeting or introduction, consent to continue, ownership confirmation, recommendation intent, each rating mention, each liked feature, each complaint, each issue detail, each improvement request, each device or version detail, each charger or service comment, each next-step commitment, and closing or thank-you. Do not merge separate events into one row just because they are related. Preserve the same customerName and company across all rows when the transcript makes them clear. Leave unknown values empty. Do not invent contact information. If a numeric or verbal rating is mentioned, capture it in the rating field."
      },
      {
        role: "user",
        content: [
          "Columns: speaker, timestamp, topic, customerName, company, email, phone, sentiment, notes, nextStep, rating, actionItems.",
          "Return detailed event-level rows, including intro and closing moments when they are present in the transcript.",
          "If the customer name or company appears anywhere in the transcript, copy that same value into every relevant row instead of leaving later rows blank.",
          "If timestamps are unavailable, leave them blank.",
          "Transcript:",
          params.transcript
        ].join("\n")
      }
    ]
  });

  const raw = completion.choices[0]?.message?.content;

  if (!raw) {
    throw new Error("The extraction model returned an empty response.");
  }

  const parsed = extractionSchema.parse(JSON.parse(raw));
  return preserveSharedConversationFields(parsed.rows);
}
