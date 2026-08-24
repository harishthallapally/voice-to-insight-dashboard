import * as XLSX from "xlsx";

// Parses the four "Connected NPS" source workbooks into one normalised set of
// records. The workbooks come in two families that differ in shape:
//
//   EV  (Processed_File_*.xlsx)  Summary keyed by "Variant", 8 fields / month
//   ICE (Integrated_*.xlsx)      Summary keyed by "Model",   5 fields / month
//
// Both lay their Summary sheet out as repeating per-month column blocks under a
// month label row. The March-dated workbooks also drop stray cells ("Date",
// "NPS (%)") into the month row between blocks, so block widths cannot be
// assumed - we carry the last valid month label forward across columns instead.

export type FuelType = "EV" | "ICE";

export type NpsRecord = {
  fuel: FuelType;
  /** Fiscal year the row belongs to, e.g. 2026 means FY 26-27 (Apr'26-Mar'27). */
  fiscalYear: number;
  /** Model (ICE) or variant (EV) label from the first column. */
  entity: string;
  /** Calendar month key, "YYYY-MM". */
  month: string;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
};

export type NpsStatus = "promoter" | "passive" | "detractor";

/**
 * Survey responses for the week-level breakdown, pre-aggregated: one row per
 * (date, entity, status) with a count. Storing individual responses would be
 * ~3x larger for no gain, since the weekly buckets only ever count them.
 */
export type DailyRow = {
  fuel: FuelType;
  /** Local date key, "YYYY-MM-DD". */
  date: string;
  status: NpsStatus;
  entity: string;
  count: number;
};

/**
 * Connected-feature adoption for one month and model, taken from the Raw tab's
 * "1a. Are you using the connected features..." column (column O):
 * "Yes" -> using, "No" -> notUsing, "-" -> noResponse.
 */
export type UsageRecord = {
  fuel: FuelType;
  month: string;
  entity: string;
  using: number;
  notUsing: number;
  noResponse: number;
};

export type ParsedWorkbook = {
  fileName: string;
  fuel: FuelType;
  fiscalYear: number;
  /** "Variant" for EV workbooks, "Model" for ICE workbooks. */
  entityLabel: string;
  records: NpsRecord[];
  dailyRows: DailyRow[];
  usage: UsageRecord[];
  /** Dialed / close-call counts by month key, when the workbook carries them. */
  callVolume: Record<string, { dialed?: number; closeCall?: number }>;
  warnings: string[];
};

export type ParseFailure = {
  fileName: string;
  error: string;
};

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];

/**
 * Recognises the month spellings used across the workbooks: "April'26",
 * "Apr'26", "Sept'25", "1. April'25", "August'26". Returns a 0-based month
 * index plus the two-digit year, or null when the cell is not a month label.
 */
