"use client";

import { useEffect, useMemo, useState } from "react";

import {
  formatMonthKey,
  type FuelType,
  type ParsedWorkbook
} from "@/lib/nps-excel";
import {
  buildDashboardModel,
  DEFAULT_FILTERS,
  type CategorySplit,
  type DashboardModel,
  type FyBar,
  type MonthPoint,
  type MetricSeries,
  type NpsFilters,
  type SamplePoint
} from "@/lib/nps-metrics";

import {
  clearWorkbooks,
  loadWorkbooks,
  saveWorkbooks
} from "@/lib/nps-storage";

import {
  ConnectedNpsUpload,
  type UploadError
} from "./connected-nps-upload";
import styles from "./connected-nps-dashboard.module.css";

// A replica of the "Connected NPS" report. Until workbooks are uploaded it
// renders the static demo figures it shipped with; once the Excel files are
// loaded every figure below is computed from them.

const RESPONSIBLE = "S Manickaraj (SM)";

const DEMO_MONTH_LABELS = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar"
];

const DEMO_CURRENT = [45.6, 42.9, 53.4, 54.0, 56.3, null, null, null, null, null, null, null];
const DEMO_PREVIOUS = [38.2, 41.5, 39.8, 43.6, 49.1, 45.3, 42.4, 46.0, 47.8, 50.6, 47.2, 43.9];

function toDemoMonths(values: Array<number | null>): MonthPoint[] {
  return values.map((value, index) => ({
    month: `demo-${index}`,
    label: DEMO_MONTH_LABELS[index],
    nps: value,
    total: 0
  }));
}

/** The figures the page shipped with, shaped like a parsed model. */
const DEMO_MODEL: DashboardModel = {
  hasData: false,
  fiscalYear: 2026,
  fiscalYearLabel: "26-27",
  fyBars: [
    { label: "23-24", nps: null },
    { label: "24-25", nps: null },
    { label: "25-26", nps: 40.6 }
  ],
  currentMonths: toDemoMonths(DEMO_CURRENT),
  previousMonths: toDemoMonths(DEMO_PREVIOUS),
  ytd: 50.4,
  currentMonthSample: 460,
  currentMonthLabel: "Aug-26",
  selectedMonthSample: 639,
  selectedMonthLabel: "Jun-26",
  sampleTrend: [
    { month: "d1", label: "Mar-26", respondents: 422, dialed: 846, closeCall: 846, respondentPct: 50, usage: null },
    { month: "d2", label: "Apr-26", respondents: 1145, dialed: 1582, closeCall: 1522, respondentPct: 75, usage: null },
    { month: "d3", label: "May-26", respondents: 1274, dialed: 1674, closeCall: 1674, respondentPct: 76, usage: null },
    { month: "d4", label: "Jun-26", respondents: 639, dialed: 993, closeCall: 993, respondentPct: 64, usage: null },
    { month: "d5", label: "Jul-26", respondents: 526, dialed: 841, closeCall: 841, respondentPct: 63, usage: null },
    { month: "d6", label: "Aug-26", respondents: 548, dialed: 730, closeCall: 699, respondentPct: 78, usage: null }
  ],
  planMonths: toDemoMonths([48, 49, 50, 51, 52, 53, 54, 55, 55, 56, 57, 58]),
  planAvailable: true,
  promoterPct: {
    fyBars: [
      { label: "23-24", nps: null },
      { label: "24-25", nps: null },
      { label: "25-26", nps: 59 }
    ],
    currentMonths: toDemoMonths([63, 60, 64, 66, 66, null, null, null, null, null, null, null]),
    previousMonths: toDemoMonths([57, 59, 58, 56, 57, 59, 60, 61, 60, 61, 62, 62]),
    ytd: 64
  },
  passivePct: {
    fyBars: [
      { label: "23-24", nps: null },
      { label: "24-25", nps: null },
      { label: "25-26", nps: 23 }
    ],
    currentMonths: toDemoMonths([21, 23, 25, 21, 24, null, null, null, null, null, null, null]),
    previousMonths: toDemoMonths([26, 25, 24, 25, 24, 25, 23, 22, 23, 22, 21, 21]),
    ytd: 23
  },
  detractorPct: {
    fyBars: [
      { label: "23-24", nps: null },
      { label: "24-25", nps: null },
      { label: "25-26", nps: 18 }
    ],
    currentMonths: toDemoMonths([17, 17, 11, 12, 10, null, null, null, null, null, null, null]),
    previousMonths: toDemoMonths([17, 16, 18, 19, 23, 20, 21, 19, 18, 17, 17, 16]),
    ytd: 13
  },
  categoryByMonth: {
    "2026-08": { promoters: 730, passives: 220, detractors: 50, total: 1000 }
  },
  osByMonth: { "2026-08": { android: 840, ios: 140, total: 980 } },
  categoryMonths: ["2026-08"],
  osMonths: ["2026-08"],
  weeks: [
    { label: "21-Jun", nps: 52.2, total: 0 },
    { label: "28-Jun", nps: 50.6, total: 0 },
    { label: "05-Jul", nps: 56.7, total: 0 },
    { label: "12-Jul", nps: 55.7, total: 0 },
    { label: "19-Jul", nps: 53.9, total: 0 },
    { label: "26-Jul", nps: 40.0, total: 0 },
    { label: "02-Aug", nps: 60.1, total: 0 },
    { label: "09-Aug", nps: 51.6, total: 0 }
  ],
  monthOptions: [],
  subcategoryOptions: [],
  variantOptions: [],
  dialedAvailable: true,
  usageAvailable: false,
  weeksFromDailyRows: true,
  warnings: []
};

