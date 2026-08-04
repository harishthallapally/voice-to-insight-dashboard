import { randomUUID } from "node:crypto";

import { CosmosClient, type Container } from "@azure/cosmos";

import type { DateCount, DriverCount, DriverMetrics } from "@/lib/driver-metrics";

const DEFAULT_ORGANIZATION_ID = "tvs";
const METRIC_RECORD_TYPE = "uploadMetricEvent";
const DRIVER_METRIC_RECORD_TYPE = "driverMetricCount";
const DETRACTOR_METRIC_RECORD_TYPE = "detractorMetricCount";
const VEHICLE_VARIANT_METRIC_RECORD_TYPE = "vehicleVariantMetricCount";

export type UploadMetricEventType = "upload" | "success" | "failure";
export type DriverMetricLevel = "l1" | "l2" | "l3";

export type UploadStatusTrendPoint = {
  date: string;
  uploads: number;
  successes: number;
  failures: number;
};

export type MonthlyUploadMetrics = {
  monthKey: string;
  uploads: number;
  successes: number;
  failures: number;
  uploadStatusByDate: UploadStatusTrendPoint[];
  detractorsByDate: DateCount[];
  l3DriversByDate: DateCount[];
  l2DriversByDate: DateCount[];
  l1DriversByDate: DateCount[];
  l3Drivers: DriverCount[];
  l2Drivers: DriverCount[];
  l1Drivers: DriverCount[];
  vehicleVariants: DriverCount[];
  updatedAt: string | null;
};

type CosmosMetricsConfig = {
  endpoint: string;
  key: string;
  databaseId: string;
  containerId: string;
  organizationId: string;
};

type UploadMetricEventRecord = {
  id: string;
  type: typeof METRIC_RECORD_TYPE;
  organizationId: string;
  monthKey: string;
  eventType: UploadMetricEventType;
  fileName: string;
  dateKey: string;
  createdAt: string;
};

type DriverMetricRecord = {
  id: string;
  type: typeof DRIVER_METRIC_RECORD_TYPE;
  organizationId: string;
  monthKey: string;
  level: DriverMetricLevel;
  driver: string;
  count: number;
  fileName: string;
  dateKey: string;
  createdAt: string;
};

type DetractorMetricRecord = {
  id: string;
  type: typeof DETRACTOR_METRIC_RECORD_TYPE;
  organizationId: string;
  monthKey: string;
  dateKey: string;
  count: number;
  fileName: string;
  createdAt: string;
};

type VehicleVariantMetricRecord = {
  id: string;
  type: typeof VEHICLE_VARIANT_METRIC_RECORD_TYPE;
  organizationId: string;
  monthKey: string;
  variant: string;
  count: number;
  fileName: string;
  dateKey: string;
  createdAt: string;
};

type UploadMetricQueryRow = {
  eventType?: UploadMetricEventType;
  fileName?: string;
  dateKey?: string;
  createdAt?: string;
  count?: number;
};

type DriverMetricQueryRow = {
  level?: DriverMetricLevel;
  driver?: string;
  dateKey?: string;
  createdAt?: string;
  count?: number;
};

type DetractorMetricQueryRow = {
  dateKey?: string;
  createdAt?: string;
  count?: number;
};

type VehicleVariantMetricQueryRow = {
  variant?: string;
  count?: number;
};

let cachedContainer: Container | null = null;
let cachedConfigSignature = "";

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getCosmosMetricsConfig(): CosmosMetricsConfig {
  return {
    endpoint: getRequiredEnv("AZURE_COSMOS_ENDPOINT"),
    key: getRequiredEnv("AZURE_COSMOS_KEY"),
    databaseId: getRequiredEnv("AZURE_COSMOS_DATABASE_ID"),
    containerId:
      process.env.AZURE_COSMOS_METRICS_CONTAINER_ID?.trim() ||
      getRequiredEnv("AZURE_COSMOS_CONTAINER_ID"),
    organizationId:
      process.env.AZURE_COSMOS_ORGANIZATION_ID?.trim() ||
      DEFAULT_ORGANIZATION_ID
  };
}

function getCosmosContainer(config: CosmosMetricsConfig) {
  const configSignature = [
    config.endpoint,
    config.databaseId,
    config.containerId
  ].join("|");

  if (cachedContainer && cachedConfigSignature === configSignature) {
    return cachedContainer;
  }

  const client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key
  });

  cachedContainer = client
    .database(config.databaseId)
    .container(config.containerId);
  cachedConfigSignature = configSignature;

  return cachedContainer;
}

