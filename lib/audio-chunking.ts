import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WHISPER_MAX_FILE_BYTES = 24 * 1024 * 1024;
const CHUNK_SECONDS = 10 * 60;

const AUDIO_MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".mpga": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg"
};

export function getAudioMimeType(fileName: string) {
  const extension = getExtension(fileName);
  return AUDIO_MIME_TYPES[extension] || "audio/mpeg";
}

function getExtension(fileName: string) {
  const match = fileName.match(/(\.[^.]+)$/);
  return match?.[1]?.toLowerCase() || ".audio";
}

type AudioChunk = {
  buffer: Buffer;
  name: string;
};

async function runFfmpeg(args: string[]) {
  await execFileAsync("ffmpeg", args);
}

/**
 * Whisper is trained on 16kHz audio and has no built-in loudness handling.
 * Raw call recordings are frequently narrow-band (8kHz), quiet, or otherwise
 * degraded, which can cause the model to lose confidence partway through and
 * fall into a repeated-phrase hallucination loop instead of transcribing the
 * remaining speech (silently "succeeding" with garbage text for the rest of
 * the file). Normalizing loudness, cutting sub-100Hz rumble, and resampling
 * to 16kHz mono before every transcription request substantially reduces
 * that failure mode.
 *
 * Falls back to the original buffer (rather than throwing) if ffmpeg is
 * unavailable or preprocessing otherwise fails, so a preprocessing hiccup
 * never blocks transcription outright.
 */
export async function preprocessAudioBufferForTranscription(
  buffer: Buffer,
  fileName: string
): Promise<AudioChunk> {
  if (!buffer.byteLength) {
    return { buffer, name: fileName };
  }

  const dir = await mkdtemp(join(tmpdir(), "whisper-preprocess-"));
  const inputPath = join(dir, `input${getExtension(fileName)}`);
  const outputPath = join(dir, "normalized.mp3");

  try {
    await writeFile(inputPath, buffer);

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11,highpass=f=100",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "128k",
      outputPath
    ]);

    const normalizedBuffer = await readFile(outputPath);

    if (!normalizedBuffer.byteLength) {
      return { buffer, name: fileName };
    }

    return { buffer: normalizedBuffer, name: "normalized.mp3" };
  } catch (error) {
    console.warn(
      `Audio preprocessing skipped for ${fileName}; sending original audio to transcription.`,
      error instanceof Error ? error.message : error
    );

    return { buffer, name: fileName };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function createAudioChunksFromBuffer(
  buffer: Buffer,
  fileName: string
): Promise<AudioChunk[]> {
  if (buffer.byteLength <= WHISPER_MAX_FILE_BYTES) {
    return [{ buffer, name: fileName }];
  }

  const dir = await mkdtemp(join(tmpdir(), "whisper-chunks-"));
  const inputPath = join(dir, `input${getExtension(fileName)}`);

  try {
    await writeFile(inputPath, buffer);
    const outputPattern = join(dir, "chunk_%03d.mp3");

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-reset_timestamps",
      "1",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "64k",
      "-ar",
      "16000",
      outputPattern
    ]);

    const chunkFiles = (await readdir(dir))
      .filter((name) => name.startsWith("chunk_") && name.endsWith(".mp3"))
      .sort();

    if (!chunkFiles.length) {
      throw new Error(
        "Audio file exceeds Whisper size limits and could not be split for transcription."
      );
    }

    return Promise.all(
      chunkFiles.map(async (chunkFile) => ({
        buffer: await readFile(join(dir, chunkFile)),
        name: chunkFile
      }))
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Audio chunking failed.";

    throw new Error(
      `Audio file is too large for a single transcription request (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB). ffmpeg is required in the runtime environment to enable automatic chunking. ${message}`
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function createAudioChunks(file: File): Promise<AudioChunk[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return createAudioChunksFromBuffer(buffer, file.name);
}