/**
 * Builds a symmetric-ish axis in steps of 16 so the gridlines keep the look of
 * the source report while still fitting negative NPS values, which appear once
 * a single low-scoring variant is selected.
 */
function buildScale(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);
  const max = present.length > 0 ? Math.max(...present) : 0;
  const min = present.length > 0 ? Math.min(...present) : 0;

  const step = 16;
  const upper = Math.max(step, Math.ceil(max / step) * step);
  const lower = min < 0 ? Math.floor(min / step) * step : 0;

  const ticks: number[] = [];
  for (let tick = upper; tick >= lower; tick -= step) ticks.push(tick);

  return { upper, lower, ticks };
}

/** Actual figures below plan are called out in red rather than the series colour. */
const BELOW_PLAN_COLOR = "#d92d20";

type ComboChartProps = {
  series: MetricSeries;
  /** Line, point and YTD-bar colour for the current-year series. */
  color: string;
  /** Appended to every rendered value, e.g. "%" for the share charts. */
  suffix?: string;
  decimals?: number;
  /** Optional planned series, drawn as a blue reference line. */
  plan?: MonthPoint[];
  ariaLabel: string;
};

/**
 * The report's signature chart: preceding fiscal years as outline bars, this
 * year's line, last year's in grey, and a filled YTD bar. Shared by Connected
 * NPS, Promoter % and Passive %, which differ only in aggregate and colour.
 */