export function parseMonthLabel(
  raw: unknown
): { monthIndex: number; year: number } | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*[.)]\s*/, ""); // strip the "1. " prefix in ICE March

  const match = cleaned.match(/^([a-z]+)\s*['’]?\s*(\d{2}|\d{4})$/);
  if (!match) return null;

  const [, namePart, yearPart] = match;
  const monthIndex = MONTH_NAMES.findIndex((name) =>
    name.startsWith(namePart.slice(0, 3))
  );
  if (monthIndex === -1) return null;

  // "sept" must not be mistaken for anything else; the 3-char prefix handles it.
  const year =
    yearPart.length === 4 ? Number(yearPart) : 2000 + Number(yearPart);
  if (!Number.isFinite(year)) return null;

  return { monthIndex, year };
}

/** Fiscal years run Apr-Mar, so Jan-Mar belong to the previous fiscal year. */
export function fiscalYearOf(monthIndex: number, year: number) {
  return monthIndex >= 3 ? year : year - 1;
}

export function monthKey(monthIndex: number, year: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

/** "2026-04" -> "Apr-26", matching the axis labels on the source report. */
export function formatMonthKey(key: string) {
  const [year, month] = key.split("-").map(Number);
  const name = MONTH_NAMES[month - 1];
  if (!name) return key;
  const title = name.charAt(0).toUpperCase() + name.slice(1, 3);
  return `${title}-${String(year).slice(2)}`;
}

/** "2026" -> "26-27". */
export function formatFiscalYear(fiscalYear: number) {
  return `${String(fiscalYear).slice(2)}-${String(fiscalYear + 1).slice(2)}`;
}

type FieldName = "promoters" | "passives" | "detractors" | "total";

function classifyField(raw: unknown): FieldName | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (!value || value.includes("%")) return null;

  // Percentage and NPS columns are recomputed from the counts, so they are
  // deliberately ignored here - the counts are the single source of truth.
  if (value.startsWith("promoter")) return "promoters";
  if (value.startsWith("passive")) return "passives";
  if (value.startsWith("detractor")) return "detractors";
  if (value === "total" || value.startsWith("total response")) return "total";
  return null;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type Grid = unknown[][];

/**
 * Some sheets declare a wildly inflated range - the ICE Input sheet claims
 * A1:XFC4047, i.e. 16,383 columns - because whole rows were formatted. Taken
 * at face value that makes sheet_to_json materialise ~66M empty cells and cost
 * half a minute, so the range is clamped to the cells that actually exist.
 */
function usedRange(sheet: XLSX.WorkSheet): string | undefined {
  const ref = sheet["!ref"];
  if (!ref) return undefined;

  const declared = XLSX.utils.decode_range(ref);
  let maxRow = -1;
  let maxColumn = -1;

  for (const key of Object.keys(sheet)) {
    if (key.charCodeAt(0) === 33) continue; // "!" metadata keys
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r > maxRow) maxRow = cell.r;
    if (cell.c > maxColumn) maxColumn = cell.c;
  }
  if (maxRow < 0 || maxColumn < 0) return ref;

  return XLSX.utils.encode_range({
    s: { r: declared.s.r, c: declared.s.c },
    e: {
      r: Math.min(declared.e.r, maxRow),
      c: Math.min(declared.e.c, maxColumn)
    }
  });
}

function sheetToGrid(sheet: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: true,
    range: usedRange(sheet)
  });
}

/**
 * Finds the row holding the per-field headers ("Promoters", "Passives", ...).
 * The month labels always sit on the row directly above it.
 */
function findHeaderRow(grid: Grid): number {
  for (let index = 0; index < Math.min(grid.length, 20); index += 1) {
    const row = grid[index] ?? [];
    const text = row.map((cell) => String(cell).toLowerCase());
    const hasPromoters = text.some((cell) => cell.startsWith("promoter"));
    const hasDetractors = text.some((cell) => cell.startsWith("detractor"));
    if (hasPromoters && hasDetractors) return index;
  }
  return -1;
}

type ColumnSpec = { monthIndex: number; year: number; field: FieldName };

function mapColumns(monthRow: unknown[], headerRow: unknown[]): ColumnSpec[] {
  const specs: ColumnSpec[] = [];
  let current: { monthIndex: number; year: number } | null = null;

  const width = Math.max(monthRow.length, headerRow.length);
  for (let column = 0; column < width; column += 1) {
    const month = parseMonthLabel(monthRow[column]);
    // A stray "Date" / "NPS (%)" cell leaves `current` untouched so the column
    // stays attached to the block it visually belongs to.
    if (month) current = month;

    const field = classifyField(headerRow[column]);
    if (!field || !current) continue;

    specs[column] = { ...current, field };
  }

  return specs;
}

const SKIP_ENTITIES = new Set(["", "total", "grand total", "variant", "model"]);

function isEntityRow(label: string) {
  const value = label.trim().toLowerCase();
  if (SKIP_ENTITIES.has(value)) return false;
  // Footnote rows such as "(Iqube 11 is included ...)" are not entities.
  if (value.startsWith("(")) return false;
  return true;
}

