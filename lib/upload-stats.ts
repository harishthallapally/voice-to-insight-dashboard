export type UploadStatusTrendPoint = {
  date: string;
  uploads: number;
  successes: number;
  failures: number;
};

export type MonthlyUploadStats = {
  monthKey: string;
  uploads: number;
  successes: number;
  failures: number;
  uploadStatusByDate: UploadStatusTrendPoint[];
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

const UPLOAD_STATS_STORAGE_KEY = "tvs-voice-dashboard-monthly-upload-stats";

type DriverMetricsPayload = Partial<{
  detractorCount: number;
  l3Drivers: MonthlyUploadStats["l3Drivers"];
  l2Drivers: MonthlyUploadStats["l2Drivers"];
  l1Drivers: MonthlyUploadStats["l1Drivers"];
  vehicleVariants: MonthlyUploadStats["vehicleVariants"];
}>;

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

export function createEmptyMonthlyUploadStats(monthKey = getCurrentMonthKey()) {
  return {
    monthKey,
    uploads: 0,
    successes: 0,
    failures: 0,
    uploadStatusByDate: [],
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

function mergeUploadStatusTrendPoints(
  currentPoints: MonthlyUploadStats["uploadStatusByDate"],
  nextPoints: MonthlyUploadStats["uploadStatusByDate"] | undefined,
  mergeMode: "add" | "max" = "add"
) {
  const pointMap = new Map<string, UploadStatusTrendPoint>();

  for (const point of normalizeUploadStatusTrendPoints(currentPoints)) {
    pointMap.set(point.date, point);
  }

  for (const point of normalizeUploadStatusTrendPoints(nextPoints)) {
    const currentPoint = pointMap.get(point.date) ?? {
      date: point.date,
      uploads: 0,
      successes: 0,
      failures: 0
    };

    pointMap.set(point.date, {
      date: point.date,
      uploads:
        mergeMode === "max"
          ? Math.max(currentPoint.uploads, point.uploads)
          : currentPoint.uploads + point.uploads,
      successes:
        mergeMode === "max"
          ? Math.max(currentPoint.successes, point.successes)
          : currentPoint.successes + point.successes,
      failures:
        mergeMode === "max"
          ? Math.max(currentPoint.failures, point.failures)
          : currentPoint.failures + point.failures
    });
  }

  return normalizeUploadStatusTrendPoints(Array.from(pointMap.values()));
}

function mergeDriverCounts(
  currentCounts: MonthlyUploadStats["l2Drivers"],
  nextCounts: MonthlyUploadStats["l2Drivers"] | undefined,
  mergeMode: "add" | "max" = "add"
) {
  const countMap = new Map<string, number>();

  for (const driverCount of normalizeDriverCounts(currentCounts)) {
    countMap.set(driverCount.driver, driverCount.count);
  }

  for (const driverCount of normalizeDriverCounts(nextCounts)) {
    const currentCount = countMap.get(driverCount.driver) ?? 0;
    const mergedCount =
      mergeMode === "max"
        ? Math.max(currentCount, driverCount.count)
        : currentCount + driverCount.count;

    countMap.set(driverCount.driver, mergedCount);
  }

  return normalizeDriverCounts(
    Array.from(countMap.entries()).map(([driver, count]) => ({
      driver,
      count
    }))
  ).sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.driver.localeCompare(right.driver);
  });
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

function mergeDateCounts(
  currentCounts: MonthlyUploadStats["detractorsByDate"],
  nextCounts: MonthlyUploadStats["detractorsByDate"] | undefined,
  mergeMode: "add" | "max" = "add"
) {
  const countMap = new Map<string, number>();

  for (const dateCount of normalizeDateCounts(currentCounts)) {
    countMap.set(dateCount.date, dateCount.count);
  }

  for (const dateCount of normalizeDateCounts(nextCounts)) {
    const currentCount = countMap.get(dateCount.date) ?? 0;
    const mergedCount =
      mergeMode === "max"
        ? Math.max(currentCount, dateCount.count)
        : currentCount + dateCount.count;

    countMap.set(dateCount.date, mergedCount);
  }

  return normalizeDateCounts(
    Array.from(countMap.entries()).map(([date, count]) => ({
      date,
      count
    }))
  );
}

function sumDriverCounts(
  driverCounts: MonthlyUploadStats["l2Drivers"] | undefined
) {
  return normalizeDriverCounts(driverCounts).reduce(
    (total, driverCount) => total + driverCount.count,
    0
  );
}

function applyDriverMetrics(
  stats: MonthlyUploadStats,
  driverMetrics: DriverMetricsPayload | undefined
) {
  if (!driverMetrics) {
    return stats;
  }

  return {
    ...stats,
    detractorsByDate:
      sanitizeCount(driverMetrics.detractorCount) > 0
        ? mergeDateCounts(stats.detractorsByDate, [
            {
              date: getCurrentDateKey(),
              count: sanitizeCount(driverMetrics.detractorCount)
            }
          ])
        : stats.detractorsByDate,
    l3DriversByDate: mergeDateCounts(stats.l3DriversByDate, [
      {
        date: getCurrentDateKey(),
        count: sumDriverCounts(driverMetrics.l3Drivers)
      }
    ]),
    l2DriversByDate: mergeDateCounts(stats.l2DriversByDate, [
      {
        date: getCurrentDateKey(),
        count: sumDriverCounts(driverMetrics.l2Drivers)
      }
    ]),
    l1DriversByDate: mergeDateCounts(stats.l1DriversByDate, [
      {
        date: getCurrentDateKey(),
        count: sumDriverCounts(driverMetrics.l1Drivers)
      }
    ]),
    l3Drivers: mergeDriverCounts(stats.l3Drivers, driverMetrics.l3Drivers),
    l2Drivers: mergeDriverCounts(stats.l2Drivers, driverMetrics.l2Drivers),
    l1Drivers: mergeDriverCounts(stats.l1Drivers, driverMetrics.l1Drivers),
    vehicleVariants: mergeDriverCounts(
      stats.vehicleVariants,
      driverMetrics.vehicleVariants
    )
  };
}

export function mergeMonthlyUploadStats(
  serverStats: Partial<MonthlyUploadStats> | null | undefined,
  localStats: Partial<MonthlyUploadStats> | null | undefined
) {
  const normalizedServerStats = normalizeMonthlyUploadStats(serverStats);
  const normalizedLocalStats = normalizeMonthlyUploadStats(localStats);

  if (normalizedServerStats.monthKey !== normalizedLocalStats.monthKey) {
    return normalizedServerStats;
  }

  return {
    ...normalizedServerStats,
    uploads: Math.max(
      normalizedServerStats.uploads,
      normalizedLocalStats.uploads
    ),
    successes: Math.max(
      normalizedServerStats.successes,
      normalizedLocalStats.successes
    ),
    failures: Math.max(
      normalizedServerStats.failures,
      normalizedLocalStats.failures
    ),
    uploadStatusByDate: mergeUploadStatusTrendPoints(
      normalizedServerStats.uploadStatusByDate,
      normalizedLocalStats.uploadStatusByDate,
      "max"
    ),
    detractorsByDate: mergeDateCounts(
      normalizedServerStats.detractorsByDate,
      normalizedLocalStats.detractorsByDate,
      "max"
    ),
    l3DriversByDate: mergeDateCounts(
      normalizedServerStats.l3DriversByDate,
      normalizedLocalStats.l3DriversByDate,
      "max"
    ),
    l2DriversByDate: mergeDateCounts(
      normalizedServerStats.l2DriversByDate,
      normalizedLocalStats.l2DriversByDate,
      "max"
    ),
    l1DriversByDate: mergeDateCounts(
      normalizedServerStats.l1DriversByDate,
      normalizedLocalStats.l1DriversByDate,
      "max"
    ),
    l3Drivers: mergeDriverCounts(
      normalizedServerStats.l3Drivers,
      normalizedLocalStats.l3Drivers,
      "max"
    ),
    l2Drivers: mergeDriverCounts(
      normalizedServerStats.l2Drivers,
      normalizedLocalStats.l2Drivers,
      "max"
    ),
    l1Drivers: mergeDriverCounts(
      normalizedServerStats.l1Drivers,
      normalizedLocalStats.l1Drivers,
      "max"
    ),
    vehicleVariants: mergeDriverCounts(
      normalizedServerStats.vehicleVariants,
      normalizedLocalStats.vehicleVariants,
      "max"
    )
  };
}

export function readLocalMonthlyUploadStats() {
  if (typeof window === "undefined") {
    return createEmptyMonthlyUploadStats();
  }

  const currentMonthKey = getCurrentMonthKey();
  const storedValue = window.localStorage.getItem(UPLOAD_STATS_STORAGE_KEY);

  if (!storedValue) {
    return createEmptyMonthlyUploadStats(currentMonthKey);
  }

  try {
    const stats = normalizeMonthlyUploadStats(JSON.parse(storedValue));

    if (stats.monthKey !== currentMonthKey) {
      return createEmptyMonthlyUploadStats(currentMonthKey);
    }

    return stats;
  } catch {
    return createEmptyMonthlyUploadStats(currentMonthKey);
  }
}

export function recordLocalUploadStats(delta: {
  uploads?: number;
  successes?: number;
  failures?: number;
  driverMetrics?: DriverMetricsPayload;
}) {
  if (typeof window === "undefined") {
    return createEmptyMonthlyUploadStats();
  }

  const currentStats = readLocalMonthlyUploadStats();
  const today = getCurrentDateKey();
  const nextStats: MonthlyUploadStats = applyDriverMetrics(
    {
      ...currentStats,
      uploads: currentStats.uploads + sanitizeCount(delta.uploads),
      successes: currentStats.successes + sanitizeCount(delta.successes),
      failures: currentStats.failures + sanitizeCount(delta.failures),
      uploadStatusByDate: mergeUploadStatusTrendPoints(
        currentStats.uploadStatusByDate,
        [
          {
            date: today,
            uploads: sanitizeCount(delta.uploads),
            successes: sanitizeCount(delta.successes),
            failures: sanitizeCount(delta.failures)
          }
        ]
      ),
      updatedAt: new Date().toISOString()
    },
    delta.driverMetrics
  );

  window.localStorage.setItem(
    UPLOAD_STATS_STORAGE_KEY,
    JSON.stringify(nextStats)
  );
  window.dispatchEvent(new Event(UPLOAD_STATS_UPDATED_EVENT));

  return nextStats;
}