function ComboChart({
  series,
  color,
  suffix = "",
  decimals = 0,
  plan,
  ariaLabel
}: ComboChartProps) {
  const fmt = (value: number) => `${value.toFixed(decimals)}${suffix}`;
  const width = 760;
  const height = 300;
  const left = 46;
  const right = 20;
  const top = 26;
  const bottom = 46;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  const { upper, lower, ticks } = buildScale([
    ...series.fyBars.map((bar) => bar.nps),
    ...series.currentMonths.map((point) => point.nps),
    ...series.previousMonths.map((point) => point.nps),
    ...(plan ?? []).map((point) => point.nps),
    series.ytd
  ]);

  const categories = [
    ...series.fyBars.map((bar) => bar.label),
    ...series.currentMonths.map((point) => point.label),
    "YTD"
  ];
  const slot = plotWidth / categories.length;
  const getX = (index: number) => left + slot * index + slot / 2;
  const getY = (value: number) => {
    const clamped = Math.min(Math.max(value, lower), upper);
    return top + (1 - (clamped - lower) / (upper - lower)) * plotHeight;
  };
  const baselineY = getY(0);

  const monthlyStartIndex = series.fyBars.length;

  /** True when this month has a plan and the actual fell short of it. */
  const belowPlan = (index: number) => {
    const actual = series.currentMonths[index]?.nps;
    const planned = plan?.[index]?.nps;
    return (
      actual !== null &&
      actual !== undefined &&
      planned !== null &&
      planned !== undefined &&
      actual < planned
    );
  };

  /** Draws each unbroken run of points, so gaps in the data break the line. */
  const buildSegments = (points: MonthPoint[]) => {
    const segments: string[][] = [];
    let current: string[] = [];

    points.forEach((point, index) => {
      if (point.nps === null) {
        if (current.length > 1) segments.push(current);
        current = [];
        return;
      }
      current.push(`${getX(monthlyStartIndex + index)},${getY(point.nps)}`);
    });
    if (current.length > 1) segments.push(current);

    return segments.map((segment) => segment.join(" "));
  };

  const ytdIndex = categories.length - 1;

  return (
    <svg
      className={styles.chartSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {ticks.map((tick) => {
        const y = getY(tick);
        return (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y}
              y2={y}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
            <text x={left - 10} y={y + 4} fontSize={11} fill="#5a6b82" textAnchor="end">
              {`${tick}${suffix}`}
            </text>
          </g>
        );
      })}
      <line
        x1={left}
        x2={width - right}
        y1={baselineY}
        y2={baselineY}
        stroke="#334155"
        strokeWidth={1.4}
      />

      {series.fyBars.map((bar: FyBar, index) => {
        const x = getX(index);
        const barWidth = slot * 0.55;

        if (bar.nps === null) {
          return (
            <text
              key={bar.label}
              x={x}
              y={baselineY - 6}
              fontSize={11}
              fill="#94a3b8"
              textAnchor="middle"
            >
              NA
            </text>
          );
        }

        const valueY = getY(bar.nps);
        const barTop = Math.min(valueY, baselineY);
        const barHeight = Math.abs(baselineY - valueY);

        return (
          <g key={bar.label}>
            <rect
              x={x - barWidth / 2}
              y={barTop}
              width={barWidth}
              height={barHeight}
              fill="#ffffff"
              stroke="#334155"
              strokeWidth={1.2}
            />
            <text
              x={x}
              y={barTop - 8}
              fontSize={12}
              fontWeight={700}
              fill="#1f2937"
              textAnchor="middle"
            >
              {fmt(bar.nps)}
            </text>
          </g>
        );
      })}

      {buildSegments(series.previousMonths).map((points, index) => (
        <polyline
          key={`prev-${index}`}
          points={points}
          fill="none"
          stroke="#c3c9d4"
          strokeWidth={1.6}
        />
      ))}
      {plan
        ? buildSegments(plan).map((points, index) => (
            <polyline
              key={`plan-${index}`}
              points={points}
              fill="none"
              stroke="#1d4ed8"
              strokeWidth={1.6}
            />
          ))
        : null}

      {/* With a plan present the actual line is drawn segment by segment so a
          month that falls short of plan turns red; otherwise one polyline. */}
      {plan
        ? series.currentMonths.map((point, index) => {
            const next = series.currentMonths[index + 1];
            if (point.nps === null || !next || next.nps === null) return null;

            return (
              <line
                key={`curr-seg-${point.month}`}
                x1={getX(monthlyStartIndex + index)}
                y1={getY(point.nps)}
                x2={getX(monthlyStartIndex + index + 1)}
                y2={getY(next.nps)}
                stroke={belowPlan(index + 1) ? BELOW_PLAN_COLOR : color}
                strokeWidth={2.4}
              />
            );
          })
        : buildSegments(series.currentMonths).map((points, index) => (
            <polyline
              key={`curr-${index}`}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={2.4}
            />
          ))}

      {series.currentMonths.map((point, index) => {
        if (point.nps === null) return null;
        const x = getX(monthlyStartIndex + index);
        const y = getY(point.nps);
        const pointColor = belowPlan(index) ? BELOW_PLAN_COLOR : color;

        return (
          <g key={`point-${point.month}`}>
            <circle cx={x} cy={y} r={3.2} fill={pointColor} stroke="#ffffff" strokeWidth={1.4} />
            <text
              x={x}
              y={y - 10}
              fontSize={11}
              fontWeight={700}
              fill={pointColor}
              textAnchor="middle"
            >
              {fmt(point.nps)}
            </text>
          </g>
        );
      })}

      {series.ytd !== null ? (
        <>
          <rect
            x={getX(ytdIndex) - slot * 0.28}
            y={Math.min(getY(series.ytd), baselineY)}
            width={slot * 0.56}
            height={Math.abs(baselineY - getY(series.ytd))}
            fill={color}
          />
          <text
            x={getX(ytdIndex)}
            y={Math.min(getY(series.ytd), baselineY) - 8}
            fontSize={12}
            fontWeight={700}
            fill={color}
            textAnchor="middle"
          >
            {fmt(series.ytd)}
          </text>
        </>
      ) : null}

      {categories.map((label, index) => (
        <text
          key={`${label}-${index}`}
          x={getX(index)}
          y={height - bottom + 16}
          fontSize={10.5}
          fill="#5a6b82"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

function SampleTrendChart({ points }: { points: SamplePoint[] }) {
  const width = 560;
  const height = 280;
  const left = 40;
  const right = 12;
  const top = 44;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  if (points.length === 0) {
    return <p className={styles.emptyNote}>No sample data for this selection.</p>;
  }

  // With the NPS Dashboard Raw tab loaded the trend shows total customers
  // against those using the connected-features app, plus the share as a line;
  // otherwise it falls back to the response counts.
  const hasUsage = points.some(
    (point) => point.usage && point.usage.using + point.usage.notUsing > 0
  );

  // Only rows where the connected-features question was actually answered
  // count. Rows left as "-" or blank are unreached customers, not a "no".
  const totalOf = (point: SamplePoint) =>
    point.usage ? point.usage.using + point.usage.notUsing : 0;

  /** Share of answering customers who are using the app. */
  const pctOf = (point: SamplePoint) => {
    if (!point.usage) return null;
    const total = totalOf(point);
    return total > 0 ? (point.usage.using / total) * 100 : null;
  };

  const maxCount = Math.max(
    1,
    ...points.flatMap((point) =>
      hasUsage
        ? [totalOf(point), point.usage?.using ?? 0]
        : [point.dialed ?? 0, point.closeCall ?? 0, point.respondents]
    )
  );
  const slot = plotWidth / points.length;

  // Only render the series the workbooks actually carry, so the bars stay
  // honest when dialed / close-call counts are absent.
  const hasDialed = !hasUsage && points.some((point) => point.dialed !== null);
  const hasCloseCall =
    !hasUsage && points.some((point) => point.closeCall !== null);
  const seriesCount = hasUsage
    ? 2
    : 1 + (hasDialed ? 1 : 0) + (hasCloseCall ? 1 : 0);

  const barGroupWidth = slot * 0.68;
  const barWidth = barGroupWidth / seriesCount;

  const getBarHeight = (value: number) => (value / maxCount) * plotHeight;

  // Adoption sits near 10%, so a fixed 0-100 axis would flatten the line
  // against the baseline. Scale it to the data instead, rounded up to a step.
  const percentValues = points
    .map((point) => (hasUsage ? pctOf(point) : point.respondentPct))
    .filter((value): value is number => value !== null);
  const maxPercent = percentValues.length > 0 ? Math.max(...percentValues) : 100;
  // Extra headroom keeps the percent line below the tops of the tall Total
  // Customers bars, so its labels do not sit on top of the bar values.
  const percentBound = hasUsage
    ? Math.max(5, Math.ceil((maxPercent * 1.45) / 5) * 5)
    : 100;

  const getPctY = (pct: number) =>
    top + (1 - pct / percentBound) * plotHeight;

  const percentAt = (point: SamplePoint) =>
    hasUsage ? pctOf(point) : point.respondentPct;

  const pctSegments: string[] = [];
  let run: string[] = [];
  points.forEach((point, index) => {
    const value = percentAt(point);
    if (value === null) {
      if (run.length > 1) pctSegments.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${left + slot * index + slot / 2},${getPctY(value)}`);
  });
  if (run.length > 1) pctSegments.push(run.join(" "));

  return (
    <svg
      className={styles.chartSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Sample trend for the last six months"
    >
      <line
        x1={left}
        x2={width - right}
        y1={height - bottom}
        y2={height - bottom}
        stroke="#334155"
        strokeWidth={1.2}
      />

      {points.map((point, index) => {
        const groupX = left + slot * index + (slot - barGroupWidth) / 2;
        const bars: Array<{ value: number; color: string }> = [];

        if (hasUsage) {
          // A month the Raw tab does not cover - or one where nobody answered
          // the question - has no bars at all. Drawing zeroes would read as
          // "nobody uses the features" rather than "no data for this month".
          if (!point.usage || totalOf(point) === 0) {
            return (
              <g key={point.month}>
                <text
                  x={left + slot * index + slot / 2}
                  y={height - bottom - 6}
                  fontSize={9}
                  fill="#cbd5e1"
                  textAnchor="middle"
                >
                  no data
                </text>
                <text
                  x={left + slot * index + slot / 2}
                  y={height - bottom + 16}
                  fontSize={10.5}
                  fill="#5a6b82"
                  textAnchor="middle"
                >
                  {point.label}
                </text>
              </g>
            );
          }

          bars.push(
            { value: totalOf(point), color: "#4f8ef0" },
            { value: point.usage.using, color: "#1f9d55" }
          );
        } else {
          if (hasDialed) bars.push({ value: point.dialed ?? 0, color: "#4f8ef0" });
          if (hasCloseCall)
            bars.push({ value: point.closeCall ?? 0, color: "#9a6fd1" });
          bars.push({ value: point.respondents, color: "#f5a25d" });
        }

        return (
          <g key={point.month}>
            {bars.map((bar, barIndex) => {
              const barHeight = getBarHeight(bar.value);
              const x = groupX + barIndex * barWidth;

              return (
                <g key={bar.color}>
                  <rect
                    x={x}
                    y={height - bottom - barHeight}
                    width={Math.max(2, barWidth - 3)}
                    height={barHeight}
                    fill={bar.color}
                  />
                  <text
                    x={x + Math.max(2, barWidth - 3) / 2}
                    y={height - bottom - barHeight - 4}
                    fontSize={9}
                    fill="#334155"
                    textAnchor="middle"
                  >
                    {bar.value.toLocaleString()}
                  </text>
                </g>
              );
            })}
            <text
              x={left + slot * index + slot / 2}
              y={height - bottom + 16}
              fontSize={10.5}
              fill="#5a6b82"
              textAnchor="middle"
            >
              {point.label}
            </text>
          </g>
        );
      })}

      {pctSegments.map((segment, index) => (
        <polyline
          key={`pct-line-${index}`}
          points={segment}
          fill="none"
          stroke="#f2b705"
          strokeWidth={2.2}
        />
      ))}
      {points.map((point, index) => {
        const value = percentAt(point);
        if (value === null) return null;
        const x = left + slot * index + slot / 2;
        const y = getPctY(value);
        // Adoption percentages need a decimal to be distinguishable.
        const label = hasUsage ? value.toFixed(1) : String(Math.round(value));

        return (
          <g key={`pct-${point.month}`}>
            <circle cx={x} cy={y} r={3} fill="#f2b705" stroke="#ffffff" strokeWidth={1} />
            <rect x={x - 17} y={y - 20} width={34} height={14} rx={3} fill="#f2b705" opacity={0.9} />
            <text x={x} y={y - 10} fontSize={9.5} fontWeight={700} fill="#3a2c00" textAnchor="middle">
              {label}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type Slice = { label: string; value: number; color: string };

/**
 * Pie with leader lines, as on the source report. Slices are drawn from 12
 * o'clock clockwise; a slice small enough to be unreadable still gets its
 * label, pushed out on the leader line.
 */
function PieChart({ slices, ariaLabel }: { slices: Slice[]; ariaLabel: string }) {
  const width = 420;
  const height = 235;
  const cx = width / 2;
  const cy = height / 2 + 5;
  const radius = 76;

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const present = slices.filter((slice) => slice.value > 0);

  if (total <= 0 || present.length === 0) {
    return <p className={styles.emptyNote}>No data for this selection.</p>;
  }

  const pointAt = (fraction: number, distance: number) => {
    const angle = fraction * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance];
  };

  let cursor = 0;

  return (
    <svg
      className={styles.pieSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {present.map((slice) => {
        const fraction = slice.value / total;
        const start = cursor;
        const end = cursor + fraction;
        cursor = end;

        const [sx, sy] = pointAt(start, radius);
        const [ex, ey] = pointAt(end, radius);
        const largeArc = fraction > 0.5 ? 1 : 0;

        // A single slice covering everything cannot be drawn as an arc.
        const path =
          present.length === 1
            ? `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius} Z`
            : `M ${cx} ${cy} L ${sx} ${sy} A ${radius} ${radius} 0 ${largeArc} 1 ${ex} ${ey} Z`;

        const mid = (start + end) / 2;
        const [lx, ly] = pointAt(mid, radius + 12);
        const [tx, ty] = pointAt(mid, radius + 30);
        const anchorRight = tx >= cx;

        return (
          <g key={slice.label}>
            <path d={path} fill={slice.color} stroke="#ffffff" strokeWidth={1} />
            <polyline
              points={`${lx},${ly} ${tx},${ty} ${tx + (anchorRight ? 10 : -10)},${ty}`}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1}
            />
            <text
              x={tx + (anchorRight ? 14 : -14)}
              y={ty + 4}
              fontSize={12}
              fill="#1f2937"
              textAnchor={anchorRight ? "start" : "end"}
            >
              {`${slice.label} ${Math.round(fraction * 100)}%`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 100% stacked bars of promoter / passive / detractor share, one per month.
 * Bar width is fixed to a twelve-month grid and the group is centred, so a
 * partial year reads as a short run of normal bars rather than stretched ones.
 */
function StackedTrendChart({
  months,
  byMonth
}: {
  months: string[];
  byMonth: Record<string, CategorySplit>;
}) {
  const width = 1180;
  const height = 300;
  const left = 52;
  const right = 16;
  const top = 22;
  const bottom = 52;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  if (months.length === 0) {
    return <p className={styles.emptyNote}>No data for this selection.</p>;
  }

  const MAX_BARS = 12;
  const slot = plotWidth / MAX_BARS;
  const barWidth = Math.min(slot * 0.5, 56);
  const groupWidth = slot * months.length;
  const startX = left + (plotWidth - groupWidth) / 2;

  const ticks = [0, 50, 100];
  const getY = (percent: number) => top + (1 - percent / 100) * plotHeight;

  const bands = [
    { key: "promoters" as const, color: "#1f9d55", text: "#ffffff" },
    { key: "passives" as const, color: "#f2b705", text: "#3a2c00" },
    { key: "detractors" as const, color: "#e02b20", text: "#ffffff" }
  ];

  return (
    <svg
      className={styles.chartSvg}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Promoter, passive and detractor trend"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={left}
            x2={width - right}
            y1={getY(tick)}
            y2={getY(tick)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text
            x={left - 10}
            y={getY(tick) + 4}
            fontSize={12}
            fill="#5a6b82"
            textAnchor="end"
          >
            {`${tick}%`}
          </text>
        </g>
      ))}

      {months.map((month, index) => {
        const split = byMonth[month];
        const x = startX + slot * index + (slot - barWidth) / 2;
        const centre = x + barWidth / 2;
        if (!split || split.total <= 0) return null;

        // Each share is rounded on its own, as on the source report, so the
        // three labels may total 99 or 101 while the bar itself stays exact.
        let cursor = 0;

        return (
          <g key={month}>
            {bands.map((band) => {
              const share = (split[band.key] / split.total) * 100;
              const y = getY(cursor + share);
              const barHeight = (share / 100) * plotHeight;
              cursor += share;

              return (
                <g key={band.key}>
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={band.color}
                  />
                  {/* Below ~7% the segment is too thin to hold its label. */}
                  {share >= 7 ? (
                    <text
                      x={centre}
                      y={y + barHeight / 2 + 4}
                      fontSize={12}
                      fontWeight={700}
                      fill={band.text}
                      textAnchor="middle"
                    >
                      {`${Math.round(share)}%`}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <text
              x={centre}
              y={height - bottom + 20}
              fontSize={12}
              fill="#5a6b82"
              textAnchor="middle"
            >
              {formatMonthKey(month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type PieCardProps = {
  title: string;
  ariaLabel: string;
  /** Months this pie has data for, oldest first. */
  months: string[];
  /** Slices for one month; an empty array renders the "no data" note. */
  slicesFor: (month: string) => Slice[];
  emptyNote?: string;
};

/**
 * A stratification pie with its own month selector, so each pie can be read
 * month by month independently of the page-wide Month filter.
 */
function PieCard({
  title,
  ariaLabel,
  months,
  slicesFor,
  emptyNote
}: PieCardProps) {
  const latest = months[months.length - 1] ?? "";
  const [selected, setSelected] = useState(latest);

  // Filters change which months exist, so fall back to the latest available
  // rather than holding a month this selection no longer has.
  const month = months.includes(selected) ? selected : latest;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <strong>{title}</strong>
        </div>
        <div className={styles.cardHeadRight}>
          {months.length > 0 ? (
            <select
              className={styles.monthSelect}
              value={month}
              onChange={(event) => setSelected(event.target.value)}
              aria-label={`${title} month`}
            >
              {[...months].reverse().map((option) => (
                <option key={option} value={option}>
                  {formatMonthKey(option)}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
      <div className={styles.chartBody}>
        {month ? (
          <PieChart ariaLabel={ariaLabel} slices={slicesFor(month)} />
        ) : (
          <p className={styles.emptyNote}>{emptyNote ?? "No data available."}</p>
        )}
      </div>
    </section>
  );
}

type ShareCardProps = {
  uom: string;
  title: string;
  series: MetricSeries;
  color: string;
  /** Status dot colour: promoters rising is good, passives rising is not. */
  tone: "good" | "bad";
  /** Which way is the desirable direction for this measure. */
  direction: "up" | "down";
  fiscalYearLabel: string;
};

/** Promoter % / Passive % card - the NPS chart over a different aggregate. */
function ShareCard({
  uom,
  title,
  series,
  color,
  tone,
  direction,
  fiscalYearLabel
}: ShareCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardHeadLeft}>
          <small>{uom}</small>
          <strong>
            <span className={styles.directionArrow} aria-hidden="true">
              {direction === "up" ? "↑" : "↓"}
            </span>
            {title}
          </strong>
        </div>
        <div className={styles.cardHeadRight}>
          <span
            className={`${styles.statusDot} ${
              tone === "good" ? styles.good : styles.bad
            }`}
          />
        </div>
      </div>
      <div className={styles.yearTabs}>
        {series.fyBars.map((bar) => (
          <span key={bar.label}>{`20${bar.label.slice(0, 2)}`}</span>
        ))}
        <span className={styles.yearActive}>
          {`20${fiscalYearLabel.slice(0, 2)}`}
        </span>
      </div>
      <div className={styles.chartBody}>
        <ComboChart
          series={series}
          color={color}
          suffix="%"
          decimals={0}
          ariaLabel={`${title} trend chart`}
        />
      </div>
    </section>
  );
}

type FilterSelectProps = {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
};

function FilterSelect({
  label,
  value,
  options,
  onChange,
  disabled
}: FilterSelectProps) {
  return (
    <div className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.filterValue}>
        <select
          className={styles.filterSelect}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

type DashboardProps = {
  /**
   * Restricts the whole page to one fuel type. When set, the Category filter
   * is fixed and any workbook for the other fuel is ignored, so an ICE page
   * cannot silently blend EV numbers into its totals.
   */
  fuel?: FuelType;
  title?: string;
};

export function ConnectedNpsDashboard({ fuel, title }: DashboardProps = {}) {
  const initialFilters: NpsFilters = fuel
    ? { ...DEFAULT_FILTERS, fuel }
    : DEFAULT_FILTERS;

  const [workbooks, setWorkbooks] = useState<ParsedWorkbook[]>([]);
  const [errors, setErrors] = useState<UploadError[]>([]);
  const [filters, setFilters] = useState<NpsFilters>(initialFilters);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Restore after mount rather than during render: localStorage is unavailable
  // on the server, and reading it in render would break hydration.
  useEffect(() => {
    const restored = loadWorkbooks();
    if (restored.workbooks.length > 0) {
      setWorkbooks(restored.workbooks);
      setSavedAt(restored.savedAt);
    }
    if (restored.notice) setStorageNotice(restored.notice);
  }, []);

  // A fuel-scoped page only ever sees its own workbooks.
  const scopedWorkbooks = useMemo(
    () =>
      fuel ? workbooks.filter((workbook) => workbook.fuel === fuel) : workbooks,
    [workbooks, fuel]
  );

  const liveModel = useMemo(
    () => buildDashboardModel(scopedWorkbooks, filters),
    [scopedWorkbooks, filters]
  );

  // Once workbooks are loaded the live model always wins, even when a filter
  // combination matches nothing - falling back to the demo figures there would
  // silently present invented numbers as real ones.
  const isLive = scopedWorkbooks.length > 0;
  const model = isLive ? liveModel : DEMO_MODEL;

  const setFilter = <K extends keyof NpsFilters>(key: K, value: NpsFilters[K]) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  const allOption = { value: "All", label: "All" };

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <h1 className={styles.pageTitle}>{title ?? "Connected NPS"}</h1>
        </header>
        <div className={styles.accentBar} />

        <ConnectedNpsUpload
          workbooks={scopedWorkbooks}
          otherFuelCount={workbooks.length - scopedWorkbooks.length}
          fuel={fuel}
          errors={errors}
          savedAt={savedAt}
          storageNotice={storageNotice}
          onLoaded={(parsed, failures) => {
            // Re-uploading a file replaces the previous copy of it.
            setWorkbooks((previous) => {
              const merged = new Map(
                previous.map((workbook) => [workbook.fileName, workbook])
              );
              parsed.forEach((workbook) =>
                merged.set(workbook.fileName, workbook)
              );
              const next = [...merged.values()];

              const failure = saveWorkbooks(next);
              setStorageNotice(failure);
              setSavedAt(failure ? null : new Date().toISOString());
              return next;
            });
            setErrors(failures);
          }}
          onClear={() => {
            // On a fuel-scoped page, Clear drops only that fuel's workbooks -
            // wiping the other page's uploads from here would be a surprise.
            setWorkbooks((previous) => {
              const next = fuel
                ? previous.filter((workbook) => workbook.fuel !== fuel)
                : [];

              if (next.length === 0) {
                clearWorkbooks();
                setSavedAt(null);
              } else {
                const failure = saveWorkbooks(next);
                setStorageNotice(failure);
                setSavedAt(failure ? null : new Date().toISOString());
              }
              return next;
            });
            setErrors([]);
            setFilters(initialFilters);
            setStorageNotice(null);
          }}
        />

        <div className={styles.filters}>
          <FilterSelect
            label="Month"
            value={filters.month ?? "All"}
            disabled={!isLive}
            options={[
              { value: "All", label: isLive ? "Latest" : "01-06-2026" },
              ...model.monthOptions.map((month) => ({
                value: month,
                label: formatMonthKey(month)
              }))
            ]}
            onChange={(value) => setFilter("month", value === "All" ? null : value)}
          />
          <FilterSelect
            label="Category"
            value={fuel ?? filters.fuel}
            disabled={!!fuel || !isLive}
            options={
              fuel
                ? [{ value: fuel, label: fuel }]
                : [
                    allOption,
                    { value: "EV", label: "EV" },
                    { value: "ICE", label: "ICE" }
                  ]
            }
            onChange={(value) =>
              setFilter("fuel", value as NpsFilters["fuel"])
            }
          />
          <FilterSelect
            label="Model"
            value={filters.subcategory}
            disabled={!isLive || model.subcategoryOptions.length === 0}
            options={[
              allOption,
              ...model.subcategoryOptions.map((option) => ({
                value: option,
                label: option
              }))
            ]}
            onChange={(value) =>
              // Models belong to the ICE workbooks, so picking one implies ICE
              // and clears any EV variant selection.
              setFilters((previous) => ({
                ...previous,
                subcategory: value,
                variant: "All",
                fuel: fuel ?? (value === "All" ? previous.fuel : "ICE")
              }))
            }
          />
          <FilterSelect
            label="Variant"
            value={filters.variant}
            disabled={!isLive || model.variantOptions.length === 0}
            options={[
              allOption,
              ...model.variantOptions.map((option) => ({
                value: option,
                label: option
              }))
            ]}
            onChange={(value) =>
              setFilters((previous) => ({
                ...previous,
                variant: value,
                subcategory: "All",
                fuel: fuel ?? (value === "All" ? previous.fuel : "EV")
              }))
            }
          />
        </div>

        <main className={styles.content}>
          <div className={styles.sectionBanner}>
            {filters.fuel === "All" ? "EV + ICE" : filters.fuel} Performance
            {isLive
              ? ""
              : ` — demo data, upload the ${fuel ?? ""} workbooks to go live`}
          </div>

          {isLive && !model.hasData ? (
            <p className={styles.emptyNote}>
              No rows match this filter combination. Reset Category,
              Subcategory or Variant to widen the selection.
            </p>
          ) : null}

          <div className={styles.topGrid}>
            <div className={styles.leftStack}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardHeadLeft}>
                    <small>UOM : Net Promoter Score</small>
                    <strong>Connected NPS</strong>
                  </div>
                  <div className={styles.cardHeadRight}>
                    <span>
                      Current Month Sample :{" "}
                      {model.currentMonthSample.toLocaleString()}
                      {model.currentMonthLabel
                        ? ` (${model.currentMonthLabel})`
                        : ""}
                    </span>
                    <span className={`${styles.statusDot} ${styles.good}`} />
                  </div>
                </div>
                <div className={styles.yearTabs}>
                  {model.fyBars.map((bar) => (
                    <span key={bar.label}>{`20${bar.label.slice(0, 2)}`}</span>
                  ))}
                  <span className={styles.yearActive}>
                    {`20${model.fiscalYearLabel.slice(0, 2)}`}
                  </span>
                </div>
                <div className={styles.chartBody}>
                  <ComboChart
                    series={{
                      fyBars: model.fyBars,
                      currentMonths: model.currentMonths,
                      previousMonths: model.previousMonths,
                      ytd: model.ytd
                    }}
                    color="#1f9d55"
                    decimals={0}
                    plan={model.planAvailable ? model.planMonths : undefined}
                    ariaLabel="Connected NPS trend chart"
                  />
                </div>
                {model.planAvailable ? (
                  <div className={styles.legendRow}>
                    <span className={styles.legendActual}>Actual</span>
                    <span className={styles.legendPlan}>Plan</span>
                  </div>
                ) : null}
                <div className={styles.respLine}>
                  RESP(Responsible) : <strong>{RESPONSIBLE}</strong>
                </div>
              </section>

            </div>

            <div className={styles.rightStack}>
              <section className={styles.card}>
                <div className={styles.cardHead}>
                  <div className={styles.cardHeadLeft}>
                    <strong>Sample Trend (Last 6 Months)</strong>
                  </div>
                </div>
                <div className={styles.legendRow}>
                  {model.usageAvailable ? (
                    <>
                      <span className={styles.legendDialed}>Total Customers</span>
                      <span className={styles.legendUsing}>
                        Customers using Connected Features app
                      </span>
                      <span className={styles.legendPct}>Percent</span>
                    </>
                  ) : (
                    <>
                      {model.sampleTrend.some((point) => point.dialed !== null) ? (
                        <span className={styles.legendDialed}>Total Dialed</span>
                      ) : null}
                      {model.sampleTrend.some(
                        (point) => point.closeCall !== null
                      ) ? (
                        <span className={styles.legendClose}>
                          Total Close Call
                        </span>
                      ) : null}
                      <span className={styles.legendResp}>
                        Number of Respondents
                      </span>
                      {model.sampleTrend.some(
                        (point) => point.respondentPct !== null
                      ) ? (
                        <span className={styles.legendPct}>Respondent%</span>
                      ) : null}
                    </>
                  )}
                </div>
                <div className={styles.chartBody}>
                  <SampleTrendChart points={model.sampleTrend} />
                </div>
                {isLive && !model.dialedAvailable ? (
                  <p className={styles.emptyNote}>
                    Dialed and close-call counts are not present in these
                    workbooks, so only respondents are charted.
                  </p>
                ) : null}
              </section>

            </div>
          </div>

          <div className={styles.weeksBand}>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.cardHeadLeft}>
                  <strong>Last 8 Weeks Actual</strong>
                </div>
              </div>
              {model.weeks.length === 0 ? (
                <p className={styles.emptyNote}>
                  No week-level rows for this selection. The workbook&apos;s
                  Input sheet needs both a Date and an NPS Status column.
                </p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Start of Week</th>
                        {model.weeks.map((week) => (
                          <th key={week.label}>{week.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Actual</td>
                        {model.weeks.map((week) => (
                          <td key={`actual-${week.label}`}>
                            {week.nps === null ? "—" : Math.round(week.nps)}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td>Target</td>
                        {model.weeks.map((week) => (
                          <td key={`target-${week.label}`}>0</td>
                        ))}
                      </tr>
                      <tr>
                        <td>Responses</td>
                        {model.weeks.map((week) => (
                          <td key={`n-${week.label}`}>
                            {week.total > 0 ? week.total.toLocaleString() : "—"}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className={styles.shareGrid}>
            <ShareCard
              uom="UOM : % of Customers (Rating: 9-10)"
              title="Promoter %"
              series={model.promoterPct}
              color="#1f9d55"
              tone="good"
              direction="up"
              fiscalYearLabel={model.fiscalYearLabel}
            />
            <ShareCard
              uom="UOM : % of Customers (Rating: 7-8)"
              title="Passive %"
              series={model.passivePct}
              color="#d92d20"
              tone="bad"
              direction="down"
              fiscalYearLabel={model.fiscalYearLabel}
            />
          </div>

          <div className={styles.centerBand}>
            <ShareCard
              uom="UOM : % of Customers (Rating: 0-6)"
              title="Detractor %"
              series={model.detractorPct}
              color="#d92d20"
              tone="bad"
              direction="down"
              fiscalYearLabel={model.fiscalYearLabel}
            />
          </div>

          <div className={styles.shareGrid}>
            <PieCard
              title="Stratification Of Customers Category"
              ariaLabel="Stratification of customers by category"
              months={model.categoryMonths}
              slicesFor={(month) => {
                const split = model.categoryByMonth[month];
                if (!split) return [];
                return [
                  { label: "Promoter", value: split.promoters, color: "#1f9d55" },
                  { label: "Passive", value: split.passives, color: "#f2b705" },
                  { label: "Detractor", value: split.detractors, color: "#d92d20" }
                ];
              }}
            />

            <PieCard
              title="Stratification Of Customers Mobile OS Type"
              ariaLabel="Stratification of customers by mobile OS"
              months={model.osMonths}
              slicesFor={(month) => {
                const split = model.osByMonth[month];
                if (!split) return [];
                return [
                  { label: "Android", value: split.android, color: "#a78bfa" },
                  { label: "IOS", value: split.ios, color: "#e0c341" }
                ];
              }}
              emptyNote="These workbooks carry no Android/iOS column, so the platform mix is unavailable."
            />
          </div>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardHeadLeft}>
                <strong>
                  Promoter, Passive &amp; Detractor - Trend (Last 12 Months)
                </strong>
              </div>
            </div>
            <div className={styles.chartBody}>
              <StackedTrendChart
                months={model.categoryMonths.slice(-12)}
                byMonth={model.categoryByMonth}
              />
            </div>
            <div className={styles.legendRow}>
              <span className={styles.legendActual}>Promoter%</span>
              <span className={styles.legendPassive}>Passive%</span>
              <span className={styles.legendDetractor}>Detractor%</span>
            </div>
          </section>

          {model.warnings.length > 0 ? (
            <ul className={styles.warningList}>
              {model.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </main>
      </div>
    </div>
  );
}