function parseSummarySheet(
  grid: Grid,
  fuel: FuelType,
  warnings: string[]
): { records: NpsRecord[]; entityLabel: string } {
  const headerIndex = findHeaderRow(grid);
  if (headerIndex === -1) {
    throw new Error(
      "Could not find a Summary header row containing Promoters/Detractors."
    );
  }

  const headerRow = grid[headerIndex] ?? [];
  const monthRow = headerIndex > 0 ? (grid[headerIndex - 1] ?? []) : [];
  const specs = mapColumns(monthRow, headerRow);

  if (specs.length === 0) {
    throw new Error("Summary sheet has no recognisable month columns.");
  }

  const entityLabel = String(headerRow[0] ?? "").trim() || "Entity";
  const records: NpsRecord[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const label = String(row[0] ?? "").trim();

    // The EV workbooks repeat the whole table lower down the sheet; stopping at
    // the TOTAL row keeps us on the first (authoritative) copy.
    if (label.trim().toLowerCase() === "total") break;
    if (!isEntityRow(label)) continue;

    const buckets = new Map<string, Partial<Record<FieldName, number>>>();

    specs.forEach((spec, column) => {
      if (!spec) return;
      const value = toNumber(row[column]);
      if (value === null) return;

      const key = monthKey(spec.monthIndex, spec.year);
      const bucket = buckets.get(key) ?? {};
      bucket[spec.field] = value;
      buckets.set(key, bucket);
    });

    buckets.forEach((bucket, key) => {
      const promoters = bucket.promoters ?? 0;
      const passives = bucket.passives ?? 0;
      const detractors = bucket.detractors ?? 0;
      const total = bucket.total ?? promoters + passives + detractors;
      if (total <= 0) return;

      const [year, month] = key.split("-").map(Number);
      records.push({
        fuel,
        fiscalYear: fiscalYearOf(month - 1, year),
        entity: label,
        month: key,
        promoters,
        passives,
        detractors,
        total
      });
    });
  }

  if (records.length === 0) {
    warnings.push("Summary sheet parsed but produced no rows with responses.");
  }

  return { records, entityLabel };
}

/**
 * The ICE March workbook carries a "Customer calls" sheet laid out as a date
 * row followed by a "NO OF CALLS MADE" row. Where present it gives the dialed
 * counts the Sample Trend chart needs; the other workbooks do not have it.
 */
function parseCallVolume(grid: Grid): Record<string, { dialed?: number }> {
  const totals: Record<string, { dialed?: number }> = {};
  if (grid.length === 0) return totals;

  const dateRowIndex = grid.findIndex((row) =>
    String(row?.[0] ?? "")
      .trim()
      .toLowerCase()
      .startsWith("date")
  );
  if (dateRowIndex === -1) return totals;

  const dateRow = grid[dateRowIndex] ?? [];
  const callsRow = grid.find((row) =>
    String(row?.[0] ?? "")
      .toLowerCase()
      .includes("calls made")
  );
  if (!callsRow) return totals;

  for (let column = 1; column < dateRow.length; column += 1) {
    const serial = toNumber(dateRow[column]);
    const calls = toNumber(callsRow[column]);
    if (serial === null || calls === null || calls <= 0) continue;

    const date = excelSerialToDate(serial);
    if (!date) continue;

    const key = monthKey(date.getUTCMonth(), date.getUTCFullYear());
    const bucket = totals[key] ?? {};
    bucket.dialed = (bucket.dialed ?? 0) + calls;
    totals[key] = bucket;
  }

  return totals;
}

/** Excel serial dates use a 1900 epoch with the well-known leap-year quirk. */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 100000) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial) * 86400000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Statuses appear both plural ("Promoters") and singular ("Promoter"). */
function classifyStatus(raw: unknown): NpsStatus | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value.startsWith("promoter")) return "promoter";
  if (value.startsWith("passive")) return "passive";
  if (value.startsWith("detractor")) return "detractor";
  return null;
}

