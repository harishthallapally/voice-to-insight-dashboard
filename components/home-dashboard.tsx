"use client";

import { useEffect, useState } from "react";

import {
  createEmptyMonthlyUploadStats,
  mergeMonthlyUploadStats,
  normalizeMonthlyUploadStats,
  readLocalMonthlyUploadStats,
  UPLOAD_STATS_UPDATED_EVENT,
  type MonthlyUploadStats
} from "@/lib/upload-stats";

type HomeDashboardProps = {
  onOpenUpload: () => void;
};

type DashboardStatsResponse = {
  metrics?: Partial<MonthlyUploadStats>;
};

type DateTrendChartProps = {
  title: string;
  rows: MonthlyUploadStats["detractorsByDate"];
  emptyText: string;
  cardClassName?: string;
  tone?: "default" | "danger";
};

type VerticalBarChartProps = {
  title: string;
  rows: Array<{
    label: string;
    count: number;
    countLabel?: string;
    tone?: string;
  }>;
  emptyText: string;
  chartClassName?: string;
  cardClassName?: string;
};

type UploadStatusChartProps = {
  stats: MonthlyUploadStats;
  isLoading: boolean;
};

function getMaxCount(rows: Array<{ count: number }>) {
  return Math.max(1, ...rows.map((row) => row.count));
}

function formatDateLabel(date: string) {
  const [, month, day] = date.split("-");

  return day && month ? `${day}-${month}` : date;
}

function createDemoDashboardStats(monthKey: string): MonthlyUploadStats {
  return normalizeMonthlyUploadStats({
    monthKey,
    uploads: 31,
    successes: 28,
    failures: 3,
    uploadStatusByDate: [
      { date: "2026-08-01", uploads: 6, successes: 5, failures: 1 },
      { date: "2026-08-02", uploads: 8, successes: 7, failures: 1 },
      { date: "2026-08-03", uploads: 9, successes: 8, failures: 1 },
      { date: "2026-08-04", uploads: 8, successes: 8, failures: 0 }
    ],
    l2DriversByDate: [
      { date: "2026-08-01", count: 4 },
      { date: "2026-08-02", count: 6 },
      { date: "2026-08-03", count: 5 },
      { date: "2026-08-04", count: 7 }
    ],
    l1DriversByDate: [
      { date: "2026-08-01", count: 3 },
      { date: "2026-08-02", count: 5 },
      { date: "2026-08-03", count: 4 },
      { date: "2026-08-04", count: 6 }
    ],
    l3DriversByDate: [
      { date: "2026-08-01", count: 5 },
      { date: "2026-08-02", count: 7 },
      { date: "2026-08-03", count: 6 },
      { date: "2026-08-04", count: 8 }
    ],
    detractorsByDate: [
      { date: "2026-08-01", count: 2 },
      { date: "2026-08-02", count: 3 },
      { date: "2026-08-03", count: 2 },
      { date: "2026-08-04", count: 4 }
    ],
    l2Drivers: [
      { driver: "Map or navigation accuracy issue", count: 7 },
      { driver: "Bluetooth pairing or connection issue", count: 5 },
      { driver: "Feature not working issue", count: 4 },
      { driver: "Vehicle issue", count: 3 }
    ],
    l1Drivers: [
      { driver: "Navigation Issue", count: 7 },
      { driver: "Bluetooth Connectivity Issue", count: 5 },
      { driver: "Functionality Issue", count: 4 },
      { driver: "Vehicle issue", count: 3 }
    ],
    l3Drivers: [
      { driver: "Navigation instruction inaccurate", count: 7 },
      { driver: "Bluetooth not connecting", count: 5 },
      { driver: "App feature not working", count: 4 },
      { driver: "Vehicle performance concern", count: 3 }
    ],
    vehicleVariants: [],
    updatedAt: new Date().toISOString()
  });
}

function withDemoDashboardData(stats: MonthlyUploadStats) {
  const demoStats = createDemoDashboardStats(stats.monthKey);

  return {
    ...stats,
    uploads: demoStats.uploads,
    successes: demoStats.successes,
    failures: demoStats.failures,
    uploadStatusByDate: demoStats.uploadStatusByDate,
    l2DriversByDate: demoStats.l2DriversByDate,
    l1DriversByDate: demoStats.l1DriversByDate,
    l3DriversByDate: demoStats.l3DriversByDate,
    detractorsByDate: demoStats.detractorsByDate,
    l2Drivers: demoStats.l2Drivers,
    l1Drivers: demoStats.l1Drivers,
    l3Drivers: demoStats.l3Drivers
  };
}

