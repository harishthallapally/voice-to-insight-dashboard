import type { NpsMetrics } from "@/lib/driver-metrics";
import type { ExtractionRow } from "@/lib/types";

export type RatingCategory =
  | "Product Rating"
  | "Connected Features Rating"
  | "Charger Rating"
  | "";

/**
 * Mirrors the client-side rating classifier in upload-form.tsx
 * (getRatingColumn) so the Summary text and the consolidated workbook's
 * per-category rating columns never disagree about which bucket a rating
 * belongs to.
 */
export function classifyRatingCategory(row: {
  topic: string;
  notes: string;
  l3Driver: string;
  transcription: string;
}): RatingCategory {
  const rowContext = [row.topic, row.notes, row.l3Driver, row.transcription]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(charger|charging|charge)\b/.test(rowContext)) {
    return "Charger Rating";
  }

  if (
    /\b(connected|connectivity|mobile app|mobile application|app|maps?|bluetooth|navigation|gps|phone|pairing|telematics|smartxconnect|smart xonnect)\b/.test(
      rowContext
    )
  ) {
    return "Connected Features Rating";
  }

  if (
    /\b(product|vehicle|two wheeler|bike|scooter|overall|ride|motor|performance|brake|battery|range)\b/.test(
      rowContext
    )
  ) {
    return "Product Rating";
  }

  return "";
}

const RATING_LABELS: Record<Exclude<RatingCategory, "">, string> = {
  "Product Rating": "Vehicle rating",
  "Connected Features Rating": "Connected features rating",
  "Charger Rating": "Charger rating"
};

function getNpsLabel(npsMetrics: NpsMetrics): string {
  if (!npsMetrics.totalResponses) {
    return "";
  }

  if (npsMetrics.promoters > 0) {
    return "Customer is a Promoter of the connected app.";
  }

  if (npsMetrics.passives > 0) {
    return "Customer is Passive on the connected app.";
  }

  if (npsMetrics.detractors > 0) {
    return "Customer is a Detractor of the connected app.";
  }

  return "";
}

function joinWithAnd(items: string[]) {
  if (items.length <= 1) {
    return items.join("");
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * Ground-truth facts pulled straight from already-extracted structured
 * data (ratings, driver text) rather than left to a language model to
 * re-derive, so the Summary text can never state a different rating or
 * NPS status than what the row/consolidated columns already show.
 */
export function buildCallSummaryFacts(
  rows: ExtractionRow[],
  connectedFeaturesNps: NpsMetrics
) {
  const seenRatingCategories = new Set<RatingCategory>();
  const ratingClauses: string[] = [];

  for (const row of rows) {
    const rating = row.rating.trim();

    if (!rating) {
      continue;
    }

    const category = classifyRatingCategory(row);

    if (!category || seenRatingCategories.has(category)) {
      continue;
    }

    seenRatingCategories.add(category);
    ratingClauses.push(`${RATING_LABELS[category]} ${rating}/10`);
  }

  const complaintClauses = rows.map((row) => row.l3Driver.trim()).filter(Boolean);

  return {
    ratingClauses,
    complaintClauses,
    npsLabel: getNpsLabel(connectedFeaturesNps)
  };
}

/**
 * A fully deterministic Summary, used when the AI-composed version is
 * unavailable (API outage or exhausted retries). Less fluent than the AI
 * version but built entirely from already-verified structured fields, so
 * it's always safe to show and never blank.
 */
export function buildDeterministicCallSummary(
  rows: ExtractionRow[],
  connectedFeaturesNps: NpsMetrics
): string {
  const { ratingClauses, complaintClauses, npsLabel } = buildCallSummaryFacts(
    rows,
    connectedFeaturesNps
  );
  const sentences: string[] = [];

  if (ratingClauses.length) {
    sentences.push(`${joinWithAnd(ratingClauses)}.`);
  }

  if (npsLabel) {
    sentences.push(npsLabel);
  }

  if (complaintClauses.length) {
    sentences.push(`Customer raised: ${complaintClauses.join("; ")}.`);
  }

  return sentences.join(" ");
}