/**
 * Dates arrive either as Excel serials (46113) or as "DD-MM-YY" strings, so
 * both are accepted. Anything else is skipped rather than guessed at.
 */
function parseRowDate(raw: unknown): Date | null {
  const serial = typeof raw === "number" ? raw : null;
  if (serial !== null) return excelSerialToDate(serial);

  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && trimmed.length >= 5) {
    return excelSerialToDate(numeric);
  }

  const match = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (!match) return null;

  const [, dayPart, monthPart, yearPart] = match;
  const year = yearPart.length === 4 ? Number(yearPart) : 2000 + Number(yearPart);
  const date = new Date(Date.UTC(year, Number(monthPart) - 1, Number(dayPart)));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKeyOf(date: Date) {
  return date.toISOString().slice(0, 10);
}

function headerIndexOf(header: unknown[], predicate: (value: string) => boolean) {
  return header.findIndex((cell) => predicate(String(cell).trim().toLowerCase()));
}

/**
 * Reads the row-level survey sheet ("Input" / "Input Sheet") to get per-day
 * responses. Only the current-year workbooks carry a usable NPS Status column;
 * where it is missing we fall back to the monthly Summary figures.
 */
function parseDailyRows(
  grid: Grid,
  fuel: FuelType,
  warnings: string[]
): DailyRow[] {
  if (grid.length < 2) return [];

  const header = grid[0] ?? [];
  const dateColumn = headerIndexOf(header, (value) => value === "date");
  const statusColumn = headerIndexOf(header, (value) =>
    value.includes("nps status")
  );
  if (dateColumn === -1 || statusColumn === -1) return [];

  const monthColumn = headerIndexOf(header, (value) => value === "month");

  const modelColumn = headerIndexOf(header, (value) =>
    value.includes("vehicle model")
  );
  const variantColumn = headerIndexOf(header, (value) =>
    value.startsWith("variant")
  );
  // EV workbooks key their Summary by variant, ICE workbooks by model.
  const entityColumn =
    fuel === "EV"
      ? (modelColumn !== -1 ? modelColumn : variantColumn)
      : (modelColumn !== -1 ? modelColumn : variantColumn);

  const rows = new Map<string, DailyRow>();
  let mismatched = 0;

  for (let index = 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    const status = classifyStatus(row[statusColumn]);
    if (!status) continue;

    const date = parseRowDate(row[dateColumn]);
    if (!date) continue;

    // Some source rows carry a mistyped serial (e.g. 45668 on rows whose own
    // Month column reads "Nov'25"). Where the row states its month, trust that
    // over the date cell and drop the row when the two disagree.
    if (monthColumn !== -1) {
      const stated = parseMonthLabel(row[monthColumn]);
      if (
        stated &&
        (stated.monthIndex !== date.getUTCMonth() ||
          stated.year !== date.getUTCFullYear())
      ) {
        mismatched += 1;
        continue;
      }
    }

    const dateKey = dateKeyOf(date);
    const entity =
      entityColumn === -1 ? "" : String(row[entityColumn] ?? "").trim();
    const bucketKey = `${dateKey}|${entity}|${status}`;

    const existing = rows.get(bucketKey);
    if (existing) existing.count += 1;
    else rows.set(bucketKey, { fuel, date: dateKey, status, entity, count: 1 });
  }

  if (mismatched > 0) {
    warnings.push(
      `${mismatched} row(s) had a Date that disagreed with their Month column and were excluded.`
    );
  }

  return [...rows.values()];
}

// The connected-features question does not sit in a fixed column: it is O in
// the July/August books, Q in May, M in June, and absent altogether in April.
// It is therefore always located by header text, never by position.

