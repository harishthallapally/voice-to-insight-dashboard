import { resolveDriverHierarchy } from "@/lib/driver-taxonomy";
import type { ExtractionRow } from "@/lib/types";

export type DriverCount = {
  driver: string;
  count: number;
};

export type DateCount = {
  date: string;
  count: number;
};

export type NpsMetrics = {
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  totalResponses: number;
};

export type DriverMetrics = {
  detractorCount: number;
  l3Drivers: DriverCount[];
  l2Drivers: DriverCount[];
  l1Drivers: DriverCount[];
  vehicleVariants: DriverCount[];
  connectedFeaturesNps: NpsMetrics;
};

type VehicleVariantMatcher = {
  variant: string;
  patterns: RegExp[];
};

const NOT_CAPTURED_VARIANT = "Not Captured";
const vehicleVariantMatchers: VehicleVariantMatcher[] = [
  {
    variant: "TVS iQube",
    patterns: [/\bi\s*qube\b/i, /\biqube\b/i]
  },
  {
    variant: "TVS X",
    patterns: [/\btvs\s*x\b/i, /\bx\s*electric\b/i]
  },
  {
    variant: "Apache",
    patterns: [/\bapache\b/i, /\brtr\b/i, /\brr\s*310\b/i]
  },
  {
    variant: "Ntorq",
    patterns: [/\bntorq\b/i, /\bn\s*torq\b/i]
  },
  {
    variant: "Jupiter",
    patterns: [/\bjupiter\b/i]
  },
  {
    variant: "Raider",
    patterns: [/\braider\b/i]
  },
  {
    variant: "Ronin",
    patterns: [/\bronin\b/i]
  },
  {
    variant: "Radeon",
    patterns: [/\bradeon\b/i]
  },
  {
    variant: "Sport",
    patterns: [/\btvs\s*sport\b/i]
  },
  {
    variant: "XL100",
    patterns: [/\bxl\s*100\b/i]
  },
  {
    variant: "Zest",
    patterns: [/\bzest\b/i]
  },
  {
    variant: "Star City",
    patterns: [/\bstar\s*city\b/i]
  }
];

function incrementDriverCount(counts: Map<string, number>, driver: string) {
  const normalizedDriver = driver.trim();

  if (!normalizedDriver) {
    return;
  }

  counts.set(normalizedDriver, (counts.get(normalizedDriver) ?? 0) + 1);
}

function toSortedDriverCounts(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .map(([driver, count]) => ({ driver, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return left.driver.localeCompare(right.driver);
    });
}

function getRowText(row: ExtractionRow) {
  return [
    row.topic,
    row.customerName,
    row.company,
    row.sentiment,
    row.transcription,
    row.notes,
    row.l3Driver,
    row.l2Driver,
    row.l1Driver,
    row.rating,
    row.nextStep,
    row.actionItems
  ]
    .filter(Boolean)
    .join(" ");
}

function parseRating(value: string) {
  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  const numericMatch = normalizedValue.match(/\b(?:10|[0-9])(?:\.\d+)?\b/);

  if (numericMatch) {
    const rating = Number(numericMatch[0]);

    return Number.isFinite(rating) ? rating : null;
  }

  const wordRatings: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };

  for (const [word, rating] of Object.entries(wordRatings)) {
    if (new RegExp(`\\b${word}\\b`).test(normalizedValue)) {
      return rating;
    }
  }

  return null;
}

export function calculateNpsScore(params: {
  promoters: number;
  detractors: number;
  totalResponses: number;
}) {
  if (params.totalResponses <= 0) {
    return null;
  }

  return Math.round(
    ((params.promoters - params.detractors) / params.totalResponses) * 100
  );
}

function isConnectedFeaturesRating(row: ExtractionRow) {
  const rowContext = [
    row.topic,
    row.notes,
    row.l3Driver,
    row.transcription
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(connected|connectivity|mobile app|mobile application|app|maps?|bluetooth|navigation|gps|phone|pairing|telematics|smartxconnect|smart xonnect)\b/.test(
    rowContext
  );
}

function getConnectedFeaturesRatingRow(rows: ExtractionRow[]) {
  const candidates = rows.filter((row) => {
    if (!isConnectedFeaturesRating(row)) {
      return false;
    }

    const rating = parseRating(row.rating);

    return rating !== null && rating >= 0 && rating <= 10;
  });

  if (!candidates.length) {
    return null;
  }

  // Prefer the customer's own row: extraction occasionally repeats the
  // rating value onto the agent's follow-up "why did you rate it X" row.
  return (
    candidates.find((row) => row.speaker.trim().toLowerCase() === "customer") ??
    candidates[0]
  );
}

function buildConnectedFeaturesNps(rows: ExtractionRow[]): NpsMetrics {
  const npsMetrics: NpsMetrics = {
    score: null,
    promoters: 0,
    passives: 0,
    detractors: 0,
    totalResponses: 0
  };

  // Every row here comes from a single audio file, i.e. a single customer
  // call, so at most one rating should ever count toward NPS. Extraction
  // sometimes carries the same rating value onto more than one row (e.g. the
  // customer's answer and the agent's follow-up asking for reasons) — only
  // the customer's own rating statement should be counted, and only once.
  const ratedRow = getConnectedFeaturesRatingRow(rows);

  if (!ratedRow) {
    return npsMetrics;
  }

  const rating = parseRating(ratedRow.rating) as number;

  npsMetrics.totalResponses = 1;

  if (rating >= 9) {
    npsMetrics.promoters = 1;
  } else if (rating >= 7) {
    npsMetrics.passives = 1;
  } else {
    npsMetrics.detractors = 1;
  }

  npsMetrics.score = calculateNpsScore(npsMetrics);

  return npsMetrics;
}

function getDetractorCount(rows: ExtractionRow[]) {
  const hasDetractorRating = rows.some((row) => {
    const rating = parseRating(row.rating);

    return rating !== null && rating >= 0 && rating <= 6;
  });

  return hasDetractorRating ? 1 : 0;
}

function getVehicleVariants(rows: ExtractionRow[]) {
  const conversationText = rows.map(getRowText).join(" ");
  const variants = new Set<string>();

  for (const matcher of vehicleVariantMatchers) {
    if (matcher.patterns.some((pattern) => pattern.test(conversationText))) {
      variants.add(matcher.variant);
    }
  }

  if (!variants.size) {
    variants.add(NOT_CAPTURED_VARIANT);
  }

  return Array.from(variants).map((driver) => ({
    driver,
    count: 1
  }));
}

export function buildDriverMetrics(rows: ExtractionRow[]): DriverMetrics {
  const l3Counts = new Map<string, number>();
  const l2Counts = new Map<string, number>();
  const l1Counts = new Map<string, number>();

  for (const row of rows) {
    const hierarchy = resolveDriverHierarchy(row);

    incrementDriverCount(l3Counts, row.l3Driver);
    incrementDriverCount(l2Counts, hierarchy.l2Driver);
    incrementDriverCount(l1Counts, hierarchy.l1Driver);
  }

  return {
    detractorCount: getDetractorCount(rows),
    l3Drivers: toSortedDriverCounts(l3Counts),
    l2Drivers: toSortedDriverCounts(l2Counts),
    l1Drivers: toSortedDriverCounts(l1Counts),
    vehicleVariants: getVehicleVariants(rows),
    connectedFeaturesNps: buildConnectedFeaturesNps(rows)
  };
}