function UploadStatusChart({ stats, isLoading }: UploadStatusChartProps) {
  const rows = isLoading ? [] : stats.uploadStatusByDate;
  const maxCount = getMaxCount(
    rows.flatMap((row) => [
      { count: row.uploads },
      { count: row.successes },
      { count: row.failures }
    ])
  );

  return (
    <section className="home-chart-card">
      <div className="home-chart-header">
        <h3>Upload Status Date Wise</h3>
      </div>
      <div className="home-status-legend" aria-label="Upload status legend">
        <span className="is-uploads">Uploaded</span>
        <span className="is-successes">Success</span>
        <span className="is-failures">Failures</span>
      </div>

      {isLoading ? (
        <p className="home-driver-empty">Loading trend...</p>
      ) : rows.length ? (
        <div className="home-status-trend-chart">
          {rows.map((row) => (
            <div className="home-status-trend-group" key={row.date}>
              <div className="home-status-bars">
                {[
                  { label: "Uploaded", count: row.uploads, tone: "uploads" },
                  { label: "Success", count: row.successes, tone: "successes" },
                  { label: "Failures", count: row.failures, tone: "failures" }
                ].map((bar) => (
                  <div
                    className={`home-status-bar is-${bar.tone}`}
                    key={bar.label}
                    title={`${bar.label}: ${bar.count}`}
                  >
                    <strong>{bar.count}</strong>
                    <div aria-hidden="true">
                      <span
                        style={{
                          height: bar.count
                            ? `${Math.max(8, (bar.count / maxCount) * 100)}%`
                            : "0%"
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <small>{formatDateLabel(row.date)}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="home-driver-empty">
          No upload activity found this month.
        </p>
      )}
    </section>
  );
}

function VerticalBarChart({
  title,
  rows,
  emptyText,
  chartClassName = "",
  cardClassName = ""
}: VerticalBarChartProps) {
  const maxCount = getMaxCount(rows);

  return (
    <section className={`home-chart-card ${cardClassName}`}>
      <div className="home-chart-header">
        <h3>{title}</h3>
      </div>

      {rows.length ? (
        <div className={`home-vertical-chart ${chartClassName}`}>
          {rows.map((row) => (
            <div
              className={`home-vertical-bar is-${row.tone || "default"}`}
              key={row.label}
            >
              <strong>{row.countLabel ?? row.count}</strong>
              <div aria-hidden="true">
                <span
                  style={{
                    height: row.count
                      ? `${Math.max(8, (row.count / maxCount) * 100)}%`
                      : "0%"
                  }}
                />
              </div>
              <small>{row.label}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="home-driver-empty">{emptyText}</p>
      )}
    </section>
  );
}

function DateTrendChart({
  title,
  rows,
  emptyText,
  cardClassName = "",
  tone = "default"
}: DateTrendChartProps) {
  return (
    <VerticalBarChart
      title={title}
      rows={rows.map((row) => ({
        label: formatDateLabel(row.date),
        count: row.count,
        tone
      }))}
      emptyText={emptyText}
      cardClassName={cardClassName}
      chartClassName={cardClassName ? "home-wide-trend-chart" : ""}
    />
  );
}

async function fetchMonthlyStats() {
  const response = await fetch("/api/dashboard/monthly-stats", {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Dashboard metrics are unavailable.");
  }

  const payload = (await response.json()) as DashboardStatsResponse;

  return mergeMonthlyUploadStats(
    normalizeMonthlyUploadStats(payload.metrics),
    readLocalMonthlyUploadStats()
  );
}

export function HomeDashboard({ onOpenUpload }: HomeDashboardProps) {
  const [stats, setStats] = useState<MonthlyUploadStats>(
    createEmptyMonthlyUploadStats
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      try {
        const serverStats = await fetchMonthlyStats();

        if (isMounted) {
          setStats(withDemoDashboardData(serverStats));
        }
      } catch {
        if (isMounted) {
          setStats(withDemoDashboardData(readLocalMonthlyUploadStats()));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadStats();

    window.addEventListener(UPLOAD_STATS_UPDATED_EVENT, loadStats);
    window.addEventListener("focus", loadStats);

    return () => {
      isMounted = false;
      window.removeEventListener(UPLOAD_STATS_UPDATED_EVENT, loadStats);
      window.removeEventListener("focus", loadStats);
    };
  }, []);

  return (
    <div className="home-dashboard">
      <section className="panel">
        <div className="panel-inner home-dashboard-panel">
          <div className="home-dashboard-header">
            <div>
              <p className="eyebrow">Home Dashboard</p>
              <h2>This Month</h2>
              <span>{stats.monthKey}</span>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={onOpenUpload}
            >
              Go to Upload Screen
            </button>
          </div>

          <UploadStatusChart stats={stats} isLoading={isLoading} />

          <div className="home-chart-grid">
            <DateTrendChart
              title="L2 Drivers Date Wise"
              rows={stats.l2DriversByDate}
              emptyText="No L2 driver trend found this month."
            />
            <DateTrendChart
              title="L1 Drivers Date Wise"
              rows={stats.l1DriversByDate}
              emptyText="No L1 driver trend found this month."
            />
            <DateTrendChart
              title="L3 Drivers Date Wise"
              rows={stats.l3DriversByDate}
              emptyText="No L3 driver trend found this month."
              cardClassName="home-chart-card-wide"
            />
            <DateTrendChart
              title="Detractors Date Wise"
              rows={stats.detractorsByDate}
              emptyText="No detractors found this month."
              cardClassName="home-chart-card-wide"
              tone="danger"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
