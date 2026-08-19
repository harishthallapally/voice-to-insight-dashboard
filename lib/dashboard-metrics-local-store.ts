import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DriverMetricLevel,
  MonthlyUploadMetrics,
  UploadMetricEventType
} from "@/lib/dashboard-metrics-types";
import { calculateNpsScore, type DriverMetrics, type NpsMetrics } from "@/lib/driver-metrics";

/**
 * A local-disk mirror of lib/dashboard-metrics-store.ts, gated by
 * DASHBOARD_LOCAL_METRICS_ENABLED, for developers who want to see their own
 * local test uploads reflected on the dashboard without writing anything
 * into Azure Cosmos. Independent of DASHBOARD_METRICS_ENABLED (the Cosmos
 * write toggle) — either, both, or neither can be on at once.
 *
 * Storage is a single JSON file at LOCAL_METRICS_FILE, gitignored. Writes
 * are serialized through a module-level queue so concurrent requests can't
 * corrupt the file with an interleaved read-modify-write.
 */

const LOCAL_METRICS_FILE = path.join(
  process.cwd(),
  ".local-metrics",
  "events.json"
);

type LocalUploadEvent = {
  kind: "upload";
  eventType: UploadMetricEventType;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
};

type LocalDriverEvent = {
  kind: "driver";
  level: DriverMetricLevel;
  driver: string;
  count: number;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
};

type LocalDetractorEvent = {
  kind: "detractor";
  count: number;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
};

type LocalVehicleVariantEvent = {
  kind: "vehicleVariant";
  variant: string;
  count: number;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
};

type LocalNpsEvent = {
  kind: "connectedFeaturesNps";
  promoters: number;
  passives: number;
  detractors: number;
  totalResponses: number;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
};

type LocalMetricEvent =
  | LocalUploadEvent
  | LocalDriverEvent
  | LocalDetractorEvent
  | LocalVehicleVariantEvent
  | LocalNpsEvent;

function isLocalMetricsEnabled() {
  const value = process.env.DASHBOARD_LOCAL_METRICS_ENABLED?.trim().toLowerCase();

  if (!value) {
    return false;
  }

  return !["false", "0", "no", "off"].includes(value);
}

function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCurrentDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

