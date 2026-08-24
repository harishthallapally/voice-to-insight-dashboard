import {
  formatFiscalYear,
  formatMonthKey,
  type DailyRow,
  type FuelType,
  type NpsRecord,
  type ParsedWorkbook
} from "@/lib/nps-excel";

// Turns the parsed workbooks into the exact figures the Connected NPS report
// puts on screen. Every number here is derived from the workbook counts -
// NPS is always recomputed as (promoters - detractors) / total, never read
// from a pre-calculated cell, so filtered views stay consistent.

export type NpsFilters = {
  /** Selected month key ("YYYY-MM"), or null for the latest available. */
  month: string | null;
  fuel: FuelType | "All";
  /** ICE model, or "All". */
  subcategory: string;
  /** EV variant, or "All". */
  variant: string;
};

export type MonthPoint = {
  month: string;
  label: string;
  nps: number | null;
  total: number;
};

export type FyBar = { label: string; nps: number | null };

export type SamplePoint = {
  month: string;
  label: string;
  respondents: number;
  dialed: number | null;
  closeCall: number | null;
  respondentPct: number | null;
  /** Connected-feature adoption from the Raw tab; null when not uploaded. */
  usage: { using: number; notUsing: number; noResponse: number } | null;
};

export type WeekPoint = { label: string; nps: number | null; total: number };

export type DashboardModel = {
  hasData: boolean;
  fiscalYear: number;
  fiscalYearLabel: string;
  fyBars: FyBar[];
  currentMonths: MonthPoint[];
  previousMonths: MonthPoint[];
  ytd: number | null;
  currentMonthSample: number;
  currentMonthLabel: string;
  selectedMonthSample: number;
  selectedMonthLabel: string;
  sampleTrend: SamplePoint[];
  weeks: WeekPoint[];
  monthOptions: string[];
  subcategoryOptions: string[];
  variantOptions: string[];
  dialedAvailable: boolean;
  usageAvailable: boolean;
  weeksFromDailyRows: boolean;
  warnings: string[];
};

export const DEFAULT_FILTERS: NpsFilters = {
  month: null,
  fuel: "All",
  subcategory: "All",
  variant: "All"
};

/** Fiscal calendar order: April through March. */
const FISCAL_MONTH_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2];

/**
 * The same model is spelled differently across sheets - "JUPITER" vs "Jupiter",
 * and the Raw tab's "RR310 & RTR310" vs the Summary's "RR&RTR310" - so entities
 * are compared on a stripped form, with an alias for the pairs that still differ.
 */
const ENTITY_ALIASES: Record<string, string> = {
  rr310rtr310: "rrrtr310"
};

function normalizeEntity(value: string) {
  const stripped = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return ENTITY_ALIASES[stripped] ?? stripped;
}

export function npsOf(rows: { promoters: number; detractors: number; total: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  if (total <= 0) return null;
  const promoters = rows.reduce((sum, row) => sum + row.promoters, 0);
  const detractors = rows.reduce((sum, row) => sum + row.detractors, 0);
  return ((promoters - detractors) / total) * 100;
}

function monthKeyFor(fiscalYear: number, monthIndex: number) {
  const year = monthIndex >= 3 ? fiscalYear : fiscalYear + 1;
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/**
 * Applies the report's filter bar. Subcategory selects an ICE model and
 * variant selects an EV variant, mirroring how the two workbook families key
 * their Summary sheets, so picking either one implies its fuel type.
 */
function matchesFilters(
  row: { fuel: FuelType; entity: string },
  filters: NpsFilters
) {
  if (filters.fuel !== "All" && row.fuel !== filters.fuel) return false;

  const sameEntity = (value: string) =>
    normalizeEntity(row.entity) === normalizeEntity(value);

  if (filters.subcategory !== "All") {
    if (row.fuel !== "ICE" || !sameEntity(filters.subcategory)) return false;
  }
  if (filters.variant !== "All") {
    if (row.fuel !== "EV" || !sameEntity(filters.variant)) return false;
  }
  return true;
}

function buildMonthSeries(records: NpsRecord[], fiscalYear: number): MonthPoint[] {
  return FISCAL_MONTH_ORDER.map((monthIndex) => {
    const key = monthKeyFor(fiscalYear, monthIndex);
    const rows = records.filter((record) => record.month === key);
    return {
      month: key,
      label: formatMonthKey(key).split("-")[0],
      nps: npsOf(rows),
      total: rows.reduce((sum, row) => sum + row.total, 0)
    };
  });
}

function startOfWeek(date: Date) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay()); // weeks start Sunday
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function formatWeekLabel(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${day}-${month}`;
}

/**
 * Buckets the row-level responses into the eight weeks ending on the most
 * recent week that has data, matching the "Last 8 Weeks Actual" table.
 */
function buildWeeks(rows: DailyRow[]): WeekPoint[] {
  if (rows.length === 0) return [];

  const buckets = new Map<number, { promoters: number; detractors: number; total: number }>();
  rows.forEach((row) => {
    const date = new Date(`${row.date}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return;

    const key = startOfWeek(date).getTime();
    const bucket = buckets.get(key) ?? { promoters: 0, detractors: 0, total: 0 };
    if (row.status === "promoter") bucket.promoters += row.count;
    if (row.status === "detractor") bucket.detractors += row.count;
    bucket.total += row.count;
    buckets.set(key, bucket);
  });

  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0]).slice(-8);
  return ordered.map(([time, bucket]) => ({
    label: formatWeekLabel(new Date(time)),
    nps:
      bucket.total > 0
        ? ((bucket.promoters - bucket.detractors) / bucket.total) * 100
        : null,
    total: bucket.total
  }));
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * Collapses the different spellings of one model into a single option. The
 * Summary sheets use title case ("Jupiter") and the Raw tabs upper case
 * ("JUPITER"), so listing both would offer two entries that filter identically.
 * Summary spelling wins because it is what the report itself displays.
 */