export function getCurrentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getCurrentDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function getDateKeyFromRecord(params: {
  dateKey?: string;
  createdAt?: string;
}) {
  const dateKey = params.dateKey?.trim();

  if (dateKey) {
    return dateKey.slice(0, 10);
  }

  if (params.createdAt) {
    const parsedDate = new Date(params.createdAt);

    if (!Number.isNaN(parsedDate.getTime())) {
      return getCurrentDateKey(parsedDate);
    }
  }

  return "";
}

function createEmptyMonthlyMetrics(monthKey = getCurrentMonthKey()) {
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

function sortDriverCounts(driverCounts: DriverCount[]) {
  return driverCounts.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.driver.localeCompare(right.driver);
  });
}

function sortDateCounts(dateCounts: DateCount[]) {
  return dateCounts.sort((left, right) => left.date.localeCompare(right.date));
}

function sortUploadStatusTrendPoints(points: UploadStatusTrendPoint[]) {
  return points.sort((left, right) => left.date.localeCompare(right.date));
}

function incrementDateCount(
  countMap: Map<string, number>,
  date: string,
  count: number
) {
  if (!date || count <= 0) {
    return;
  }

  countMap.set(date, (countMap.get(date) ?? 0) + count);
}

function incrementDriverCount(
  countMap: Map<string, number>,
  driver: string,
  count: number
) {
  if (!driver || count <= 0) {
    return;
  }

  countMap.set(driver, (countMap.get(driver) ?? 0) + count);
}

function toDateCounts(countMap: Map<string, number>) {
  return sortDateCounts(
    Array.from(countMap.entries()).map(([date, count]) => ({
      date,
      count
    }))
  );
}

function toDriverCounts(countMap: Map<string, number>) {
  return sortDriverCounts(
    Array.from(countMap.entries()).map(([driver, count]) => ({
      driver,
      count
    }))
  );
}

function logMetricWarning(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";

  console.warn(`[dashboard-metrics] ${action} failed: ${message}`);
}

export async function recordUploadMetricEvent(
  eventType: UploadMetricEventType,
  fileName = ""
) {
  const config = getCosmosMetricsConfig();
  const container = getCosmosContainer(config);
  const now = new Date();
  const monthKey = getCurrentMonthKey(now);
  const dateKey = getCurrentDateKey(now);
  const record: UploadMetricEventRecord = {
    id: `upload-metric-${monthKey}-${randomUUID()}`,
    type: METRIC_RECORD_TYPE,
    organizationId: config.organizationId,
    monthKey,
    eventType,
    fileName,
    dateKey,
    createdAt: now.toISOString()
  };

  await container.items.create(record);
}

export async function safeRecordUploadMetricEvent(
  eventType: UploadMetricEventType,
  fileName = ""
) {
  try {
    await recordUploadMetricEvent(eventType, fileName);
  } catch (error) {
    logMetricWarning(`record ${eventType}`, error);
    // Metrics should never block the actual audio processing flow.
  }
}

async function createDriverMetricRecord(params: {
  config: CosmosMetricsConfig;
  container: Container;
  level: DriverMetricLevel;
  driverCount: DriverCount;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
}) {
  const record: DriverMetricRecord = {
    id: `driver-metric-${params.monthKey}-${params.level}-${randomUUID()}`,
    type: DRIVER_METRIC_RECORD_TYPE,
    organizationId: params.config.organizationId,
    monthKey: params.monthKey,
    level: params.level,
    driver: params.driverCount.driver,
    count: params.driverCount.count,
    fileName: params.fileName,
    dateKey: params.dateKey,
    createdAt: params.createdAt
  };

  await params.container.items.create(record);
}

async function createVehicleVariantMetricRecord(params: {
  config: CosmosMetricsConfig;
  container: Container;
  variantCount: DriverCount;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
}) {
  const record: VehicleVariantMetricRecord = {
    id: `vehicle-variant-metric-${params.monthKey}-${randomUUID()}`,
    type: VEHICLE_VARIANT_METRIC_RECORD_TYPE,
    organizationId: params.config.organizationId,
    monthKey: params.monthKey,
    variant: params.variantCount.driver,
    count: params.variantCount.count,
    fileName: params.fileName,
    dateKey: params.dateKey,
    createdAt: params.createdAt
  };

  await params.container.items.create(record);
}

