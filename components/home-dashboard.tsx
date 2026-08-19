"use client";

import { useEffect, useState } from "react";

import {
  createEmptyMonthlyUploadStats,
  normalizeMonthlyUploadStats,
  UPLOAD_STATS_UPDATED_EVENT,
  type MonthlyUploadStats
} from "@/lib/upload-stats";

type DashboardStatsResponse = {
  demoMode?: boolean;
  metrics?: Partial<MonthlyUploadStats>;
};

type MonthlyStatsResult = {
  demoMode: boolean;
  stats: MonthlyUploadStats;
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

type VehicleSegment = "EV" | "ICE";

type ReportPeriod = {
  key: string;
  label: string;
  monthKeys: string[];
};

type NpsSummary = MonthlyUploadStats["connectedFeaturesNps"];

type ReportPeriodMetrics = {
  customersUsingApp: number;
  totalCustomersResponded: number;
  percentOfCustomers: number;
  nps: NpsSummary;
};

type SegmentDemoReport = {
  customersUsingApp: number[];
  totalCustomersResponded: number[];
  percentOfCustomers: number[];
  promoters: number[];
  passives: number[];
  detractors: number[];
  nps: number[];
  modelNames: string[];
  modelMetrics: {
    promoters: number[];
    passives: number[];
    detractors: number[];
    nps: number[];
  };
  voiceDrivers: Array<{
    driver: string;
    values: number[];
  }>;
  historicalNps: Array<{
    label: string;
    value: number;
  }>;
  comparisonLine: number[];
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const SEGMENT_DEMO_REPORTS: Record<VehicleSegment, SegmentDemoReport> = {
  EV: {
    customersUsingApp: [328, 508, 509, 50, 132],
    totalCustomersResponded: [715, 890, 919, 114, 264],
    percentOfCustomers: [46, 57, 55, 44, 50],
    promoters: [63, 65, 68, 76, 74],
    passives: [21, 21, 20, 16, 17],
    detractors: [16, 14, 13, 8, 9],
    nps: [47, 51, 55, 68, 65],
    modelNames: ["iQube", "Orbiter"],
    modelMetrics: {
      promoters: [72, 80],
      passives: [20, 12],
      detractors: [8, 8],
      nps: [64, 72]
    },
    voiceDrivers: [
      {
        driver: "Bluetooth connectivity problem",
        values: [6.4, 5.5, 5.7, 2, 2.4]
      },
      {
        driver: "Mobile App not showing correct stats",
        values: [3.8, 4.1, 5.1, 2, 2.6]
      },
      {
        driver: "Mobile App Performance problem",
        values: [7.3, 5.5, 5.5, 0, 1.2]
      },
      {
        driver: "Navigation assist wrong",
        values: [2.5, 2.4, 3.1, 0, 0.8]
      }
    ],
    historicalNps: [
      { label: "23-24", value: 50 },
      { label: "24-25", value: 30 },
      { label: "25-26", value: 48 }
    ],
    comparisonLine: [40, 40, 41, 43, 48, 51, 48, 43, 45, 48, 50]
  },
  ICE: {
    customersUsingApp: [420, 610, 625, 160, 172],
    totalCustomersResponded: [980, 1100, 1160, 310, 335],
    percentOfCustomers: [43, 55, 54, 52, 51],
    promoters: [58, 61, 63, 68, 70],
    passives: [24, 23, 22, 20, 19],
    detractors: [18, 16, 15, 12, 11],
    nps: [40, 45, 48, 56, 59],
    modelNames: ["Apache", "Ntorq"],
    modelMetrics: {
      promoters: [69, 64],
      passives: [19, 22],
      detractors: [12, 14],
      nps: [57, 50]
    },
    voiceDrivers: [
      {
        driver: "Bluetooth connectivity problem",
        values: [5.8, 5.1, 4.9, 2.2, 2.6]
      },
      {
        driver: "Trip stats not updating",
        values: [4.2, 4.8, 5.4, 2.4, 2.8]
      },
      {
        driver: "Mobile App Performance problem",
        values: [6.9, 5.7, 5.2, 1.8, 2.1]
      },
      {
        driver: "Navigation assist wrong",
        values: [2.8, 2.6, 3.4, 1.1, 1.3]
      }
    ],
    historicalNps: [
      { label: "23-24", value: 44 },
      { label: "24-25", value: 36 },
      { label: "25-26", value: 42 }
    ],
    comparisonLine: [39, 40, 41, 42, 45, 47, 46, 44, 46, 47, 49]
  }
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
    connectedFeaturesNps: {
      score: 45,
      promoters: 19,
      passives: 7,
      detractors: 5,
      totalResponses: 31
    },
    connectedFeaturesNpsByDate: [
      {
        date: "2026-08-01",
        score: 33,
        promoters: 3,
        passives: 2,
        detractors: 1,
        totalResponses: 6
      },
      {
        date: "2026-08-02",
        score: 50,
        promoters: 5,
        passives: 2,
        detractors: 1,
        totalResponses: 8
      },
      {
        date: "2026-08-03",
        score: 33,
        promoters: 5,
        passives: 2,
        detractors: 2,
        totalResponses: 9
      },
      {
        date: "2026-08-04",
        score: 63,
        promoters: 6,
        passives: 1,
        detractors: 1,
        totalResponses: 8
      }
    ],
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
    connectedFeaturesNps: demoStats.connectedFeaturesNps,
    connectedFeaturesNpsByDate: demoStats.connectedFeaturesNpsByDate,
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

function formatNpsScore(score: number | null) {
  if (score === null) {
    return "--";
  }

  return score > 0 ? `+${score}` : String(score);
}

function formatPlainNpsScore(score: number | null) {
  return score === null ? "--" : String(score);
}

function getMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const monthIndex = Number(month) - 1;
  const yearSuffix = year?.slice(2) || "";

  return MONTH_LABELS[monthIndex]
    ? `${MONTH_LABELS[monthIndex]}'${yearSuffix}`
    : monthKey;
}

function formatPercent(part: number, total: number) {
  return total > 0 ? String(Math.round((part / total) * 100)) : "0";
}

function formatPercentValue(value: number) {
  return Number.isFinite(value) ? String(Math.round(value)) : "0";
}

function getMonthKey(year: number, monthIndex: number) {
  const normalizedYear = year + Math.floor(monthIndex / 12);
  const normalizedMonthIndex = ((monthIndex % 12) + 12) % 12;

  return `${normalizedYear}-${String(normalizedMonthIndex + 1).padStart(2, "0")}`;
}

function getFiscalQuarterInfo(monthKey: string) {
  const [yearText, monthText] = monthKey.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  if (monthIndex >= 3 && monthIndex <= 5) {
    return { quarter: 1, fiscalStartYear: year };
  }

  if (monthIndex >= 6 && monthIndex <= 8) {
    return { quarter: 2, fiscalStartYear: year };
  }

  if (monthIndex >= 9 && monthIndex <= 11) {
    return { quarter: 3, fiscalStartYear: year };
  }

  return { quarter: 4, fiscalStartYear: year - 1 };
}

function getFiscalYearLabel(fiscalStartYear: number) {
  return `${String(fiscalStartYear).slice(2)}-${String(fiscalStartYear + 1).slice(2)}`;
}

function getFiscalQuarterStartMonth(quarter: number) {
  return [3, 6, 9, 0][quarter - 1] ?? 3;
}

function getQuarterMonthKeys(quarter: number, fiscalStartYear: number) {
  const startMonth = getFiscalQuarterStartMonth(quarter);
  const startYear = quarter === 4 ? fiscalStartYear + 1 : fiscalStartYear;

  return [0, 1, 2].map((offset) => getMonthKey(startYear, startMonth + offset));
}

function getShiftedFiscalQuarter(monthKey: string, quarterOffset: number) {
  const currentQuarter = getFiscalQuarterInfo(monthKey);
  const currentIndex =
    currentQuarter.fiscalStartYear * 4 + currentQuarter.quarter - 1;
  const nextIndex = currentIndex + quarterOffset;
  const fiscalStartYear = Math.floor(nextIndex / 4);
  const quarter = ((nextIndex % 4) + 4) % 4 + 1;

  return {
    key: `Q${quarter}-${fiscalStartYear}`,
    label: `Q${quarter}'${getFiscalYearLabel(fiscalStartYear)}`,
    monthKeys: getQuarterMonthKeys(quarter, fiscalStartYear)
  };
}

function getReportPeriods(monthKey: string): ReportPeriod[] {
  const currentQuarter = getFiscalQuarterInfo(monthKey);
  const currentQuarterMonths = getQuarterMonthKeys(
    currentQuarter.quarter,
    currentQuarter.fiscalStartYear
  );
  const currentMonthIndex = Math.max(
    0,
    currentQuarterMonths.indexOf(monthKey)
  );
  const currentQuarterMonthPeriods = currentQuarterMonths
    .slice(0, currentMonthIndex + 1)
    .map((currentMonthKey) => ({
      key: currentMonthKey,
      label: getMonthLabel(currentMonthKey),
      monthKeys: [currentMonthKey]
    }));

  return [
    getShiftedFiscalQuarter(monthKey, -2),
    getShiftedFiscalQuarter(monthKey, -1),
    ...currentQuarterMonthPeriods
  ];
}

function getVisibleReportDates(stats: MonthlyUploadStats) {
  const dateSet = new Set<string>();

  stats.uploadStatusByDate.forEach((row) => dateSet.add(row.date));
  stats.connectedFeaturesNpsByDate.forEach((row) => dateSet.add(row.date));

  return Array.from(dateSet).sort().slice(-6);
}

function getUploadStatusForDate(stats: MonthlyUploadStats, date: string) {
  return (
    stats.uploadStatusByDate.find((row) => row.date === date) ?? {
      date,
      uploads: 0,
      successes: 0,
      failures: 0
    }
  );
}

function getNpsForDate(stats: MonthlyUploadStats, date: string) {
  return (
    stats.connectedFeaturesNpsByDate.find((row) => row.date === date) ?? {
      date,
      score: null,
      promoters: 0,
      passives: 0,
      detractors: 0,
      totalResponses: 0
    }
  );
}

function createNpsSummary(params: {
  promoters: number;
  passives: number;
  detractors: number;
  totalResponses: number;
}): NpsSummary {
  return {
    ...params,
    score:
      params.totalResponses > 0
        ? Math.round(
            ((params.promoters - params.detractors) / params.totalResponses) *
              100
          )
        : null
  };
}

function getPeriodMetricsFromStats(
  stats: MonthlyUploadStats,
  period: ReportPeriod
): ReportPeriodMetrics {
  const periodMonths = new Set(period.monthKeys);
  const uploadRows = stats.uploadStatusByDate.filter((row) =>
    periodMonths.has(row.date.slice(0, 7))
  );
  const npsRows = stats.connectedFeaturesNpsByDate.filter((row) =>
    periodMonths.has(row.date.slice(0, 7))
  );
  let customersUsingApp = uploadRows.reduce(
    (total, row) => total + row.uploads,
    0
  );
  let totalCustomersResponded = npsRows.reduce(
    (total, row) => total + row.totalResponses,
    0
  );
  let promoters = npsRows.reduce((total, row) => total + row.promoters, 0);
  let passives = npsRows.reduce((total, row) => total + row.passives, 0);
  let detractors = npsRows.reduce((total, row) => total + row.detractors, 0);

  if (periodMonths.has(stats.monthKey)) {
    customersUsingApp = customersUsingApp || stats.uploads;
    totalCustomersResponded =
      totalCustomersResponded || stats.connectedFeaturesNps.totalResponses;
    promoters = promoters || stats.connectedFeaturesNps.promoters;
    passives = passives || stats.connectedFeaturesNps.passives;
    detractors = detractors || stats.connectedFeaturesNps.detractors;
  }

  return {
    customersUsingApp,
    totalCustomersResponded,
    percentOfCustomers:
      totalCustomersResponded > 0
        ? Math.round((customersUsingApp / totalCustomersResponded) * 100)
        : 0,
    nps: createNpsSummary({
      promoters,
      passives,
      detractors,
      totalResponses: totalCustomersResponded
    })
  };
}

function getSegmentPeriodMetrics(params: {
  stats: MonthlyUploadStats;
  periods: ReportPeriod[];
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const demoReport = SEGMENT_DEMO_REPORTS[params.segment];

  return params.periods.map((period, index) => {
    if (!params.demoMode) {
      return getPeriodMetricsFromStats(params.stats, period);
    }

    const totalResponses = demoReport.totalCustomersResponded[index] ?? 0;
    const promoterPercent = demoReport.promoters[index] ?? 0;
    const passivePercent = demoReport.passives[index] ?? 0;
    const detractorPercent = demoReport.detractors[index] ?? 0;

    return {
      customersUsingApp: demoReport.customersUsingApp[index] ?? 0,
      totalCustomersResponded: totalResponses,
      percentOfCustomers: demoReport.percentOfCustomers[index] ?? 0,
      nps: {
        score: demoReport.nps[index] ?? null,
        promoters: Math.round((promoterPercent / 100) * totalResponses),
        passives: Math.round((passivePercent / 100) * totalResponses),
        detractors: Math.round((detractorPercent / 100) * totalResponses),
        totalResponses
      }
    };
  });
}

function getPeriodNpsPercent(
  metrics: ReportPeriodMetrics,
  field: "promoters" | "passives" | "detractors"
) {
  return formatPercent(metrics.nps[field], metrics.nps.totalResponses);
}

function ConnectedFeaturesNpsCard({
  stats,
  isLoading
}: UploadStatusChartProps) {
  const nps = stats.connectedFeaturesNps;
  const detailItems = [
    {
      label: "Promoters",
      value: nps.promoters,
      className: "is-promoters"
    },
    {
      label: "Passives",
      value: nps.passives,
      className: "is-passives"
    },
    {
      label: "Detractors",
      value: nps.detractors,
      className: "is-detractors"
    },
    {
      label: "Responses",
      value: nps.totalResponses,
      className: "is-responses"
    }
  ];

  return (
    <section className="home-nps-card">
      <div>
        <p className="eyebrow">Connected Features Rating</p>
        <h3>NPS</h3>
      </div>
      <strong>{isLoading ? "--" : formatNpsScore(nps.score)}</strong>
      <div className="home-nps-breakdown">
        {detailItems.map((item) => (
          <span className={item.className} key={item.label}>
            {item.label}: {isLoading ? "--" : item.value}
          </span>
        ))}
      </div>
    </section>
  );
}

type ReportTableRow = {
  label: string;
  uom: string;
  values: Array<string | number>;
};

function ReportTable({
  title,
  columns,
  rows
}: {
  title: string;
  columns: string[];
  rows: ReportTableRow[];
}) {
  return (
    <section className="home-report-box">
      <h3>{title}</h3>
      <div className="home-report-table-scroll">
        <table className="home-report-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.uom}</td>
                {row.values.map((value, index) => (
                  <td key={`${row.label}-${index}`}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConnectedCustomersTable({
  stats,
  periods,
  segment,
  demoMode
}: {
  stats: MonthlyUploadStats;
  periods: ReportPeriod[];
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const columns = ["Description", "UoM", ...periods.map((period) => period.label)];
  const periodMetrics = getSegmentPeriodMetrics({
    stats,
    periods,
    segment,
    demoMode
  });
  const rows: ReportTableRow[] = [
    {
      label: "Customers using App",
      uom: "No's",
      values: periodMetrics.map((metrics) => metrics.customersUsingApp)
    },
    {
      label: "Total customers responded",
      uom: "No's",
      values: periodMetrics.map((metrics) => metrics.totalCustomersResponded)
    },
    {
      label: "% of customers",
      uom: "%",
      values: periodMetrics.map((metrics) =>
        formatPercentValue(metrics.percentOfCustomers)
      )
    }
  ];

  return (
    <ReportTable
      title="Customers using Connected Features"
      columns={columns}
      rows={rows}
    />
  );
}

function NpsStratificationTable({
  stats,
  periods,
  segment,
  demoMode
}: {
  stats: MonthlyUploadStats;
  periods: ReportPeriod[];
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const columns = ["Customers", "UoM", ...periods.map((period) => period.label)];
  const periodMetrics = getSegmentPeriodMetrics({
    stats,
    periods,
    segment,
    demoMode
  });
  const rows: ReportTableRow[] = [
    {
      label: "Promoters",
      uom: "%",
      values: periodMetrics.map((metrics) =>
        getPeriodNpsPercent(metrics, "promoters")
      )
    },
    {
      label: "Passives",
      uom: "%",
      values: periodMetrics.map((metrics) =>
        getPeriodNpsPercent(metrics, "passives")
      )
    },
    {
      label: "Detractors",
      uom: "%",
      values: periodMetrics.map((metrics) =>
        getPeriodNpsPercent(metrics, "detractors")
      )
    },
    {
      label: "NPS",
      uom: "Score",
      values: periodMetrics.map((metrics) =>
        formatPlainNpsScore(metrics.nps.score)
      )
    }
  ];

  return (
    <ReportTable
      title="Stratification of NPS customers"
      columns={columns}
      rows={rows}
    />
  );
}

function ModelNpsTable({
  stats,
  segment,
  demoMode
}: {
  stats: MonthlyUploadStats;
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const demoReport = SEGMENT_DEMO_REPORTS[segment];
  const modelNames = demoMode
    ? demoReport.modelNames
    : stats.vehicleVariants.slice(0, 2).map((variant) => variant.driver);
  const visibleModels = modelNames.length
    ? modelNames
    : segment === "EV"
      ? ["iQube", "Orbiter"]
      : ["Apache", "Ntorq"];
  const getModelValues = (field: keyof SegmentDemoReport["modelMetrics"]) =>
    demoMode
      ? demoReport.modelMetrics[field].slice(0, visibleModels.length)
      : visibleModels.map(() =>
          field === "nps"
            ? (stats.connectedFeaturesNps.score ?? 0)
            : Number(
                formatPercent(
                  stats.connectedFeaturesNps[field],
                  stats.connectedFeaturesNps.totalResponses
                )
              )
        );
  const rows: ReportTableRow[] = [
    {
      label: "Promoters",
      uom: "%",
      values: getModelValues("promoters")
    },
    {
      label: "Passives",
      uom: "%",
      values: getModelValues("passives")
    },
    {
      label: "Detractors",
      uom: "%",
      values: getModelValues("detractors")
    },
    {
      label: "NPS",
      uom: "Score",
      values: getModelValues("nps")
    }
  ];

  return (
    <ReportTable
      title={`Connected Feature NPS - ${segment} Model`}
      columns={["Customers", "UoM", ...visibleModels]}
      rows={rows}
    />
  );
}

function VoiceDriversChart({
  stats,
  periods,
  segment,
  demoMode
}: {
  stats: MonthlyUploadStats;
  periods: ReportPeriod[];
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const demoReport = SEGMENT_DEMO_REPORTS[segment];
  const rows = demoMode
    ? demoReport.voiceDrivers
    : stats.l2Drivers.slice(0, 4).map((driver) => ({
        driver: driver.driver,
        values: periods.map((period) =>
          period.monthKeys.includes(stats.monthKey) ? driver.count : 0
        )
      }));
  const maxCount = Math.max(
    1,
    ...rows.flatMap((row) => row.values.slice(0, periods.length))
  );

  return (
    <section className="home-report-box home-report-voice">
      <h3>Voice of Detractors & Passives</h3>
      <div className="home-report-legend">
        {periods.map((period, index) => (
          <span className={`is-series-${index}`} key={period.key}>
            {period.label}
          </span>
        ))}
      </div>
      {rows.length ? (
        <div className="home-report-voice-bars">
          {rows.map((row) => (
            <div className="home-report-voice-group" key={row.driver}>
              <div className="home-report-grouped-bars">
                {row.values.slice(0, periods.length).map((value, index) => (
                  <div
                    className={`home-report-mini-bar is-series-${index}`}
                    key={`${row.driver}-${periods[index]?.key || index}`}
                    title={`${periods[index]?.label || "Period"}: ${value}`}
                  >
                    <strong>{value}</strong>
                    <span
                      style={{
                        height: `${Math.max(12, (value / maxCount) * 100)}%`
                      }}
                    />
                  </div>
                ))}
              </div>
              <small>{row.driver}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="home-driver-empty">No driver data found this month.</p>
      )}
    </section>
  );
}

function NpsTrendChart({
  stats,
  periods,
  segment,
  demoMode
}: {
  stats: MonthlyUploadStats;
  periods: ReportPeriod[];
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const demoReport = SEGMENT_DEMO_REPORTS[segment];
  const periodMetrics = getSegmentPeriodMetrics({
    stats,
    periods,
    segment,
    demoMode
  });
  const periodRows = periodMetrics
    .map((metrics, index) => ({
      label: periods[index]?.label || "",
      value: metrics.nps.score,
      responseCount: metrics.totalCustomersResponded
    }))
    .filter((row) => row.value !== null);
  const historicalRows = demoMode ? demoReport.historicalNps : [];
  const rows = [...historicalRows, ...periodRows];
  const chartWidth = 860;
  const chartHeight = 300;
  const left = 58;
  const right = 28;
  const top = 24;
  const bottom = 58;
  const plotWidth = chartWidth - left - right;
  const plotHeight = chartHeight - top - bottom;
  const lowerBound = 40;
  const upperBound = 80;
  const responseMax = Math.max(
    1,
    ...periodRows.map((row) => row.responseCount)
  );
  const firstPointPadding = 28;
  const availablePlotWidth = plotWidth - firstPointPadding;
  const getX = (index: number) =>
    left +
    firstPointPadding +
    (rows.length > 1
      ? (index / (rows.length - 1)) * availablePlotWidth
      : availablePlotWidth / 2);
  const getY = (score: number) =>
    top +
    ((upperBound - Math.max(lowerBound, Math.min(upperBound, score))) /
      (upperBound - lowerBound)) *
      plotHeight;
  const periodStartIndex = historicalRows.length;
  const actualPoints = periodRows
    .map(
      (row, index) =>
        `${getX(periodStartIndex + index)},${getY(row.value ?? 0)}`
    )
    .join(" ");
  const comparisonPoints =
    demoMode && demoReport.comparisonLine.length
      ? rows
          .map((_, index) => {
            const value =
              demoReport.comparisonLine[index] ??
              demoReport.comparisonLine.at(-1) ??
              lowerBound;

            return `${getX(index)},${getY(value)}`;
          })
          .join(" ")
      : "";
  const ticks = [80, 70, 60, 50, 40];

  return (
    <section className="home-report-box home-report-trend">
      <div className="home-report-chart-title">
        <h3>UOM: Net Promoter Score</h3>
        <span>{segment}</span>
      </div>
      <div className="home-report-nps-legend" aria-label="Net promoter score chart legend">
        <span className="is-current">Current NPS trend</span>
        <span className="is-comparison">Previous comparison trend</span>
        <span className="is-volume">Historical year score</span>
      </div>
      {rows.length ? (
        <svg
          className="home-report-nps-svg"
          role="img"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          aria-label="Connected feature NPS trend"
        >
          {ticks.map((tick) => {
            const y = getY(tick);

            return (
              <g key={tick}>
                <line
                  className="home-report-grid-line"
                  x1={left}
                  x2={chartWidth - right}
                  y1={y}
                  y2={y}
                />
                <text className="home-report-axis-label" x={left - 12} y={y + 4}>
                  {tick}
                </text>
              </g>
            );
          })}
          <line
            className="home-report-axis"
            x1={left}
            x2={chartWidth - right}
            y1={chartHeight - bottom}
            y2={chartHeight - bottom}
          />
          <line
            className="home-report-axis"
            x1={left}
            x2={left}
            y1={top}
            y2={chartHeight - bottom}
          />
          {rows.map((row, index) => {
            const x = getX(index);
            const isHistorical = index < historicalRows.length;
            const periodRow = periodRows[index - historicalRows.length];
            const barHeight = isHistorical
              ? Math.max(8, ((row.value ?? 0) / upperBound) * 54)
              : Math.max(
                  8,
                  ((periodRow?.responseCount || 0) / responseMax) * 54
            );

            return (
              <g key={`bar-${row.label}-${index}`}>
                {isHistorical ? (
                  <rect
                    className="home-report-response-bar"
                    x={x - 14}
                    y={chartHeight - bottom - barHeight}
                    width={28}
                    height={barHeight}
                  />
                ) : null}
                <text
                  className="home-report-x-label"
                  x={x}
                  y={chartHeight - bottom + 30}
                >
                  {row.label}
                </text>
              </g>
            );
          })}
          {comparisonPoints ? (
            <polyline
              className="home-report-comparison-line"
              points={comparisonPoints}
            />
          ) : null}
          <polyline className="home-report-nps-line" points={actualPoints} />
          {rows.map((row, index) => {
            const x = getX(index);
            const y = getY(row.value ?? 0);

            return (
              <g key={`point-${row.label}-${index}`}>
                {index >= periodStartIndex ? (
                  <circle
                    className="home-report-nps-point"
                    cx={x}
                    cy={y}
                    r={5}
                  />
                ) : null}
                <text className="home-report-score-label" x={x} y={y - 10}>
                  {formatPlainNpsScore(row.value)}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="home-driver-empty">No NPS trend found this month.</p>
      )}
    </section>
  );
}

function ConnectedFeaturePerformanceReport({
  stats,
  isLoading,
  segment,
  demoMode
}: UploadStatusChartProps & {
  segment: VehicleSegment;
  demoMode: boolean;
}) {
  const periods = getReportPeriods(stats.monthKey);
  const segmentTitle = segment;

  return (
    <section className="home-report-sheet" aria-busy={isLoading}>
      <div className="home-report-titlebar">
        <h2>{`Connected Feature NPS Performance (${segmentTitle})`}</h2>
      </div>
      <div className="home-report-accent" />

      <div className="home-report-top-grid">
        <ConnectedCustomersTable
          stats={stats}
          periods={periods}
          segment={segment}
          demoMode={demoMode}
        />
        <NpsStratificationTable
          stats={stats}
          periods={periods}
          segment={segment}
          demoMode={demoMode}
        />
        <VoiceDriversChart
          stats={stats}
          periods={periods}
          segment={segment}
          demoMode={demoMode}
        />
      </div>

      <div className="home-report-main-grid">
        <ModelNpsTable stats={stats} segment={segment} demoMode={demoMode} />
        <NpsTrendChart
          stats={stats}
          periods={periods}
          segment={segment}
          demoMode={demoMode}
        />
      </div>
    </section>
  );
}

function applyDashboardMode(stats: MonthlyUploadStats, demoMode: boolean) {
  return demoMode ? withDemoDashboardData(stats) : stats;
}

async function fetchMonthlyStats(): Promise<MonthlyStatsResult> {
  const response = await fetch("/api/dashboard/monthly-stats", {
    cache: "no-store"
  });
  const payload = (await response.json()) as DashboardStatsResponse;
  const demoMode = payload.demoMode ?? true;

  if (!response.ok) {
    return {
      demoMode,
      stats: createEmptyMonthlyUploadStats()
    };
  }

  return {
    demoMode,
    stats: normalizeMonthlyUploadStats(payload.metrics)
  };
}

export function HomeDashboard() {
  const [stats, setStats] = useState<MonthlyUploadStats>(
    createEmptyMonthlyUploadStats
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadStats() {
      try {
        const { demoMode, stats: serverStats } = await fetchMonthlyStats();

        if (isMounted) {
          setIsDemoMode(demoMode);
          setStats(applyDashboardMode(serverStats, demoMode));
        }
      } catch {
        if (isMounted) {
          setIsDemoMode(false);
          setStats(createEmptyMonthlyUploadStats());
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
            </div>
          </div>

          <div className="home-dashboard-reports">
            <ConnectedFeaturePerformanceReport
              stats={stats}
              isLoading={isLoading}
              segment="EV"
              demoMode={isDemoMode}
            />
            <ConnectedFeaturePerformanceReport
              stats={stats}
              isLoading={isLoading}
              segment="ICE"
              demoMode={isDemoMode}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