/**
 * Reads the "Raw" tab of the NPS Dashboard workbook into per-month, per-model
 * adoption counts. Rows where the whole record is blank are trailing filler in
 * the sheet and are skipped; every real row falls into exactly one bucket.
 */
function parseRawUsage(
  grid: Grid,
  fuel: FuelType,
  warnings: string[]
): UsageRecord[] {
  if (grid.length < 2) return [];

  const header = grid[0] ?? [];
  const usageColumn = headerIndexOf(header, (value) =>
    value.includes("are you using the connected")
  );
  if (usageColumn === -1) {
    // April's Raw tab does not carry the question at all. Guessing a column
    // here would turn every row into a false "No Response".
    warnings.push(
      'Raw tab: no "Are you using the connected features" column, so this file adds no adoption data.'
    );
    return [];
  }

  const monthColumn = headerIndexOf(header, (value) => value === "month");
  const dateColumn = headerIndexOf(header, (value) => value === "date");
  const seriesColumn = headerIndexOf(header, (value) => value === "series");

  const buckets = new Map<string, UsageRecord>();
  let unclassified = 0;

  for (let index = 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];

    // Resolve the month from the Month label, falling back to the Date serial.
    let key = "";
    const stated = monthColumn === -1 ? null : parseMonthLabel(row[monthColumn]);
    if (stated) {
      key = monthKey(stated.monthIndex, stated.year);
    } else if (dateColumn !== -1) {
      const date = parseRowDate(row[dateColumn]);
      if (date) key = monthKey(date.getUTCMonth(), date.getUTCFullYear());
    }
    if (!key) continue; // blank filler row

    const raw = String(row[usageColumn] ?? "").trim().toLowerCase();
    const entity =
      seriesColumn === -1 ? "" : String(row[seriesColumn] ?? "").trim();

    const bucketKey = `${key}::${entity}`;
    const bucket =
      buckets.get(bucketKey) ??
      ({ fuel, month: key, entity, using: 0, notUsing: 0, noResponse: 0 });

    if (raw === "yes") bucket.using += 1;
    else if (raw === "no") bucket.notUsing += 1;
    else if (raw === "-" || raw === "") bucket.noResponse += 1;
    else {
      unclassified += 1;
      bucket.noResponse += 1;
    }

    buckets.set(bucketKey, bucket);
  }

  if (unclassified > 0) {
    warnings.push(
      `Raw tab: ${unclassified} row(s) had an unexpected value in the connected-features column and were counted as no response.`
    );
  }

  return [...buckets.values()];
}

function detectFuel(
  fileName: string,
  sheetNames: string[],
  rawGrid?: Grid | null
): FuelType {
  const haystack = `${fileName} ${sheetNames.join(" ")}`.toLowerCase();
  if (/\bice\b/.test(haystack)) return "ICE";
  if (/\bev\b/.test(haystack)) return "EV";
  // The EV workbooks are the ones carrying iQube / Orbiter breakdown sheets.
  if (/iqube|orbiter/.test(haystack)) return "EV";

  // The NPS Dashboard workbook names neither, so read the models it contains.
  if (rawGrid && rawGrid.length > 1) {
    const sample = rawGrid
      .slice(1, 400)
      .map((row) => String(row?.[0] ?? "").toLowerCase())
      .join(" ");
    if (/iqube|orbiter/.test(sample)) return "EV";
  }

  return "ICE";
}

function findSheet(workbook: XLSX.WorkBook, predicate: (name: string) => boolean) {
  // A selective read leaves unrequested names in SheetNames with no entry in
  // Sheets, so the sheet itself has to be checked, not just the name.
  const name = workbook.SheetNames.find(
    (candidate) => predicate(candidate) && !!workbook.Sheets[candidate]
  );
  return name ? { name, sheet: workbook.Sheets[name] } : null;
}

