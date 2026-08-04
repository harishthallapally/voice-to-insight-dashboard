import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  AudioProcessingError,
  type AudioProcessingResult,
  processAudioBuffer
} from "@/lib/audio-processing";
import {
  safeRecordDriverMetricCounts,
  safeRecordUploadMetricEvent
} from "@/lib/dashboard-metrics-store";

export type AudioJobStatus = "queued" | "processing" | "complete" | "error";

export type AudioJobSnapshot = {
  id: string;
  inputFileName: string;
  status: AudioJobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: Partial<AudioProcessingResult>;
};

type AudioJobRecord = AudioJobSnapshot & {
  filePath: string;
};

type AudioJobQueueState = {
  jobs: Map<string, AudioJobRecord>;
  queue: string[];
  activeCount: number;
};

const JOB_TEMP_DIR = path.join(tmpdir(), "voice-to-insight-audio-jobs");
const DEFAULT_WORKER_CONCURRENCY = 2;
const MAX_WORKER_CONCURRENCY = 4;
const DEFAULT_RETENTION_HOURS = 24;

declare global {
  // eslint-disable-next-line no-var
  var __voiceToInsightAudioJobQueue: AudioJobQueueState | undefined;
}

function getQueueState() {
  if (!globalThis.__voiceToInsightAudioJobQueue) {
    globalThis.__voiceToInsightAudioJobQueue = {
      jobs: new Map<string, AudioJobRecord>(),
      queue: [],
      activeCount: 0
    };
  }

  return globalThis.__voiceToInsightAudioJobQueue;
}

function getWorkerConcurrency() {
  const configuredConcurrency = Number(
    process.env.TRANSCRIPTION_WORKER_CONCURRENCY ||
      String(DEFAULT_WORKER_CONCURRENCY)
  );

  if (!Number.isFinite(configuredConcurrency)) {
    return DEFAULT_WORKER_CONCURRENCY;
  }

  return Math.max(
    1,
    Math.min(MAX_WORKER_CONCURRENCY, Math.floor(configuredConcurrency))
  );
}

function getRetentionMs() {
  const configuredHours = Number(
    process.env.BACKGROUND_JOB_RETENTION_HOURS ||
      String(DEFAULT_RETENTION_HOURS)
  );
  const retentionHours =
    Number.isFinite(configuredHours) && configuredHours > 0
      ? configuredHours
      : DEFAULT_RETENTION_HOURS;

  return retentionHours * 60 * 60 * 1000;
}

function toSnapshot(job: AudioJobRecord): AudioJobSnapshot {
  return {
    id: job.id,
    inputFileName: job.inputFileName,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result
  };
}

function updateJob(
  jobId: string,
  update: Partial<Omit<AudioJobRecord, "id" | "filePath" | "inputFileName">>
) {
  const state = getQueueState();
  const job = state.jobs.get(jobId);

  if (!job) {
    return;
  }

  state.jobs.set(jobId, {
    ...job,
    ...update,
    updatedAt: new Date().toISOString()
  });
}

async function removeAudioFile(filePath: string) {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Temporary file cleanup should not hide the actual processing result.
  }
}

async function cleanupExpiredJobs() {
  const state = getQueueState();
  const retentionMs = getRetentionMs();
  const now = Date.now();

  for (const [jobId, job] of state.jobs.entries()) {
    const finishedAt = job.completedAt ? Date.parse(job.completedAt) : 0;

    if (!finishedAt || now - finishedAt < retentionMs) {
      continue;
    }

    state.jobs.delete(jobId);
    await removeAudioFile(job.filePath);
  }
}

async function runJob(jobId: string) {
  const state = getQueueState();
  const job = state.jobs.get(jobId);

  if (!job) {
    return;
  }

  updateJob(jobId, {
    status: "processing",
    startedAt: new Date().toISOString(),
    error: ""
  });

  try {
    const audioBuffer = await readFile(job.filePath);
    const result = await processAudioBuffer({
      audioBuffer,
      fileName: job.inputFileName
    });

    updateJob(jobId, {
      status: "complete",
      completedAt: new Date().toISOString(),
      result,
      error: ""
    });
    await safeRecordUploadMetricEvent("success", job.inputFileName);
    await safeRecordDriverMetricCounts(result.driverMetrics, job.inputFileName);
  } catch (error) {
    if (error instanceof AudioProcessingError) {
      updateJob(jobId, {
        status: "error",
        completedAt: new Date().toISOString(),
        error: error.message,
        result: error.payload
      });
      await safeRecordUploadMetricEvent("failure", job.inputFileName);
      return;
    }

    updateJob(jobId, {
      status: "error",
      completedAt: new Date().toISOString(),
      error:
        error instanceof Error ? error.message : "Unexpected processing error."
    });
    await safeRecordUploadMetricEvent("failure", job.inputFileName);
  } finally {
    await removeAudioFile(job.filePath);
  }
}

function drainQueue() {
  const state = getQueueState();
  const workerConcurrency = getWorkerConcurrency();

  while (state.activeCount < workerConcurrency && state.queue.length > 0) {
    const jobId = state.queue.shift();

    if (!jobId) {
      continue;
    }

    const job = state.jobs.get(jobId);

    if (!job || job.status !== "queued") {
      continue;
    }

    state.activeCount += 1;
    void runJob(jobId).finally(() => {
      state.activeCount -= 1;
      drainQueue();
    });
  }
}

export async function enqueueAudioProcessingJob(params: {
  audioBuffer: Buffer;
  fileName: string;
}) {
  await cleanupExpiredJobs();
  await mkdir(JOB_TEMP_DIR, { recursive: true });

  const state = getQueueState();
  const jobId = randomUUID();
  const filePath = path.join(JOB_TEMP_DIR, `${jobId}.audio`);
  const now = new Date().toISOString();
  const job: AudioJobRecord = {
    id: jobId,
    inputFileName: params.fileName,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    filePath
  };

  await writeFile(filePath, params.audioBuffer);
  state.jobs.set(jobId, job);
  state.queue.push(jobId);
  drainQueue();

  return toSnapshot(job);
}

export function getAudioProcessingJob(jobId: string) {
  const job = getQueueState().jobs.get(jobId);

  return job ? toSnapshot(job) : null;
}
