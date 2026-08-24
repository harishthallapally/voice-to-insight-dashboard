import OpenAI from "openai";
import { z } from "zod";

import {
  createAudioChunksFromBuffer,
  getAudioMimeType,
  preprocessAudioBufferForTranscription,
  WHISPER_MAX_FILE_BYTES
} from "@/lib/audio-chunking";
import {
  buildCallSummaryFacts,
  buildDeterministicCallSummary
} from "@/lib/call-summary";
import { resolveDriverHierarchy } from "@/lib/driver-taxonomy";
import type { DriverMetrics } from "@/lib/driver-metrics";
import type { ExtractionRow } from "@/lib/types";

const { APIError } = OpenAI;
const DEFAULT_EXTRACTION_CHUNK_CHAR_LIMIT = 12000;
const MIN_EXTRACTION_CHUNK_CHAR_LIMIT = 4000;

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
      transcription: z.string().default(""),
      notes: z.string().default(""),
      l3Driver: z.string().default(""),
      l2Driver: z.string().default(""),
      l1Driver: z.string().default(""),
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

function buildTranscriptText(payload: {
  text?: string;
  segments?: TranscriptionSegment[];
}) {
  const segments = normalizeSegments(
    Array.isArray(payload.segments) ? payload.segments : []
  );
  const fromSegments = segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  const fromText = typeof payload.text === "string" ? payload.text.trim() : "";

  return fromSegments.length > fromText.length ? fromSegments : fromText || fromSegments;
}

function offsetSegments(
  segments: TranscriptionResult["segments"],
  offsetSeconds: number
) {
  return segments.map((segment) => ({
    ...segment,
    start: segment.start + offsetSeconds,
    end: segment.end + offsetSeconds
  }));
}