function uniqueEntities(
  preferred: Array<{ entity: string }>,
  fallback: Array<{ entity: string }>
) {
  const byKey = new Map<string, string>();

  fallback.forEach((row) => {
    const key = normalizeEntity(row.entity);
    if (key && !byKey.has(key)) byKey.set(key, row.entity.trim());
  });
  preferred.forEach((row) => {
    const key = normalizeEntity(row.entity);
    if (key) byKey.set(key, row.entity.trim());
  });

  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export function buildDashboardModel(
  workbooks: ParsedWorkbook[],
  filters: NpsFilters = DEFAULT_FILTERS
): DashboardModel {
  const allRecords = workbooks.flatMap((workbook) => workbook.records);
  const allDaily = workbooks.flatMap((workbook) => workbook.dailyRows);
  const warnings = workbooks.flatMap((workbook) =>
    workbook.warnings.map((warning) => `${workbook.fileName}: ${warning}`)
  );

  const empty: DashboardModel = {
    hasData: false,
    fiscalYear: 0,
    fiscalYearLabel: "",
    fyBars: [],
    currentMonths: [],
    previousMonths: [],
    ytd: null,
    currentMonthSample: 0,
    currentMonthLabel: "",
    selectedMonthSample: 0,
    selectedMonthLabel: "",
    sampleTrend: [],
    weeks: [],
    monthOptions: [],
    subcategoryOptions: [],
    variantOptions: [],
    dialedAvailable: false,
    usageAvailable: false,
    weeksFromDailyRows: false,
    warnings
  };

  const allUsage = workbooks.flatMap((workbook) => workbook.usage);
  if (allRecords.length === 0 && allUsage.length === 0) return empty;

  // Filter options come from the full data set so they never disappear as the
  // user narrows the view. The Raw tab contributes models too, so its workbook
  // is usable on its own.
  const subcategoryOptions = uniqueEntities(
    allRecords.filter((row) => row.fuel === "ICE"),
    allUsage.filter((row) => row.fuel === "ICE")
  );
  const variantOptions = uniqueEntities(
    allRecords.filter((row) => row.fuel === "EV"),
    allUsage.filter((row) => row.fuel === "EV")
  );

  const records = allRecords.filter((row) => matchesFilters(row, filters));
  const daily = allDaily.filter((row) => matchesFilters(row, filters));
  const usage = workbooks
    .flatMap((workbook) => workbook.usage)
    .filter((row) => matchesFilters(row, filters));

  const monthOptions = uniqueSorted(records.map((row) => row.month)).sort();
  if (records.length === 0 && usage.length === 0) {
    return { ...empty, subcategoryOptions, variantOptions, warnings };
  }

  const usageFiscalYears = usage.map((row) => {
    const [year, month] = row.month.split("-").map(Number);
    return month - 1 >= 3 ? year : year - 1;
  });
  const fiscalYear = Math.max(
    ...records.map((row) => row.fiscalYear),
    ...usageFiscalYears
  );
  const currentMonths = buildMonthSeries(records, fiscalYear);
  const previousMonths = buildMonthSeries(records, fiscalYear - 1);

  // The three bars to the left of the trend line are the fiscal years that
  // precede the current one; a year with no data renders as "NA".
  const fyBars: FyBar[] = [3, 2, 1].map((offset) => {
    const year = fiscalYear - offset;
    const rows = records.filter((row) => row.fiscalYear === year);
    return { label: formatFiscalYear(year), nps: npsOf(rows) };
  });

  const currentFyRows = records.filter((row) => row.fiscalYear === fiscalYear);
  const ytd = npsOf(currentFyRows);

  // Months come from the Summary records plus any month the Raw tab covers, so
  // an adoption-only month still appears on the trend.
  const monthsWithData = uniqueSorted([
    ...monthOptions.filter((month) =>
      records.some((row) => row.month === month && row.total > 0)
    ),
    ...usage.map((row) => row.month)
  ]).sort();
  const latestMonth = monthsWithData[monthsWithData.length - 1] ?? "";
  const selectedMonth =
    filters.month && monthsWithData.includes(filters.month)
      ? filters.month
      : latestMonth;

  const totalFor = (month: string) =>
    records
      .filter((row) => row.month === month)
      .reduce((sum, row) => sum + row.total, 0);

  // Sample Trend shows the six months up to and including the selected one.
  // Once adoption data is present the trend is about adoption, so months with
  // no answered Yes/No rows are left out rather than drawn as empty slots.
  const adoptionMonths = new Set(
    usage
      .filter((row) => row.using + row.notUsing > 0)
      .map((row) => row.month)
  );
  const trendCandidates =
    adoptionMonths.size > 0
      ? monthsWithData.filter((month) => adoptionMonths.has(month))
      : monthsWithData;

  const upToSelected = trendCandidates.filter(
    (month) => month <= selectedMonth
  );
  const selectedIndex =
    (upToSelected.length > 0 ? upToSelected : trendCandidates).length - 1;
  const trendMonths = (
    upToSelected.length > 0 ? upToSelected : trendCandidates
  ).slice(
    Math.max(0, selectedIndex - 5),
    selectedIndex + 1
  );

  const callVolume = workbooks.reduce<Record<string, { dialed?: number; closeCall?: number }>>(
    (acc, workbook) => {
      Object.entries(workbook.callVolume).forEach(([month, value]) => {
        const bucket = acc[month] ?? {};
        if (value.dialed) bucket.dialed = (bucket.dialed ?? 0) + value.dialed;
        if (value.closeCall)
          bucket.closeCall = (bucket.closeCall ?? 0) + value.closeCall;
        acc[month] = bucket;
      });
      return acc;
    },
    {}
  );

  const sampleTrend: SamplePoint[] = trendMonths.map((month) => {
    const respondents = totalFor(month);
    const dialed = callVolume[month]?.dialed ?? null;
    const closeCall = callVolume[month]?.closeCall ?? null;
    const denominator = closeCall ?? dialed;

    const usageRows = usage.filter((row) => row.month === month);
    const usageTotals = usageRows.reduce(
      (acc, row) => ({
        using: acc.using + row.using,
        notUsing: acc.notUsing + row.notUsing,
        noResponse: acc.noResponse + row.noResponse
      }),
      { using: 0, notUsing: 0, noResponse: 0 }
    );

    return {
      month,
      label: formatMonthKey(month),
      respondents,
      dialed,
      closeCall,
      respondentPct:
        denominator && denominator > 0
          ? (respondents / denominator) * 100
          : null,
      usage: usageRows.length > 0 ? usageTotals : null
    };
  });

  // A few source rows carry dates months beyond the reporting period. Confine
  // the week buckets to the latest month that actually has Summary data so
  // those strays cannot displace real weeks from the last-8 window.
  const [latestYear, latestMonthNumber] = latestMonth.split("-").map(Number);
  const windowEnd = latestMonth
    ? new Date(Date.UTC(latestYear, latestMonthNumber, 0))
    : null;
  const windowStart = new Date(Date.UTC(fiscalYear, 3, 1));

  const weeks = buildWeeks(
    daily.filter((row) => {
      const date = new Date(`${row.date}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return false;
      if (date < windowStart) return false;
      return windowEnd ? date <= windowEnd : true;
    })
  );

  return {
    hasData: true,
    fiscalYear,
    fiscalYearLabel: formatFiscalYear(fiscalYear),
    fyBars,
    currentMonths,
    previousMonths,
    ytd,
    currentMonthSample: latestMonth ? totalFor(latestMonth) : 0,
    currentMonthLabel: latestMonth ? formatMonthKey(latestMonth) : "",
    selectedMonthSample: selectedMonth ? totalFor(selectedMonth) : 0,
    selectedMonthLabel: selectedMonth ? formatMonthKey(selectedMonth) : "",
    sampleTrend,
    weeks,
    monthOptions: monthsWithData,
    subcategoryOptions,
    variantOptions,
    dialedAvailable: Object.keys(callVolume).length > 0,
    // Only answered rows count, so a month of nothing but "-" is not adoption
    // data and must not switch the trend into its adoption form.
    usageAvailable: usage.some((row) => row.using + row.notUsing > 0),
    weeksFromDailyRows: weeks.length > 0,
    warnings
  };
}
