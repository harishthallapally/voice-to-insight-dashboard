"use client";

import { useCallback, useRef, useState } from "react";

import {
  formatFiscalYear,
  parseNpsWorkbook,
  parsePlanCsv,
  parsePlanWorkbook,
  type FuelType,
  type ParsedWorkbook
} from "@/lib/nps-excel";

import styles from "./connected-nps-dashboard.module.css";

// Workbooks are read entirely in the browser - nothing is uploaded to a
// server. The parsed results are cached in localStorage so the dashboard
// survives a refresh; the source files themselves are never stored.

export type UploadError = { fileName: string; message: string };

type Props = {
  /** Only the workbooks this page uses; a fuel-scoped page never lists others. */
  workbooks: ParsedWorkbook[];
  /** Cached workbooks belonging to the other fuel, shown as a note only. */
  otherFuelCount?: number;
  fuel?: FuelType;
  errors: UploadError[];
  /** ISO timestamp of the cached copy, when one is in use. */
  savedAt: string | null;
  storageNotice: string | null;
  onLoaded: (workbooks: ParsedWorkbook[], errors: UploadError[]) => void;
  onClear: () => void;
};

function formatSavedAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const ACCEPTED = ".xlsx,.xls,.xlsm,.csv";

function responseTotalOf(workbook: ParsedWorkbook) {
  return workbook.dailyRows.reduce((sum, row) => sum + row.count, 0);
}

/** Rows that actually answered Yes or No; "-" and blanks are not counted. */
function usageTotalOf(workbook: ParsedWorkbook) {
  return workbook.usage.reduce(
    (sum, row) => sum + row.using + row.notUsing,
    0
  );
}

export function ConnectedNpsUpload({
  workbooks,
  otherFuelCount = 0,
  fuel,
  errors,
  savedAt,
  storageNotice,
  onLoaded,
  onClear
}: Props) {
  const [isReading, setIsReading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      setIsReading(true);
      const parsed: ParsedWorkbook[] = [];
      const failures: UploadError[] = [];

      for (const file of Array.from(fileList)) {
        try {
          // A .csv is the planned-NPS file, not a workbook, and may carry both
          // fuels - so it can yield more than one entry.
          if (file.name.toLowerCase().endsWith(".csv")) {
            parsed.push(...parsePlanCsv(file.name, await file.text()));
            continue;
          }
          const buffer = await file.arrayBuffer();
          try {
            parsed.push(parseNpsWorkbook(file.name, buffer));
          } catch (workbookError) {
            // Not a data workbook - it may be a plan file. If that fails too,
            // report the original error, which is the more useful one.
            try {
              parsed.push(...parsePlanWorkbook(file.name, buffer, fuel));
            } catch {
              throw workbookError;
            }
          }
        } catch (error) {
          failures.push({
            fileName: file.name,
            message:
              error instanceof Error ? error.message : "Could not read workbook."
          });
        }
      }

      setIsReading(false);
      onLoaded(parsed, failures);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onLoaded]
  );

  return (
    <section className={styles.uploadCard}>
      <div
        className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
      >
        <div className={styles.dropZoneText}>
          <strong>
            {isReading ? "Reading workbooks…" : "Drop the NPS Excel files here"}
          </strong>
          <span>
            {fuel
              ? `Select the ${fuel} workbooks — current and previous year, plus the monthly NPS Dashboard files. Files are read in your browser and never uploaded.`
              : "Select them all at once — EV and ICE, current and previous year, plus the NPS Dashboard file. Files are read in your browser and never uploaded."}
            {savedAt && workbooks.length > 0
              ? ` Restored from this browser (saved ${formatSavedAt(savedAt) ?? "earlier"}).`
              : ""}
          </span>
        </div>

        <div className={styles.dropZoneActions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => inputRef.current?.click()}
            disabled={isReading}
          >
            Choose files
          </button>
          {workbooks.length > 0 ? (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onClear}
              disabled={isReading}
            >
              Clear
            </button>
          ) : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className={styles.hiddenInput}
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      {workbooks.length > 0 ? (
        <ul className={styles.fileList}>
          {workbooks.map((workbook) => (
            <li key={workbook.fileName} className={styles.fileChip}>
              <span
                className={
                  workbook.fuel === "EV" ? styles.tagEv : styles.tagIce
                }
              >
                {workbook.fuel}
              </span>
              <span className={styles.fileName}>{workbook.fileName}</span>
              <span className={styles.fileMeta}>
                FY {formatFiscalYear(workbook.fiscalYear)}
                {workbook.records.length > 0
                  ? ` · ${workbook.records.length} ${workbook.entityLabel.toLowerCase()}-month rows`
                  : ""}
                {workbook.dailyRows.length > 0
                  ? ` · ${responseTotalOf(workbook).toLocaleString()} responses`
                  : ""}
                {usageTotalOf(workbook) > 0
                  ? ` · ${usageTotalOf(workbook).toLocaleString()} Yes/No answers`
                  : ""}
                {workbook.plan.length > 0
                  ? ` · ${workbook.plan.length} planned month(s)`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {otherFuelCount > 0 ? (
        <p className={styles.otherFuelNote}>
          {otherFuelCount} other workbook{otherFuelCount === 1 ? "" : "s"} are
          cached in this browser for the {fuel === "EV" ? "ICE" : "EV"} page and
          are not used here.
        </p>
      ) : null}

      {storageNotice ? (
        <ul className={styles.warningList}>
          <li>{storageNotice}</li>
        </ul>
      ) : null}

      {errors.length > 0 ? (
        <ul className={styles.errorList}>
          {errors.map((error) => (
            <li key={error.fileName}>
              <strong>{error.fileName}</strong> — {error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