/** The only sheets this parser reads; everything else is skipped. */
function isNeededSheet(name: string) {
  const value = name.trim().toLowerCase();
  return (
    value === "summary" ||
    value === "raw" ||
    value === "input" ||
    value === "input sheet" ||
    value.includes("customer call")
  );
}

export function parseNpsWorkbook(
  fileName: string,
  data: ArrayBuffer
): ParsedWorkbook {
  // These workbooks carry up to 20 sheets of per-model pivots we never touch,
  // and parsing them all is what made a 17 MB file take ~90s. Read the sheet
  // names first, then re-read only the handful we actually use.
  const probe = XLSX.read(data, { type: "array", bookSheets: true });
  const needed = probe.SheetNames.filter(isNeededSheet);

  const workbook = XLSX.read(data, {
    type: "array",
    sheets: needed,
    cellHTML: false,
    cellFormula: false,
    cellStyles: false
  });
  const warnings: string[] = [];

  const summary = findSheet(
    workbook,
    (name) => name.trim().toLowerCase() === "summary"
  );
  const rawSheet = findSheet(
    workbook,
    (name) => name.trim().toLowerCase() === "raw"
  );

  if (!summary && !rawSheet) {
    throw new Error(
      `No "Summary" or "Raw" sheet found. Sheets present: ${probe.SheetNames.join(", ")}`
    );
  }

  const rawGrid = rawSheet ? sheetToGrid(rawSheet.sheet) : null;
  const fuel = detectFuel(fileName, probe.SheetNames, rawGrid);

  // The NPS Dashboard workbook has a Summary sheet of a different shape, so a
  // Summary that yields nothing is not fatal when a Raw tab is present.
  let records: NpsRecord[] = [];
  let entityLabel = rawSheet ? "Model" : "Entity";

  if (summary) {
    try {
      const parsed = parseSummarySheet(
        sheetToGrid(summary.sheet),
        fuel,
        warnings
      );
      records = parsed.records;
      entityLabel = parsed.entityLabel;
    } catch (error) {
      if (!rawSheet) throw error;
    }
  }

  const usage = rawGrid ? parseRawUsage(rawGrid, fuel, warnings) : [];

  const inputSheet = findSheet(workbook, (name) => {
    const value = name.trim().toLowerCase();
    return value === "input" || value === "input sheet";
  });
  const dailyRows = inputSheet
    ? parseDailyRows(sheetToGrid(inputSheet.sheet), fuel, warnings)
    : [];

  if (inputSheet && dailyRows.length === 0) {
    warnings.push(
      `"${inputSheet.name}" has no usable Date + NPS Status pair; week-level figures fall back to monthly data.`
    );
  }

  const callsSheet = findSheet(workbook, (name) =>
    name.toLowerCase().includes("customer call")
  );
  const callVolume = callsSheet
    ? parseCallVolume(sheetToGrid(callsSheet.sheet))
    : {};

  // A workbook spans one fiscal year; take the one most of its rows fall in.
  // Usage-only workbooks carry no Summary records, so fall back to their months.
  const fiscalTally = new Map<number, number>();
  const tally = (fiscalYear: number, weight: number) =>
    fiscalTally.set(fiscalYear, (fiscalTally.get(fiscalYear) ?? 0) + weight);

  records.forEach((record) => tally(record.fiscalYear, 1));
  if (records.length === 0) {
    usage.forEach((record) => {
      const [year, month] = record.month.split("-").map(Number);
      tally(fiscalYearOf(month - 1, year), 1);
    });
  }
  const fiscalYear =
    [...fiscalTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    new Date().getFullYear();

  if (fiscalTally.size > 1) {
    warnings.push(
      `Rows span ${fiscalTally.size} fiscal years; charted under FY ${formatFiscalYear(fiscalYear)}.`
    );
  }

  return {
    fileName,
    fuel,
    fiscalYear,
    entityLabel,
    records,
    dailyRows,
    usage,
    callVolume,
    warnings
  };
}