function mergeTranscriptionResults(
  results: TranscriptionResult[]
): TranscriptionResult {
  const text = results
    .map((result) => result.text.trim())
    .filter(Boolean)
    .join(" ");

  return {
    provider: results[0]?.provider || "openai",
    text,
    segments: results.flatMap((result) => result.segments)
  };
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

function normalizeForDuplicateCheck(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A single rating disclosure or complaint often spans more than one
 * conversation turn (e.g. "I want to give 5" followed by the agent asking
 * "why 5?", or a complaint stated once and then elaborated on in a follow-up
 * row). Extraction sometimes echoes the same rating value or the same
 * l3Driver text onto every row that mentions it, which double-counts a
 * single event in the dashboard (one rating counted as two NPS responses,
 * one complaint counted twice in the L3/L2/L1 driver totals). Keep the value
 * on the row where it first appears and clear the repeat.
 */
function deduplicateRepeatedRowFields(rows: ExtractionRow[]) {
  const seenRatings = new Set<string>();
  const seenL3Drivers = new Set<string>();

  return rows.map((row) => {
    const normalizedRating = normalizeForDuplicateCheck(row.rating || "");
    const normalizedL3Driver = normalizeForDuplicateCheck(row.l3Driver || "");
    const next = { ...row };

    if (normalizedRating) {
      if (seenRatings.has(normalizedRating)) {
        next.rating = "";
      } else {
        seenRatings.add(normalizedRating);
      }
    }

    if (normalizedL3Driver) {
      if (seenL3Drivers.has(normalizedL3Driver)) {
        next.l3Driver = "";
      } else {
        seenL3Drivers.add(normalizedL3Driver);
      }
    }

    return next;
  });
}

function enrichDriverHierarchy(rows: ExtractionRow[]) {
  return rows.map((row) => ({
    ...row,
    ...resolveDriverHierarchy(row)
  }));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// On a 429, OpenAI tells us exactly how long to wait via Retry-After —
// worth honoring directly instead of guessing with a fixed backoff,
// especially under concurrent multi-file load where several chunks can hit
// the same rate-limit window at once. Falls back to exponential backoff
// (capped at 20s) for errors that don't carry that header.
function getRetryDelayMs(error: unknown, attempt: number) {
  if (error instanceof APIError) {
    const retryAfterSeconds = Number(error.headers?.get?.("retry-after"));

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.min(retryAfterSeconds * 1000 + 500, 30000);
    }
  }

  return Math.min(1000 * 2 ** attempt, 20000);
}

function isRetryableTranscriptionError(error: unknown) {
  if (error instanceof APIError) {
    return error.status === 429 || (error.status ?? 0) >= 500;
  }

  return false;
}

function isRetryableExtractionError(error: unknown) {
  if (error instanceof APIError) {
    return error.status === 429 || (error.status ?? 0) >= 500;
  }

  return error instanceof SyntaxError || error instanceof z.ZodError;
}

// Retries were previously silent — a run that fully recovered and a run
// that hit sustained rate limiting looked identical in the logs. This
// gives visibility into which one is actually happening, especially under
// concurrent multi-file load where OpenAI 429s are the leading suspect.
function describeApiError(error: unknown) {
  if (error instanceof APIError) {
    return `HTTP ${error.status ?? "?"} ${error.code ?? error.name}: ${error.message}`;
  }

  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function getExtractionChunkCharLimit() {
  const configuredLimit = Number(process.env.EXTRACTION_CHUNK_CHAR_LIMIT || "");

  if (!Number.isFinite(configuredLimit) || configuredLimit <= 0) {
    return DEFAULT_EXTRACTION_CHUNK_CHAR_LIMIT;
  }

  return Math.max(
    MIN_EXTRACTION_CHUNK_CHAR_LIMIT,
    Math.floor(configuredLimit)
  );
}

function findTranscriptSplitPoint(transcript: string, start: number, limit: number) {
  const hardEnd = Math.min(start + limit, transcript.length);

  if (hardEnd >= transcript.length) {
    return transcript.length;
  }

  const softStart = start + Math.floor(limit * 0.6);
  const searchWindow = transcript.slice(softStart, hardEnd);
  const sentenceBreaks = [". ", "? ", "! ", "\n"];
  let splitOffset = -1;

  for (const breakText of sentenceBreaks) {
    splitOffset = Math.max(splitOffset, searchWindow.lastIndexOf(breakText));
  }

  if (splitOffset >= 0) {
    return softStart + splitOffset + 1;
  }

  const lastSpace = transcript.lastIndexOf(" ", hardEnd);

  return lastSpace > softStart ? lastSpace : hardEnd;
}

function splitTranscriptForExtraction(transcript: string) {
  const normalizedTranscript = transcript.trim();
  const limit = getExtractionChunkCharLimit();
  const chunks: string[] = [];
  let start = 0;

  while (start < normalizedTranscript.length) {
    const end = findTranscriptSplitPoint(normalizedTranscript, start, limit);
    const chunk = normalizedTranscript.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return chunks.length ? chunks : [normalizedTranscript];
}

function isPartialTranscription(params: {
  text: string;
  segments: TranscriptionResult["segments"];
  duration?: number;
}) {
  const duration = params.duration ?? 0;

  if (duration < 8) {
    return false;
  }

  const lastSegmentEnd = params.segments.at(-1)?.end ?? 0;
  const charsPerSecond = params.text.length / Math.max(duration, 1);

  if (lastSegmentEnd > 0 && duration > 0 && lastSegmentEnd < duration * 0.65) {
    return true;
  }

  return charsPerSecond < 3;
}

function normalizeSegmentTextForRepetitionCheck(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,!?]+$/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Whisper's repetition-hallucination loop (the model gets stuck repeating
 * itself instead of transcribing real speech) produces plenty of text
 * spread across the full audio duration, so it sails right past
 * isPartialTranscription's "too little text" check. Its signature is a
 * short window of consecutive segments cycling through only one or two
 * distinct phrases — either the same phrase over and over ("I am using
 * it." x6) or two phrases alternating ("So, every month? / Yes, sir." x13).
 * Genuine dialogue naturally introduces more lexical variety even across
 * short back-and-forth exchanges, so this doesn't trigger on real
 * conversation — only on a sustained one- or two-phrase cycle.
 */
function hasRepetitionLoop(segments: TranscriptionResult["segments"]) {
  const WINDOW_SIZE = 6;
  const MAX_DISTINCT_PHRASES_IN_WINDOW = 2;
  // Deliberately low: 6 consecutive segments cycling through only 1-2
  // phrases is already a strong loop signal on its own, even when each
  // repeat is short ("Thank you." x15 is a real, observed failure mode).
  // This is just a sanity floor against near-zero-length segments, not the
  // primary gate — an unnecessary retry is far cheaper than shipping a
  // looping transcript to a client.
  const MIN_WINDOW_DURATION_SECONDS = 3;

  if (segments.length < WINDOW_SIZE) {
    return false;
  }

  for (let start = 0; start <= segments.length - WINDOW_SIZE; start += 1) {
    const window = segments.slice(start, start + WINDOW_SIZE);
    const normalizedTexts = window
      .map((segment) => normalizeSegmentTextForRepetitionCheck(segment.text))
      .filter(Boolean);

    if (normalizedTexts.length < WINDOW_SIZE) {
      continue;
    }

    const distinctPhrases = new Set(normalizedTexts);
    const windowDuration = window.reduce(
      (total, segment) => total + Math.max(0, segment.end - segment.start),
      0
    );

    if (
      distinctPhrases.size <= MAX_DISTINCT_PHRASES_IN_WINDOW &&
      windowDuration >= MIN_WINDOW_DURATION_SECONDS
    ) {
      return true;
    }
  }

  return false;
}

/**
 * A quality proxy for picking the best of several imperfect transcription
 * attempts. Raw text length is actively misleading here: a badly-looping
 * attempt ("I am using it." x100) is *longer* than a clean attempt, so
 * scoring by length alone would prefer the garbage one. Counting each
 * distinct segment's text only once neutralizes that — a repeated phrase
 * only contributes its length a single time, so real, varied content wins.
 */
function getUniqueContentLength(segments: TranscriptionResult["segments"]) {
  const seen = new Set<string>();
  let total = 0;

  for (const segment of segments) {
    const normalized = normalizeSegmentTextForRepetitionCheck(segment.text);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    total += segment.text.trim().length;
  }

  return total;
}

async function transcribeAudioChunk(params: {
  buffer: Buffer;
  fileName: string;
  timeOffsetSeconds?: number;
}): Promise<TranscriptionResult> {
  const client = getClient();
  const configuredModel = process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
  const model = "whisper-1";
  const useTranslation =
    (process.env.OPENAI_TRANSCRIPTION_MODE || "translate").toLowerCase() !==
    "transcribe";

  if (configuredModel !== "whisper-1") {
    throw new Error(
      "English-only OpenAI audio output requires whisper-1 because OpenAI translations support only whisper-1."
    );
  }

  if (!params.buffer.byteLength) {
    throw new Error(`Audio file ${params.fileName} is empty.`);
  }

  const language = process.env.OPENAI_TRANSCRIPTION_LANGUAGE?.trim();
  const maxAttempts = 4;

  // Whisper is non-deterministic once temperature > 0: two calls at the
  // same temperature can come back different quality, and — empirically,
  // on real degraded call audio — a high temperature (~0.8) can make the
  // model give up and return nothing at all instead of fixing a loop. So
  // this keeps the best candidate seen across every attempt rather than
  // trusting whichever attempt happens to run last.
  let bestCandidate: TranscriptionResult | null = null;
  let bestCandidateScore = -1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const uploadFile = new File(
      [Uint8Array.from(params.buffer)],
      params.fileName,
      { type: getAudioMimeType(params.fileName) }
    );
    // temperature: 0 (the API default) is greedy decoding, which is the
    // setting most prone to Whisper's repetition-hallucination loop. A
    // small non-zero temperature from the first attempt avoids it in most
    // cases; escalating further on retry helps harder cases, capped well
    // below the point where the model starts returning empty output.
    const temperature = Math.min(0.2 * attempt, 0.6);

    let transcription: {
      text?: string;
      segments?: TranscriptionSegment[];
      duration?: number;
    } = {};

    try {
      const response = useTranslation
        ? await client.audio.translations.create({
            file: uploadFile,
            model,
            temperature,
            response_format: "verbose_json"
          })
        : await client.audio.transcriptions.create({
            file: uploadFile,
            model,
            temperature,
            response_format: "verbose_json",
            ...(language ? { language } : {})
          });

      transcription = response as {
        text?: string;
        segments?: TranscriptionSegment[];
        duration?: number;
      };
    } catch (error) {
      if (!isRetryableTranscriptionError(error) || attempt === maxAttempts) {
        if (bestCandidate) {
          return bestCandidate;
        }

        const message =
          error instanceof Error
            ? error.message
            : `Transcription request failed for ${params.fileName}.`;

        throw new Error(message);
      }

      console.warn(
        `[transcription] retryable error for ${params.fileName} (attempt ${attempt}/${maxAttempts}): ${describeApiError(error)}`
      );
      await sleep(getRetryDelayMs(error, attempt));
      continue;
    }

    const segments = offsetSegments(
      normalizeSegments(
        Array.isArray(transcription.segments) ? transcription.segments : []
      ),
      params.timeOffsetSeconds ?? 0
    );

    const text = buildTranscriptText({ ...transcription, segments });

    if (!text.trim()) {
      if (attempt === maxAttempts) {
        break;
      }

      await sleep(attempt * 2500);
      continue;
    }

    const isClean =
      !isPartialTranscription({
        text,
        segments,
        duration: transcription.duration
      }) && !hasRepetitionLoop(segments);

    if (isClean) {
      return { provider: "openai", text, segments };
    }

    // Not clean, but keep it if it has the most unique content seen so
    // far — scored by deduplicated content, not raw length, so a
    // heavily-looping attempt can't outscore a shorter-but-cleaner one.
    const uniqueContentLength = getUniqueContentLength(segments);

    if (uniqueContentLength > bestCandidateScore) {
      bestCandidateScore = uniqueContentLength;
      bestCandidate = { provider: "openai", text, segments };
    }

    if (attempt < maxAttempts) {
      await sleep(attempt * 2500);
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  throw new Error(
    `Transcription returned no text for ${params.fileName}. Check that the file is a supported audio format (MP3, WAV, M4A) and contains audible speech.`
  );
}

async function transcribeWithOpenAIFromBuffer(
  rawBuffer: Buffer,
  rawFileName: string
): Promise<TranscriptionResult> {
  if (!rawBuffer.byteLength) {
    throw new Error(`Audio file ${rawFileName} is empty.`);
  }

  const { buffer, name: fileName } = await preprocessAudioBufferForTranscription(
    rawBuffer,
    rawFileName
  );

  if (buffer.byteLength <= WHISPER_MAX_FILE_BYTES) {
    return transcribeAudioChunk({
      buffer,
      fileName
    });
  }

  const chunks = await createAudioChunksFromBuffer(buffer, fileName);
  const chunkDurationSeconds = 10 * 60;
  const results: TranscriptionResult[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const result = await transcribeAudioChunk({
      buffer: chunk.buffer,
      fileName: chunk.name,
      timeOffsetSeconds: index * chunkDurationSeconds
    });
    results.push(result);
  }

  return mergeTranscriptionResults(results);
}

export async function transcribeAudioBuffer(
  buffer: Buffer,
  fileName: string
): Promise<TranscriptionResult> {
  // Concurrency across files is governed by the job queue's
  // TRANSCRIPTION_WORKER_CONCURRENCY (lib/audio-job-queue.ts) — this used to
  // also funnel through a global one-at-a-time promise chain
  // (lib/transcription-queue.ts), which meant every file's transcription
  // ran strictly sequentially server-wide no matter how many jobs the queue
  // marked "active". Preprocessing uses per-call mkdtemp temp dirs
  // (lib/audio-chunking.ts), so there's no shared state that needs
  // serializing here; the retry/backoff hardening in transcribeAudioChunk
  // absorbs the rate-limit fallout that extra queue was guarding against.
  return transcribeWithOpenAIFromBuffer(buffer, fileName);
}

export async function transcribeAudio(file: File): Promise<TranscriptionResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return transcribeAudioBuffer(buffer, file.name);
}

async function extractRowsFromTranscriptChunk(params: {
  transcript: string;
  chunkIndex: number;
  totalChunks: number;
}): Promise<ExtractionRow[]> {
  const client = getClient();
  const model = process.env.OPENAI_EXTRACTION_MODEL || "gpt-4.1-mini";
  const chunkContext =
    params.totalChunks > 1
      ? `You are processing transcript part ${params.chunkIndex + 1} of ${params.totalChunks}. Extract only the events present in this part.`
      : "You are processing the full transcript.";
  // Concurrent multi-file uploads run every chunk's extraction call
  // unthrottled (unlike transcription, which is globally serialized), so
  // this is the path most exposed to OpenAI rate limiting when several
  // large files are queued at once. A thin 3-attempt/short-backoff budget
  // can exhaust before a rate-limit window clears; this gives it more room.
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You convert customer feedback conversations into normalized spreadsheet rows. Return strict JSON with shape {\"rows\": [...]}. Create one row per conversation event, not one row per broad topic. Events include greeting or introduction, consent to continue, ownership confirmation, recommendation intent, each rating mention, each liked feature, each complaint, each issue detail, each improvement request, each device or version detail, each charger or service comment, each next-step commitment, and closing or thank-you. Do not merge separate events into one row just because they are related. Preserve the same customerName and company across all rows when the transcript makes them clear. Leave unknown values empty. Do not invent contact information. If a numeric or verbal rating is mentioned, capture it in the rating field. For each row, populate notes with a concise summary of the event context, key details, and business meaning. For each row, populate transcription with the exact verbatim spoken words from the transcript for that event. notes and transcription are different fields: notes is an interpreted summary; transcription is the original voice-to-text excerpt. For each row, populate l3Driver only when the customer describes a product, connected feature, vehicle, charger, device, or connectivity problem. Derive l3Driver from the customer's voice as a concise problem statement. Leave l3Driver empty for agent speech, greetings, consent, closings, ratings without a problem, or non-problem events. Derive l2Driver and l1Driver only when l3Driver is populated. For vehicle-related customer problems, set both l2Driver and l1Driver to Vehicle issue. For charger-related customer problems, set both l2Driver and l1Driver to Charger issue. For connected feature experience problems, derive l2Driver as a specific issue label and l1Driver as a broader issue group without using Connected Feature or Connected App as a prefix. For other customer problems, set both l2Driver and l1Driver to Others. If l3Driver is empty, leave l2Driver and l1Driver empty."
          },
          {
            role: "user",
            content: [
              chunkContext,
              "Columns: speaker, timestamp, topic, customerName, company, email, phone, sentiment, transcription, notes, l3Driver, l2Driver, l1Driver, nextStep, rating, actionItems.",
              "Return detailed event-level rows, including intro and closing moments when they are present in the transcript.",
              "If the customer name or company appears anywhere in the transcript, copy that same value into every relevant row instead of leaving later rows blank.",
              "notes must contain a concise summary or key takeaway for the event. Do not leave notes empty when there is event content to summarize.",
              "transcription must contain the exact voice-to-text words from the transcript for that event. Do not put the summary into transcription.",
              "l3Driver must be a customer problem statement. Leave l3Driver blank when the customer did not raise a product, connected feature, vehicle, charger, device, or connectivity problem in that event.",
              "If l3Driver is empty, l2Driver and l1Driver must also be empty.",
              "For vehicle-related customer problems, set l2Driver to Vehicle issue and l1Driver to Vehicle issue.",
              "For charger-related customer problems, set l2Driver to Charger issue and l1Driver to Charger issue.",
              "For connected feature experience problems, derive l2Driver from the specific issue and l1Driver from the broader issue family. Examples: map accuracy or lag -> Navigation Issue; Bluetooth pairing or disconnection -> Bluetooth Connectivity Issue; call/message/alert issues -> Notification Issue; app/cluster/vehicle data sync issues -> Data Sync Issue; login or OTP issues -> Login Issue; live tracking or location issues -> Live Tracking Issue; slow/not working/interface issues -> Performance, Functionality, or Usability Issue.",
              "For customer problems not related to connected feature, vehicle, or charger, set l2Driver to Others and l1Driver to Others.",
              "For positive feedback, greetings, agent speech, consent, closing, and rating-only rows, leave l3Driver, l2Driver, and l1Driver empty.",
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
      return parsed.rows;
    } catch (error) {
      if (!isRetryableExtractionError(error) || attempt === maxAttempts) {
        if (error instanceof APIError) {
          console.warn(
            `[extraction] giving up on chunk ${params.chunkIndex + 1}/${params.totalChunks} after ${attempt} attempt(s): ${describeApiError(error)}`
          );
        }

        throw error;
      }

      console.warn(
        `[extraction] retryable error on chunk ${params.chunkIndex + 1}/${params.totalChunks} (attempt ${attempt}/${maxAttempts}): ${describeApiError(error)}`
      );
      await sleep(getRetryDelayMs(error, attempt));
    }
  }

  return [];
}

export async function extractRowsFromTranscript(params: {
  transcript: string;
}): Promise<ExtractionRow[]> {
  const transcriptChunks = splitTranscriptForExtraction(params.transcript);
  const rows: ExtractionRow[] = [];

  for (const [chunkIndex, transcriptChunk] of transcriptChunks.entries()) {
    rows.push(
      ...(await extractRowsFromTranscriptChunk({
        transcript: transcriptChunk,
        chunkIndex,
        totalChunks: transcriptChunks.length
      }))
    );
  }

  return enrichDriverHierarchy(
    deduplicateRepeatedRowFields(preserveSharedConversationFields(rows))
  );
}

/**
 * Composes the per-file analytical "Summary" cell (ratings, promoter/
 * passive/detractor status, complaints, improvement suggestions) as one
 * short paragraph. Grounded on already-extracted structured facts (ratings,
 * l3Driver, NPS status) so the model can't misstate a number that's already
 * visible elsewhere in the sheet — it only has to write the prose around
 * those facts. Reads condensed notes/l3Driver text rather than the full
 * transcript, so this stays a small, fast call regardless of call length.
 * Never throws: on any failure it falls back to a deterministic summary
 * built straight from the same facts, so the column is never left blank.
 */
export async function generateCallSummary(params: {
  rows: ExtractionRow[];
  driverMetrics: DriverMetrics;
}): Promise<string> {
  const { rows, driverMetrics } = params;

  if (!rows.length) {
    return "";
  }

  const fallback = buildDeterministicCallSummary(
    rows,
    driverMetrics.connectedFeaturesNps
  );
  const { ratingClauses, complaintClauses, npsLabel } = buildCallSummaryFacts(
    rows,
    driverMetrics.connectedFeaturesNps
  );
  const noteLines = rows
    .map((row) => [row.notes.trim(), row.l3Driver.trim()].filter(Boolean).join(" — "))
    .filter(Boolean);

  if (!ratingClauses.length && !complaintClauses.length && !noteLines.length) {
    return "";
  }

  const factsBlock = [
    ratingClauses.length ? `Ratings: ${ratingClauses.join(", ")}.` : "",
    npsLabel ? `NPS status: ${npsLabel}` : "",
    complaintClauses.length
      ? `Customer problems/complaints noted: ${complaintClauses.join("; ")}.`
      : "",
    noteLines.length ? `Event notes:\n${noteLines.join("\n")}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const client = getClient();
  const model = process.env.OPENAI_EXTRACTION_MODEL || "gpt-4.1-mini";
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "You write a short 2-4 sentence analytical summary of one customer support call, for a spreadsheet cell. Use only the facts given below — never invent ratings, names, or details not present in them. State the ratings first, using the exact numbers given, do not change them. Mention the customer's promoter/passive/detractor status only if it is given. Then summarize the customer's feedback, especially connected-feature or L3-driver problems, key complaints, and any improvement suggestions implied by the notes. Keep it concise, factual, plain prose, no bullet points, no headers, no markdown."
          },
          {
            role: "user",
            content: [
              "Facts about this call:",
              factsBlock,
              "",
              "Example of the tone and format expected (the facts in your answer must come only from above, not from this example):",
              '"Vehicle rating 8/10, connected charger rating 9/10, and charger rating 8/10. Customer is happy with the overall performance. Customer complained that Bluetooth is not working. Charger quality should be improved."',
              "",
              "Write only the summary paragraph, nothing else."
            ].join("\n")
          }
        ]
      });

      const text = completion.choices[0]?.message?.content?.trim();

      if (text) {
        return text;
      }

      break;
    } catch (error) {
      if (!isRetryableExtractionError(error) || attempt === maxAttempts) {
        console.warn(
          `[call-summary] giving up after ${attempt} attempt(s), using deterministic fallback: ${describeApiError(error)}`
        );
        break;
      }

      console.warn(
        `[call-summary] retryable error (attempt ${attempt}/${maxAttempts}): ${describeApiError(error)}`
      );
      await sleep(getRetryDelayMs(error, attempt));
    }
  }

  return fallback;
}
