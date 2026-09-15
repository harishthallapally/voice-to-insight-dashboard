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
// A worker slot is claimed before runJob starts and released in its
// .finally(), so anything that can hang forever inside a job (a request that
// never returns, an ffmpeg child process that never exits) permanently costs
// one slot. Lose as many slots as the concurrency limit and the queue wedges:
// every later upload sits in "queued" for the life of the container, because
// drainQueue can never satisfy activeCount < workerConcurrency again. These
// timeouts exist so a job always settles and always gives its slot back.
const DEFAULT_JOB_TIMEOUT_MINUTES = 20;
const METRIC_WRITE_TIMEOUT_MS = 15_000;

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

function getJobTimeoutMs() {
  const configuredMinutes = Number(
    process.env.AUDIO_JOB_TIMEOUT_MINUTES || String(DEFAULT_JOB_TIMEOUT_MINUTES)
  );
  const timeoutMinutes =
    Number.isFinite(configuredMinutes) && configuredMinutes > 0
      ? configuredMinutes
      : DEFAULT_JOB_TIMEOUT_MINUTES;

  return timeoutMinutes * 60 * 1000;
}

/**
 * Rejects if the wrapped promise hasn't settled in time. It cannot cancel
 * the underlying work — an in-flight HTTP request or ffmpeg process keeps
 * running to its own conclusion — but that isn't the point: the point is
 * that runJob settles, so the worker slot is released instead of being held
 * hostage by a promise that may never resolve.
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Metrics are bookkeeping — they must never decide whether audio processing
 * finishes. safeRecord* already swallows errors, but a *hang* isn't an
 * error, and these are awaited inside runJob, so an unresponsive Cosmos
 * write would strand the worker slot.
 */
async function recordMetricWithoutBlocking(
  work: Promise<unknown>,
  label: string
) {
  try {
    await withTimeout(
      work,
      METRIC_WRITE_TIMEOUT_MS,
      `Timed out after ${METRIC_WRITE_TIMEOUT_MS}ms`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.warn(`[audio-job-queue] ${label} did not complete: ${message}`);
  }
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

  const timeoutMs = getJobTimeoutMs();

  try {
    const audioBuffer = await readFile(job.filePath);
    const result = await withTimeout(
      processAudioBuffer({
        audioBuffer,
        fileName: job.inputFileName
      }),
      timeoutMs,
      `Processing timed out after ${Math.round(timeoutMs / 60000)} minutes for ${job.inputFileName}.`
    );

    updateJob(jobId, {
      status: "complete",
      completedAt: new Date().toISOString(),
      result,
      error: ""
    });
    await recordMetricWithoutBlocking(
      safeRecordUploadMetricEvent(
        "success",
        job.inputFileName,
        result.durationSeconds
      ),
      `success metric for ${job.inputFileName}`
    );
    await recordMetricWithoutBlocking(
      safeRecordDriverMetricCounts(result.driverMetrics, job.inputFileName),
      `driver metrics for ${job.inputFileName}`
    );
  } catch (error) {
    if (error instanceof AudioProcessingError) {
      updateJob(jobId, {
        status: "error",
        completedAt: new Date().toISOString(),
        error: error.message,
        result: error.payload
      });
      await recordMetricWithoutBlocking(
        safeRecordUploadMetricEvent("failure", job.inputFileName),
        `failure metric for ${job.inputFileName}`
      );
      return;
    }

    updateJob(jobId, {
      status: "error",
      completedAt: new Date().toISOString(),
      error:
        error instanceof Error ? error.message : "Unexpected processing error."
    });
    await recordMetricWithoutBlocking(
      safeRecordUploadMetricEvent("failure", job.inputFileName),
      `failure metric for ${job.inputFileName}`
    );
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

    let slotReleased = false;
    const releaseSlot = () => {
      if (slotReleased) {
        return;
      }

      slotReleased = true;
      // Never let a bookkeeping slip drive this negative: a negative
      // activeCount would silently raise the real concurrency above the
      // configured limit.
      state.activeCount = Math.max(0, state.activeCount - 1);
      drainQueue();
    };

    void runJob(jobId).then(releaseSlot, (error) => {
      // runJob handles its own failures; reaching here means something threw
      // outside that handling, and the slot still has to come back.
      console.error(
        `[audio-job-queue] job ${jobId} rejected unexpectedly:`,
        error instanceof Error ? error.message : error
      );
      releaseSlot();
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
  // Queue depth and slot usage make a wedged worker pool obvious from the
  // logs alone — the symptom otherwise looks like "uploads stay queued
  // forever" with nothing explaining why.
  console.info(
    `[audio-job-queue] queued ${params.fileName} — ${state.queue.length} waiting, ${state.activeCount}/${getWorkerConcurrency()} slots busy`
  );
  drainQueue();

  return toSnapshot(job);
}

export type AudioQueueStatus = {
  concurrency: number;
  activeCount: number;
  queuedCount: number;
  jobTimeoutMinutes: number;
  statusCounts: Record<AudioJobStatus, number>;
  activeJobs: Array<{
    id: string;
    inputFileName: string;
    startedAt?: string;
    ageSeconds: number;
  }>;
  oldestActiveAgeSeconds: number | null;
  /**
   * Slots counted as busy with no job actually running in them. This is the
   * signature of the wedge that stalled the queue twice: activeCount is
   * incremented before a job starts and decremented when it settles, so a
   * job that never settles leaves the counter permanently high with nothing
   * to show for it. Anything above 0 here is a leak, full stop.
   */
  leakedSlots: number;
  /** Every slot claimed and work waiting behind them. */
  saturated: boolean;
  generatedAt: string;
};

/**
 * Read-only snapshot of the worker pool, so "uploads are stuck in queued"
 * can be answered directly instead of inferred from the outside. The two
 * cases look identical to a user but need opposite responses: a healthy
 * backlog (saturated, no leaked slots, jobs completing) just needs time,
 * while leaked slots need a restart and a bug fix.
 */
export function getAudioQueueStatus(): AudioQueueStatus {
  const state = getQueueState();
  const concurrency = getWorkerConcurrency();
  const now = Date.now();
  const statusCounts: Record<AudioJobStatus, number> = {
    queued: 0,
    processing: 0,
    complete: 0,
    error: 0
  };
  const activeJobs: AudioQueueStatus["activeJobs"] = [];

  for (const job of state.jobs.values()) {
    statusCounts[job.status] += 1;

    if (job.status === "processing") {
      const startedAtMs = job.startedAt ? Date.parse(job.startedAt) : now;

      activeJobs.push({
        id: job.id,
        inputFileName: job.inputFileName,
        startedAt: job.startedAt,
        ageSeconds: Math.max(0, Math.round((now - startedAtMs) / 1000))
      });
    }
  }

  activeJobs.sort((left, right) => right.ageSeconds - left.ageSeconds);

  return {
    concurrency,
    activeCount: state.activeCount,
    queuedCount: state.queue.length,
    jobTimeoutMinutes: Math.round(getJobTimeoutMs() / 60000),
    statusCounts,
    activeJobs,
    oldestActiveAgeSeconds: activeJobs.length ? activeJobs[0].ageSeconds : null,
    leakedSlots: Math.max(0, state.activeCount - activeJobs.length),
    saturated: state.activeCount >= concurrency && state.queue.length > 0,
    generatedAt: new Date(now).toISOString()
  };
}

export function getAudioProcessingJob(jobId: string) {
  const job = getQueueState().jobs.get(jobId);

  return job ? toSnapshot(job) : null;
}
