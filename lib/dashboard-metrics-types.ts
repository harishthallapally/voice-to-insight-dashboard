import type { DateCount, DriverCount, NpsMetrics } from "@/lib/driver-metrics";

/**
 * Shared between lib/dashboard-metrics-store.ts (Azure Cosmos) and
 * lib/dashboard-metrics-local-store.ts (local JSON file) so neither store
 * has to import the other — the dashboard route picks whichever one to call
 * based on DASHBOARD_METRICS_SOURCE, and the job queue can write to either
 * or both based on DASHBOARD_METRICS_ENABLED / DASHBOARD_LOCAL_METRICS_ENABLED.
 */

export type UploadMetricEventType = "upload" | "success" | "failure";
export type DriverMetricLevel = "l1" | "l2" | "l3";

export type UploadStatusTrendPoint = {
  date: string;
  uploads: number;
  successes: number;
  failures: number;
};

export type DateNpsMetric = NpsMetrics & {
  date: string;
};

export type MonthlyUploadMetrics = {
  monthKey: string;
  uploads: number;
  successes: number;
  failures: number;
  uploadStatusByDate: UploadStatusTrendPoint[];
  connectedFeaturesNps: NpsMetrics;
  connectedFeaturesNpsByDate: DateNpsMetric[];
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