async function readEvents(): Promise<LocalMetricEvent[]> {
  try {
    const raw = await readFile(LOCAL_METRICS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEvents(events: LocalMetricEvent[]) {
  await mkdir(path.dirname(LOCAL_METRICS_FILE), { recursive: true });
  await writeFile(LOCAL_METRICS_FILE, JSON.stringify(events, null, 2), "utf8");
}

// Serializes appends so two near-simultaneous writes can't both read the
// same "current" array and overwrite each other's addition.
let writeQueue: Promise<unknown> = Promise.resolve();

function appendEvent(event: LocalMetricEvent) {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const events = await readEvents();

      events.push(event);
      await writeEvents(events);
    });

  return writeQueue;
}

export async function recordUploadMetricEventLocal(
  eventType: UploadMetricEventType,
  fileName = ""
) {
  if (!isLocalMetricsEnabled()) {
    return;
  }

  const now = new Date();

  await appendEvent({
    kind: "upload",
    eventType,
    fileName,
    monthKey: getCurrentMonthKey(now),
    dateKey: getCurrentDateKey(now),
    createdAt: now.toISOString()
  });
}

export async function recordDriverMetricCountsLocal(
  driverMetrics: DriverMetrics | undefined,
  fileName = ""
) {
  if (!isLocalMetricsEnabled() || !driverMetrics) {
    return;
  }

  const now = new Date();
  const monthKey = getCurrentMonthKey(now);
  const dateKey = getCurrentDateKey(now);
  const createdAt = now.toISOString();
  const events: LocalMetricEvent[] = [];
  const driverLevels: Array<[DriverMetricLevel, DriverMetrics["l1Drivers"]]> = [
    ["l3", driverMetrics.l3Drivers],
    ["l2", driverMetrics.l2Drivers],
    ["l1", driverMetrics.l1Drivers]
  ];

  for (const [level, driverCounts] of driverLevels) {
    for (const driverCount of driverCounts) {
      if (!driverCount.driver || driverCount.count <= 0) {
        continue;
      }

      events.push({
        kind: "driver",
        level,
        driver: driverCount.driver,
        count: driverCount.count,
        fileName,
        monthKey,
        dateKey,
        createdAt
      });
    }
  }

  for (const variantCount of driverMetrics.vehicleVariants) {
    if (!variantCount.driver || variantCount.count <= 0) {
      continue;
    }

    events.push({
      kind: "vehicleVariant",
      variant: variantCount.driver,
      count: variantCount.count,
      fileName,
      monthKey,
      dateKey,
      createdAt
    });
  }

  if (driverMetrics.detractorCount > 0) {
    events.push({
      kind: "detractor",
      count: driverMetrics.detractorCount,
      fileName,
      monthKey,
      dateKey,
      createdAt
    });
  }

  if (driverMetrics.connectedFeaturesNps.totalResponses > 0) {
    events.push({
      kind: "connectedFeaturesNps",
      promoters: driverMetrics.connectedFeaturesNps.promoters,
      passives: driverMetrics.connectedFeaturesNps.passives,
      detractors: driverMetrics.connectedFeaturesNps.detractors,
      totalResponses: driverMetrics.connectedFeaturesNps.totalResponses,
      fileName,
      monthKey,
      dateKey,
      createdAt
    });
  }

  for (const event of events) {
    await appendEvent(event);
  }
}

function createEmptyNpsMetrics(): NpsMetrics {
  return { score: null, promoters: 0, passives: 0, detractors: 0, totalResponses: 0 };
}

function createEmptyMonthlyMetrics(monthKey: string): MonthlyUploadMetrics {
  return {
    monthKey,
    uploads: 0,
    successes: 0,
    failures: 0,
    uploadStatusByDate: [],
    connectedFeaturesNps: createEmptyNpsMetrics(),
    connectedFeaturesNpsByDate: [],
    detractorsByDate: [],
    l3DriversByDate: [],
    l2DriversByDate: [],
    l1DriversByDate: [],
    l3Drivers: [],
    l2Drivers: [],
    l1Drivers: [],
    vehicleVariants: [],
    updatedAt: null
  };
}

function toSortedDateCounts(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function toSortedDriverCounts(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .map(([driver, count]) => ({ driver, count }))
    .sort((left, right) => right.count - left.count || left.driver.localeCompare(right.driver));
}

export async function getMonthlyUploadMetricsLocal(
  monthKey: string
): Promise<MonthlyUploadMetrics> {
  const metrics = createEmptyMonthlyMetrics(monthKey);
  const events = (await readEvents()).filter((event) => event.monthKey === monthKey);

  if (!events.length) {
    return metrics;
  }

  const uploadStatusByDate = new Map<string, { uploads: number; successes: number; failures: number }>();
  const driverCounts: Record<DriverMetricLevel, Map<string, number>> = {
    l1: new Map(),
    l2: new Map(),
    l3: new Map()
  };
  const driverDateCounts: Record<DriverMetricLevel, Map<string, number>> = {
    l1: new Map(),
    l2: new Map(),
    l3: new Map()
  };
  const detractorDateCounts = new Map<string, number>();
  const npsByDate = new Map<string, NpsMetrics>();
  const npsTotals = createEmptyNpsMetrics();

  function getUploadPoint(date: string) {
    const existing = uploadStatusByDate.get(date);

    if (existing) {
      return existing;
    }

    const point = { uploads: 0, successes: 0, failures: 0 };

    uploadStatusByDate.set(date, point);

    return point;
  }

  for (const event of events) {
    if (event.kind === "upload") {
      const point = getUploadPoint(event.dateKey);

      metrics[
        event.eventType === "upload"
          ? "uploads"
          : event.eventType === "success"
            ? "successes"
            : "failures"
      ] += 1;
      point[event.eventType === "upload" ? "uploads" : event.eventType === "success" ? "successes" : "failures"] += 1;
    }

    if (event.kind === "driver") {
      driverCounts[event.level].set(
        event.driver,
        (driverCounts[event.level].get(event.driver) ?? 0) + event.count
      );
      driverDateCounts[event.level].set(
        event.dateKey,
        (driverDateCounts[event.level].get(event.dateKey) ?? 0) + event.count
      );
    }

    if (event.kind === "detractor") {
      detractorDateCounts.set(
        event.dateKey,
        (detractorDateCounts.get(event.dateKey) ?? 0) + event.count
      );
    }

    if (event.kind === "vehicleVariant") {
      const existing = metrics.vehicleVariants.find(
        (variant) => variant.driver === event.variant
      );

      if (existing) {
        existing.count += event.count;
      } else {
        metrics.vehicleVariants.push({ driver: event.variant, count: event.count });
      }
    }

    if (event.kind === "connectedFeaturesNps") {
      npsTotals.promoters += event.promoters;
      npsTotals.passives += event.passives;
      npsTotals.detractors += event.detractors;
      npsTotals.totalResponses += event.totalResponses;

      const current = npsByDate.get(event.dateKey) ?? createEmptyNpsMetrics();

      current.promoters += event.promoters;
      current.passives += event.passives;
      current.detractors += event.detractors;
      current.totalResponses += event.totalResponses;
      npsByDate.set(event.dateKey, current);
    }
  }

  metrics.uploadStatusByDate = Array.from(uploadStatusByDate.entries())
    .map(([date, point]) => ({ date, ...point }))
    .sort((left, right) => left.date.localeCompare(right.date));
  metrics.l3Drivers = toSortedDriverCounts(driverCounts.l3);
  metrics.l2Drivers = toSortedDriverCounts(driverCounts.l2);
  metrics.l1Drivers = toSortedDriverCounts(driverCounts.l1);
  metrics.l3DriversByDate = toSortedDateCounts(driverDateCounts.l3);
  metrics.l2DriversByDate = toSortedDateCounts(driverDateCounts.l2);
  metrics.l1DriversByDate = toSortedDateCounts(driverDateCounts.l1);
  metrics.detractorsByDate = toSortedDateCounts(detractorDateCounts);
  metrics.connectedFeaturesNps = {
    ...npsTotals,
    score: calculateNpsScore(npsTotals)
  };
  metrics.connectedFeaturesNpsByDate = Array.from(npsByDate.entries())
    .map(([date, nps]) => ({ date, ...nps, score: calculateNpsScore(nps) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  metrics.vehicleVariants.sort(
    (left, right) => right.count - left.count || left.driver.localeCompare(right.driver)
  );
  metrics.updatedAt = new Date().toISOString();

  return metrics;
}
