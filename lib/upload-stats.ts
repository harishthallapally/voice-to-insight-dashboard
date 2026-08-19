export type UploadStatusTrendPoint = {
  date: string;
  uploads: number;
  successes: number;
  failures: number;
};

export type NpsMetricSummary = {
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  totalResponses: number;
};

export type DateNpsTrendPoint = NpsMetricSummary & {
  date: string;
};

export type MonthlyUploadStats = {
  monthKey: string;
  uploads: number;
  successes: number;
  failures: number;
  uploadStatusByDate: UploadStatusTrendPoint[];
  connectedFeaturesNps: NpsMetricSummary;
  connectedFeaturesNpsByDate: DateNpsTrendPoint[];
  detractorsByDate: Array<{
    date: string;
    count: number;
  }>;
  l3DriversByDate: Array<{
    date: string;
    count: number;
  }>;
  l2DriversByDate: Array<{
    date: string;
    count: number;
  }>;
  l1DriversByDate: Array<{
    date: string;
    count: number;
  }>;
  l3Drivers: Array<{
    driver: string;
    count: number;
  }>;
  l2Drivers: Array<{
    driver: string;
    count: number;
  }>;
  l1Drivers: Array<{
    driver: string;
    count: number;
  }>;
  vehicleVariants: Array<{
    driver: string;
    count: number;
  }>;
  updatedAt: string | null;
};

export const UPLOAD_STATS_UPDATED_EVENT = "tvs-upload-stats-updated";

function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function createEmptyMonthlyUploadStats(monthKey = getCurrentMonthKey()) {
  return {
    monthKey,
    uploads: 0,
    successes: 0,
    failures: 0,
    uploadStatusByDate: [],
    connectedFeaturesNps: createNpsMetricSummary(),
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

function sanitizeCount(value: unknown) {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.floor(numericValue)
    : 0;
}

function calculateNpsScore(params: {
  promoters: number;
  detractors: number;
  totalResponses: number;
}) {
  if (params.totalResponses <= 0) {
    return null;
  }

  return Math.round(
    ((params.promoters - params.detractors) / params.totalResponses) * 100
  );
}

function createNpsMetricSummary(
  summary: Partial<NpsMetricSummary> | null | undefined = {}
): NpsMetricSummary {
  const promoters = sanitizeCount(summary?.promoters);
  const passives = sanitizeCount(summary?.passives);
  const detractors = sanitizeCount(summary?.detractors);
  const totalResponses = sanitizeCount(
    summary?.totalResponses || promoters + passives + detractors
  );

  return {
    promoters,
    passives,
    detractors,
    totalResponses,
    score: calculateNpsScore({
      promoters,
      detractors,
      totalResponses
    })
  };
}

export function normalizeMonthlyUploadStats(
  stats: Partial<MonthlyUploadStats> | null | undefined
) {
  const monthKey = stats?.monthKey || getCurrentMonthKey();

  return {
    monthKey,
    uploads: sanitizeCount(stats?.uploads),
    successes: sanitizeCount(stats?.successes),
    failures: sanitizeCount(stats?.failures),
    uploadStatusByDate: normalizeUploadStatusTrendPoints(
      stats?.uploadStatusByDate
    ),
    connectedFeaturesNps: createNpsMetricSummary(
      stats?.connectedFeaturesNps
    ),
    connectedFeaturesNpsByDate: normalizeDateNpsTrendPoints(
      stats?.connectedFeaturesNpsByDate
    ),
    detractorsByDate: normalizeDateCounts(stats?.detractorsByDate),
    l3DriversByDate: normalizeDateCounts(stats?.l3DriversByDate),
    l2DriversByDate: normalizeDateCounts(stats?.l2DriversByDate),
    l1DriversByDate: normalizeDateCounts(stats?.l1DriversByDate),
    l3Drivers: normalizeDriverCounts(stats?.l3Drivers),
    l2Drivers: normalizeDriverCounts(stats?.l2Drivers),
    l1Drivers: normalizeDriverCounts(stats?.l1Drivers),
    vehicleVariants: normalizeDriverCounts(stats?.vehicleVariants),
    updatedAt: stats?.updatedAt || null
  };
}

function normalizeDriverCounts(
  driverCounts: MonthlyUploadStats["l2Drivers"] | undefined
) {
  if (!Array.isArray(driverCounts)) {
    return [];
  }

  return driverCounts
    .map((driverCount) => ({
      driver: String(driverCount.driver || "").trim(),
      count: sanitizeCount(driverCount.count)
    }))
    .filter((driverCount) => driverCount.driver && driverCount.count > 0);
}

function normalizeDateCounts(
  dateCounts: MonthlyUploadStats["detractorsByDate"] | undefined
) {
  if (!Array.isArray(dateCounts)) {
    return [];
  }

  return dateCounts
    .map((dateCount) => ({
      date: String(dateCount.date || "").trim(),
      count: sanitizeCount(dateCount.count)
    }))
    .filter((dateCount) => dateCount.date && dateCount.count > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeUploadStatusTrendPoints(
  points: MonthlyUploadStats["uploadStatusByDate"] | undefined
) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point) => ({
      date: String(point.date || "").trim(),
      uploads: sanitizeCount(point.uploads),
      successes: sanitizeCount(point.successes),
      failures: sanitizeCount(point.failures)
    }))
    .filter(
      (point) =>
        point.date && (point.uploads || point.successes || point.failures)
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeDateNpsTrendPoints(
  points: MonthlyUploadStats["connectedFeaturesNpsByDate"] | undefined
) {
  if (!Array.isArray(points)) {
    return [];
  }

  return points
    .map((point) => ({
      date: String(point.date || "").trim(),
      ...createNpsMetricSummary(point)
    }))
    .filter((point) => point.date && point.totalResponses > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

// The dashboard always reads its numbers straight from the server
// (Cosmos) — nothing is cached client-side. This just tells any mounted
// dashboard to refetch immediately after an upload finishes, instead of
// waiting for its next poll/focus refresh.
export function notifyUploadStatsUpdated() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(UPLOAD_STATS_UPDATED_EVENT));
}
