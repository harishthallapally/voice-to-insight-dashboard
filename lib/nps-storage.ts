import type { ParsedWorkbook } from "@/lib/nps-excel";

// Persists the *parsed* workbooks (not the source files) to localStorage so the
// dashboard survives a refresh. The data never leaves the browser. Bumping
// STORAGE_VERSION invalidates anything written by an older parser, so a shape
// change can never resurrect stale or mis-parsed numbers.

const STORAGE_KEY = "connected-nps:workbooks";
const STORAGE_VERSION = 5;

type StoredPayload = {
  version: number;
  savedAt: string;
  workbooks: ParsedWorkbook[];
};

export type LoadResult = {
  workbooks: ParsedWorkbook[];
  savedAt: string | null;
  /** Set when saved data existed but could not be used. */
  notice: string | null;
};

const EMPTY: LoadResult = { workbooks: [], savedAt: null, notice: null };

function hasStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    // Access itself throws when cookies/site data are blocked.
    return false;
  }
}

/** Shallow structural check so a hand-edited or truncated entry is rejected. */
function isWorkbook(value: unknown): value is ParsedWorkbook {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ParsedWorkbook>;
  return (
    typeof candidate.fileName === "string" &&
    (candidate.fuel === "EV" || candidate.fuel === "ICE") &&
    typeof candidate.fiscalYear === "number" &&
    Array.isArray(candidate.records) &&
    Array.isArray(candidate.dailyRows) &&
    Array.isArray(candidate.usage) &&
    Array.isArray(candidate.osSplit) &&
    Array.isArray(candidate.plan)
  );
}

export function loadWorkbooks(): LoadResult {
  if (!hasStorage()) return EMPTY;

  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (!raw) return EMPTY;

  try {
    const parsed = JSON.parse(raw) as StoredPayload;

    if (parsed?.version !== STORAGE_VERSION) {
      clearWorkbooks();
      return {
        ...EMPTY,
        notice: "Saved data was from an older version and has been cleared."
      };
    }

    const workbooks = (parsed.workbooks ?? []).filter(isWorkbook);
    if (workbooks.length === 0) {
      clearWorkbooks();
      return EMPTY;
    }

    return { workbooks, savedAt: parsed.savedAt ?? null, notice: null };
  } catch {
    clearWorkbooks();
    return {
      ...EMPTY,
      notice: "Saved data could not be read and has been cleared."
    };
  }
}

/** Returns null on success, or a message explaining why nothing was saved. */
export function saveWorkbooks(workbooks: ParsedWorkbook[]): string | null {
  if (!hasStorage()) {
    return "This browser is blocking local storage, so the data will not survive a refresh.";
  }

  if (workbooks.length === 0) {
    clearWorkbooks();
    return null;
  }

  const payload: StoredPayload = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    workbooks
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return null;
  } catch {
    // Typically QuotaExceededError. Leave no half-written entry behind: the
    // dashboard still works for this session, it just will not survive a reload.
    clearWorkbooks();
    return "Too large for this browser's storage, so the data will not survive a refresh.";
  }
}

export function clearWorkbooks() {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do if removal is blocked.
  }
}