async function createDetractorMetricRecord(params: {
  config: CosmosMetricsConfig;
  container: Container;
  detractorCount: number;
  fileName: string;
  monthKey: string;
  dateKey: string;
  createdAt: string;
}) {
  const record: DetractorMetricRecord = {
    id: `detractor-metric-${params.dateKey}-${randomUUID()}`,
    type: DETRACTOR_METRIC_RECORD_TYPE,
    organizationId: params.config.organizationId,
    monthKey: params.monthKey,
    dateKey: params.dateKey,
    count: params.detractorCount,
    fileName: params.fileName,
    createdAt: params.createdAt
  };

  await params.container.items.create(record);
}

export async function recordDriverMetricCounts(
  driverMetrics: DriverMetrics,
  fileName = ""
) {
  const config = getCosmosMetricsConfig();
  const container = getCosmosContainer(config);
  const now = new Date();
  const monthKey = getCurrentMonthKey(now);
  const dateKey = getCurrentDateKey(now);
  const createdAt = now.toISOString();
  const driverRecords = [
    ...driverMetrics.l3Drivers.map((driverCount) => ({
      level: "l3" as const,
      driverCount
    })),
    ...driverMetrics.l2Drivers.map((driverCount) => ({
      level: "l2" as const,
      driverCount
    })),
    ...driverMetrics.l1Drivers.map((driverCount) => ({
      level: "l1" as const,
      driverCount
    }))
  ].filter(({ driverCount }) => driverCount.driver && driverCount.count > 0);
  const variantRecords = driverMetrics.vehicleVariants.filter(
    (variantCount) => variantCount.driver && variantCount.count > 0
  );

  await Promise.all([
    ...driverRecords.map(({ level, driverCount }) =>
      createDriverMetricRecord({
        config,
        container,
        level,
        driverCount,
        fileName,
        monthKey,
        dateKey,
        createdAt
      })
    ),
    ...variantRecords.map((variantCount) =>
      createVehicleVariantMetricRecord({
        config,
        container,
        variantCount,
        fileName,
        monthKey,
        dateKey,
        createdAt
      })
    ),
    driverMetrics.detractorCount > 0
      ? createDetractorMetricRecord({
          config,
          container,
          detractorCount: driverMetrics.detractorCount,
          fileName,
          monthKey,
          dateKey,
          createdAt
        })
      : Promise.resolve()
  ]);
}

export async function safeRecordDriverMetricCounts(
  driverMetrics: DriverMetrics | undefined,
  fileName = ""
) {
  if (!driverMetrics) {
    return;
  }

  try {
    await recordDriverMetricCounts(driverMetrics, fileName);
  } catch (error) {
    logMetricWarning("record driver counts", error);
    // Metrics should never block the actual audio processing flow.
  }
}

