import { NextResponse } from "next/server";

import {
  getCurrentMonthKey,
  getMonthlyUploadMetrics
} from "@/lib/dashboard-metrics-store";
import { getMonthlyUploadMetricsLocal } from "@/lib/dashboard-metrics-local-store";

export const runtime = "nodejs";

type DashboardMetricsSource = "azure" | "local";

function getDashboardDemoMode() {
  const configuredValue = (
    process.env.DASHBOARD_DEMO_MODE ||
    process.env.NEXT_PUBLIC_DASHBOARD_DEMO_MODE ||
    "true"
  )
    .trim()
    .toLowerCase();

  return !["false", "0", "no", "off"].includes(configuredValue);
}

function getDashboardMetricsSource(): DashboardMetricsSource {
  const configuredValue = process.env.DASHBOARD_METRICS_SOURCE?.trim().toLowerCase();

  return configuredValue === "local" ? "local" : "azure";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Dashboard metrics are unavailable.";
}

function getMonthKeyFromRequest(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedMonth = searchParams.get("month")?.trim();

  return requestedMonth && /^\d{4}-\d{2}$/.test(requestedMonth)
    ? requestedMonth
    : getCurrentMonthKey();
}

export async function GET(request: Request) {
  const demoMode = getDashboardDemoMode();

  if (demoMode) {
    return NextResponse.json({ demoMode });
  }

  const source = getDashboardMetricsSource();
  const monthKey = getMonthKeyFromRequest(request);

  try {
    const metrics =
      source === "local"
        ? await getMonthlyUploadMetricsLocal(monthKey)
        : await getMonthlyUploadMetrics(monthKey);

    return NextResponse.json({ demoMode, source, metrics });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.startsWith("Missing required environment variable")
      ? 503
      : 500;

    return NextResponse.json({ demoMode, source, error: message }, { status });
  }
}
