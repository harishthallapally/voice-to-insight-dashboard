import { NextResponse } from "next/server";

import {
  getCurrentMonthKey,
  getMonthlyUploadMetrics
} from "@/lib/dashboard-metrics-store";

export const runtime = "nodejs";

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
  try {
    const metrics = await getMonthlyUploadMetrics(
      getMonthKeyFromRequest(request)
    );

    return NextResponse.json({ metrics });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.startsWith("Missing required environment variable")
      ? 503
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