export async function getMonthlyUploadMetrics(monthKey = getCurrentMonthKey()) {
  const config = getCosmosMetricsConfig();
  const container = getCosmosContainer(config);
  const metrics: MonthlyUploadMetrics = createEmptyMonthlyMetrics(monthKey);
  const uploadQuerySpec = {
    query:
      "SELECT c.eventType, c.dateKey, c.createdAt FROM c WHERE c.organizationId = @organizationId AND c.type = @type AND c.monthKey = @monthKey",
    parameters: [
      {
        name: "@organizationId",
        value: config.organizationId
      },
      {
        name: "@type",
        value: METRIC_RECORD_TYPE
      },
      {
        name: "@monthKey",
        value: monthKey
      }
    ]
  };
  const driverQuerySpec = {
    query:
      "SELECT c.level, c.driver, c.count, c.dateKey, c.createdAt FROM c WHERE c.organizationId = @organizationId AND c.type = @type AND c.monthKey = @monthKey",
    parameters: [
      {
        name: "@organizationId",
        value: config.organizationId
      },
      {
        name: "@type",
        value: DRIVER_METRIC_RECORD_TYPE
      },
      {
        name: "@monthKey",
        value: monthKey
      }
    ]
  };
  const detractorQuerySpec = {
    query:
      "SELECT c.dateKey, c.createdAt, c.count FROM c WHERE c.organizationId = @organizationId AND c.type = @type AND c.monthKey = @monthKey",
    parameters: [
      {
        name: "@organizationId",
        value: config.organizationId
      },
      {
        name: "@type",
        value: DETRACTOR_METRIC_RECORD_TYPE
      },
      {
        name: "@monthKey",
        value: monthKey
      }
    ]
  };
  const vehicleVariantQuerySpec = {
    query:
      "SELECT c.variant, SUM(c.count) AS count FROM c WHERE c.organizationId = @organizationId AND c.type = @type AND c.monthKey = @monthKey GROUP BY c.variant",
    parameters: [
      {
        name: "@organizationId",
        value: config.organizationId
      },
      {
        name: "@type",
        value: VEHICLE_VARIANT_METRIC_RECORD_TYPE
      },
      {
        name: "@monthKey",
        value: monthKey
      }
    ]
  };
  const [
    { resources: uploadResources },
    { resources: driverResources },
    { resources: detractorResources },
    { resources: vehicleVariantResources }
  ] = await Promise.all([
    container.items
      .query<UploadMetricQueryRow>(uploadQuerySpec, {
        partitionKey: config.organizationId
      })
      .fetchAll(),
    container.items
      .query<DriverMetricQueryRow>(driverQuerySpec, {
        partitionKey: config.organizationId
      })
      .fetchAll(),
    container.items
      .query<DetractorMetricQueryRow>(detractorQuerySpec, {
        partitionKey: config.organizationId
      })
      .fetchAll(),
    container.items
      .query<VehicleVariantMetricQueryRow>(vehicleVariantQuerySpec, {
        partitionKey: config.organizationId
      })
      .fetchAll()
  ]);
  const uploadStatusMap = new Map<string, UploadStatusTrendPoint>();
  const l3DriverCounts = new Map<string, number>();
  const l2DriverCounts = new Map<string, number>();
  const l1DriverCounts = new Map<string, number>();
  const l3DateCounts = new Map<string, number>();
  const l2DateCounts = new Map<string, number>();
  const l1DateCounts = new Map<string, number>();
  const detractorDateCounts = new Map<string, number>();

  function getUploadStatusTrendPoint(date: string) {
    const existingPoint = uploadStatusMap.get(date);

    if (existingPoint) {
      return existingPoint;
    }

    const point: UploadStatusTrendPoint = {
      date,
      uploads: 0,
      successes: 0,
      failures: 0
    };

    uploadStatusMap.set(date, point);

    return point;
  }

  for (const row of uploadResources) {
    const date = getDateKeyFromRecord(row);
    const count = Number(row.count || 1);
    const trendPoint = date ? getUploadStatusTrendPoint(date) : null;

    if (row.eventType === "upload") {
      metrics.uploads += count;

      if (trendPoint) {
        trendPoint.uploads += count;
      }
    }

    if (row.eventType === "success") {
      metrics.successes += count;

      if (trendPoint) {
        trendPoint.successes += count;
      }
    }

    if (row.eventType === "failure") {
      metrics.failures += count;

      if (trendPoint) {
        trendPoint.failures += count;
      }
    }
  }

  for (const row of driverResources) {
    const driver = row.driver?.trim();
    const count = Number(row.count || 0);
    const date = getDateKeyFromRecord(row);

    if (!driver || count <= 0) {
      continue;
    }

    if (row.level === "l3") {
      incrementDriverCount(l3DriverCounts, driver, count);
      incrementDateCount(l3DateCounts, date, count);
    }

    if (row.level === "l2") {
      incrementDriverCount(l2DriverCounts, driver, count);
      incrementDateCount(l2DateCounts, date, count);
    }

    if (row.level === "l1") {
      incrementDriverCount(l1DriverCounts, driver, count);
      incrementDateCount(l1DateCounts, date, count);
    }
  }

  for (const row of detractorResources) {
    const date = getDateKeyFromRecord(row);
    const count = Number(row.count || 0);

    if (date && count > 0) {
      incrementDateCount(detractorDateCounts, date, count);
    }
  }

  for (const row of vehicleVariantResources) {
    const driver = row.variant?.trim();
    const count = Number(row.count || 0);

    if (driver && count > 0) {
      metrics.vehicleVariants.push({ driver, count });
    }
  }

  metrics.uploadStatusByDate = sortUploadStatusTrendPoints(
    Array.from(uploadStatusMap.values())
  );
  metrics.detractorsByDate = toDateCounts(detractorDateCounts);
  metrics.l3DriversByDate = toDateCounts(l3DateCounts);
  metrics.l2DriversByDate = toDateCounts(l2DateCounts);
  metrics.l1DriversByDate = toDateCounts(l1DateCounts);
  metrics.l3Drivers = toDriverCounts(l3DriverCounts);
  metrics.l2Drivers = toDriverCounts(l2DriverCounts);
  metrics.l1Drivers = toDriverCounts(l1DriverCounts);
  sortDriverCounts(metrics.vehicleVariants);
  metrics.updatedAt = new Date().toISOString();

  return metrics;
}
