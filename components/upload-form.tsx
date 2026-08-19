"use client";

import { useRef, useState } from "react";

import { resolveDriverHierarchy } from "@/lib/driver-taxonomy";
import { notifyUploadStatsUpdated } from "@/lib/upload-stats";

type ResultPayload = {
  fileName: string;
  transcriptionProvider: string;
  summary: string;
  workbookBase64: string;
  driverMetrics?: {
    detractorCount?: number;
    l3Drivers?: Array<{
      driver: string;
      count: number;
    }>;
    l2Drivers?: Array<{
      driver: string;
      count: number;
    }>;
    l1Drivers?: Array<{
      driver: string;
      count: number;
    }>;
    vehicleVariants?: Array<{
      driver: string;
      count: number;
    }>;
    connectedFeaturesNps?: {
      score: number | null;
      promoters: number;
      passives: number;
      detractors: number;
      totalResponses: number;
    };
  };
};

type AudioJobPayload = {
  id: string;
  inputFileName: string;
  status: UploadItemStatus;
  result?: Partial<ResultPayload>;
  error?: string;
};

type UploadItemStatus = "queued" | "processing" | "complete" | "error";

type UploadItem = {
  id: string;
  jobId?: string;
  inputFileName: string;
  status: UploadItemStatus;
  result?: ResultPayload;
  error?: string;
};

type ConversationDataRow = Record<string, unknown>;

type ConsolidatedRow = {
  "S.No": number;
  "Frame No": string;
  "Product Rating": string;
  "Connected Features Rating": string;
  "Charger Rating": string;
  "Voice Of Customer": string;
  "L3 Driver": string;
  "L2 Driver": string;
  "L1 Driver": string;
};

type StatisticCard = {
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger";
};

const conversationDataHeaders = [
  "Speaker",
  "Topic",
  "Customer Name",
  "Sentiement",
  "Transcription",
  "Notes",
  "L3 Driver",
  "L2 Driver",
  "L1 Driver",
  "Rating",
  "Next Step"
];

const consolidatedHeaders = [
  "S.No",
  "Frame No",
  "Product Rating",
  "Connected Features Rating",
  "Charger Rating",
  "Voice Of Customer",
  "L3 Driver",
  "L2 Driver",
  "L1 Driver"
];

class ProcessError extends Error {
  payload?: Partial<ResultPayload>;

  constructor(message: string, payload?: Partial<ResultPayload>) {
    super(message);
    this.name = "ProcessError";
    this.payload = payload;
  }
}

function normalizeResultPayload(payload: Partial<ResultPayload>): ResultPayload {
  return {
    fileName: payload.fileName || "",
    transcriptionProvider: payload.transcriptionProvider || "unknown",
    summary: payload.summary || "",
    workbookBase64: payload.workbookBase64 || "",
    driverMetrics: payload.driverMetrics
  };
}

function normalizeJobPayload(payload: Partial<AudioJobPayload>): AudioJobPayload {
  return {
    id: payload.id || "",
    inputFileName: payload.inputFileName || "",
    status: payload.status || "queued",
    result: payload.result,
    error: payload.error || ""
  };
}

function buildUploadId(file: File, index: number) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}`;
}

function getSelectedAudioFiles(files: FileList | File[] | null | undefined) {
  return files
    ? Array.from(files).filter((file) => file.size > 0)
    : [];
}

function base64ToUint8Array(workbookBase64: string) {
  const binary = atob(workbookBase64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFileSize(bytes: number) {
  if (!bytes) {
    return "0 MB";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadWorkbook(fileName: string, workbookBase64: string) {
  const bytes = base64ToUint8Array(workbookBase64);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadAllWorkbooks(items: UploadItem[]) {
  const downloadableItems = items.filter(
    (item) => item.result?.fileName && item.result.workbookBase64
  );

  if (!downloadableItems.length) {
    throw new Error("No Excel files are available to download.");
  }

  downloadableItems.forEach((item) => {
    downloadWorkbook(
      item.result?.fileName || "conversation-data.xlsx",
      item.result?.workbookBase64 || ""
    );
  });
}

function getCellText(row: ConversationDataRow, columnName: string) {
  const value = row[columnName];

  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function getRatingColumn(row: ConversationDataRow) {
  const rowContext = [
    getCellText(row, "Topic"),
    getCellText(row, "Notes"),
    getCellText(row, "L3 Driver"),
    getCellText(row, "Transcription")
  ]
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

function getDriverAndRatingValues(row: ConversationDataRow) {
  const hierarchy = resolveDriverHierarchy({
    speaker: getCellText(row, "Speaker"),
    l3Driver: getCellText(row, "L3 Driver"),
    l2Driver: getCellText(row, "L2 Driver"),
    l1Driver: getCellText(row, "L1 Driver"),
    sentiment: getCellText(row, "Sentiement"),
    topic: getCellText(row, "Topic"),
    notes: getCellText(row, "Notes"),
    transcription: getCellText(row, "Transcription")
  });

  return {
    rating: getCellText(row, "Rating"),
    l3Driver: getCellText(row, "L3 Driver"),
    l2Driver: hierarchy.l2Driver,
    l1Driver: hierarchy.l1Driver
  };
}

function hasDriverOrRatingData(row: ConversationDataRow) {
  const values = getDriverAndRatingValues(row);

  return Boolean(
    values.rating || values.l3Driver || values.l2Driver || values.l1Driver
  );
}

function buildFilteredConversationRows(rows: ConversationDataRow[]) {
  return rows
    .filter(hasDriverOrRatingData)
    .map((row): ConversationDataRow => {
      const values = getDriverAndRatingValues(row);

      return {
        ...row,
        "L3 Driver": values.l3Driver,
        "L2 Driver": values.l2Driver,
        "L1 Driver": values.l1Driver,
        Rating: values.rating
      };
    });
}

function buildConsolidatedRows(params: {
  frameNo: string;
  rows: ConversationDataRow[];
  startIndex: number;
}) {
  return buildFilteredConversationRows(params.rows).map(
    (row, index): ConsolidatedRow => {
      const { l1Driver, l2Driver, l3Driver, rating } =
        getDriverAndRatingValues(row);
      const ratingColumn = rating ? getRatingColumn(row) : "";

      return {
        "S.No": params.startIndex + index,
        "Frame No": params.frameNo,
        "Product Rating": ratingColumn === "Product Rating" ? rating : "",
        "Connected Features Rating":
          ratingColumn === "Connected Features Rating" ? rating : "",
        "Charger Rating": ratingColumn === "Charger Rating" ? rating : "",
        "Voice Of Customer": getCellText(row, "Notes"),
        "L3 Driver": l3Driver,
        "L2 Driver": l2Driver,
        "L1 Driver": l1Driver
      };
    }
  );
}

function buildConversationWorksheet(
  XLSX: typeof import("xlsx"),
  rows: ConversationDataRow[]
) {
  return XLSX.utils.json_to_sheet(rows, {
    header: conversationDataHeaders
  });
}

function buildConsolidatedWorksheet(
  XLSX: typeof import("xlsx"),
  rows: ConsolidatedRow[]
) {
  return XLSX.utils.json_to_sheet(rows, {
    header: consolidatedHeaders
  });
}

function buildWorksheetName(
  fileName: string,
  index: number,
  usedNames: Set<string>
) {
  const fallbackName = `Audio ${index + 1}`;
  const fileNameWithoutExtension =
    fileName.replace(/\.[^/.]+$/, "").trim() || fallbackName;
  const cleanedName =
    fileNameWithoutExtension
      .replace(/[\\/?*\[\]:]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || fallbackName;
  let worksheetName = cleanedName.slice(0, 31);
  let copyNumber = 2;

  while (usedNames.has(worksheetName.toLowerCase())) {
    const suffix = ` (${copyNumber})`;
    worksheetName = `${cleanedName.slice(0, 31 - suffix.length)}${suffix}`;
    copyNumber += 1;
  }

  usedNames.add(worksheetName.toLowerCase());
  return worksheetName;
}

async function downloadConsolidatedWorkbook(items: UploadItem[]) {
  const XLSX = await import("xlsx");
  const consolidatedWorkbook = XLSX.utils.book_new();
  const usedWorksheetNames = new Set<string>(["consolidated"]);
  const consolidatedRows: ConsolidatedRow[] = [];
  let worksheetCount = 0;

  for (const [index, item] of items.entries()) {
    const workbookBase64 = item.result?.workbookBase64;

    if (!workbookBase64) {
      continue;
    }

    const workbook = XLSX.read(base64ToUint8Array(workbookBase64), {
      type: "array"
    });
    const worksheet = workbook.Sheets["Conversation Data"];

    if (!worksheet) {
      throw new Error(
        `Conversation Data sheet was not found for ${item.inputFileName}.`
      );
    }

    const sheetRows = XLSX.utils.sheet_to_json<ConversationDataRow>(
      worksheet,
      {
        defval: ""
      }
    );
    const filteredSheetRows = buildFilteredConversationRows(sheetRows);

    consolidatedRows.push(
      ...buildConsolidatedRows({
        frameNo: item.inputFileName,
        rows: filteredSheetRows,
        startIndex: consolidatedRows.length + 1
      })
    );

    XLSX.utils.book_append_sheet(
      consolidatedWorkbook,
      buildConversationWorksheet(XLSX, filteredSheetRows),
      buildWorksheetName(item.inputFileName, index, usedWorksheetNames)
    );
    worksheetCount += 1;
  }

  if (!worksheetCount) {
    throw new Error("No Conversation Data sheets are available to consolidate.");
  }

  const consolidatedWorksheet = buildConsolidatedWorksheet(
    XLSX,
    consolidatedRows
  );
  XLSX.utils.book_append_sheet(
    consolidatedWorkbook,
    consolidatedWorksheet,
    "Consolidated"
  );
  consolidatedWorkbook.SheetNames = [
    "Consolidated",
    ...consolidatedWorkbook.SheetNames.filter(
      (sheetName) => sheetName !== "Consolidated"
    )
  ];

  const workbookArray = XLSX.write(consolidatedWorkbook, {
    bookType: "xlsx",
    type: "array"
  });
  const blob = new Blob([workbookArray], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "consolidated-conversation-data.xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}

async function prepareAudioFiles(files: File[]) {
  const prepared: File[] = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();

    if (!buffer.byteLength) {
      throw new Error(`Could not read audio data for ${file.name}.`);
    }

    if (buffer.byteLength !== file.size && file.size > 0) {
      throw new Error(
        `Audio file ${file.name} was not fully read (${buffer.byteLength} of ${file.size} bytes).`
      );
    }

    prepared.push(
      new File([buffer], file.name, {
        type: file.type || "audio/mpeg"
      })
    );
  }

  return prepared;
}

async function submitAudioJob(file: File) {
  const formData = new FormData();
  formData.set("audio", file, file.name);

  const response = await fetch("/api/jobs", {
    method: "POST",
    headers: {
      "X-Original-File-Size": String(file.size)
    },
    body: formData
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new ProcessError(
      payload.error || `Could not queue ${file.name}.`,
      normalizeResultPayload(payload)
    );
  }

  return normalizeJobPayload(payload.job);
}

async function fetchAudioJob(jobId: string) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store"
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new ProcessError(payload.error || "Could not read job status.");
  }

  return normalizeJobPayload(payload.job);
}

async function pollAudioJob(
  jobId: string,
  onJobUpdate: (job: AudioJobPayload) => void
) {
  while (true) {
    const job = await fetchAudioJob(jobId);
    onJobUpdate(job);

    if (job.status === "complete") {
      return normalizeResultPayload(job.result || {});
    }

    if (job.status === "error") {
      throw new ProcessError(
        job.error || "Audio processing failed.",
        normalizeResultPayload(job.result || {})
      );
    }

    await sleep(2500);
  }
}

export function UploadForm() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isPreparingFiles, setIsPreparingFiles] = useState(false);
  const [isBuildingConsolidated, setIsBuildingConsolidated] = useState(false);

  const finishedCount = items.filter(
    (item) => item.status === "complete" || item.status === "error"
  ).length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const processingCount = items.filter(
    (item) => item.status === "processing"
  ).length;
  const excelReadyCount = items.filter(
    (item) => item.status === "complete" && item.result?.workbookBase64
  ).length;
  const failedCount = items.filter((item) => item.status === "error").length;
  const selectedFileCount = selectedFiles.length || selectedFileNames.length;
  const dashboardFileCount = items.length || selectedFileCount;
  const totalSelectedBytes = selectedFiles.reduce(
    (totalBytes, file) => totalBytes + file.size,
    0
  );
  const progressPercent = items.length
    ? Math.round((finishedCount / items.length) * 100)
    : 0;
  const dashboardStatus = items.length
    ? isProcessing
      ? "Processing batch"
      : failedCount
        ? "Completed with errors"
        : "Completed"
    : selectedFileCount
      ? "Ready to submit"
      : "Waiting for files";
  const statistics: StatisticCard[] = [
    {
      label: "Files Selected",
      value: dashboardFileCount
    },
    {
      label: "Queued",
      value: queuedCount
    },
    {
      label: "Processing",
      value: processingCount,
      tone: processingCount ? "warning" : "neutral"
    },
    {
      label: "Excel Ready",
      value: excelReadyCount,
      tone: excelReadyCount ? "success" : "neutral"
    },
    {
      label: "Failed",
      value: failedCount,
      tone: failedCount ? "danger" : "neutral"
    },
    {
      label: "Batch Size",
      value: formatFileSize(totalSelectedBytes)
    }
  ];
  const isConsolidatedReady =
    items.length > 0 &&
    items.every(
      (item) => item.status === "complete" && item.result?.workbookBase64
    );

  function resetOutputForNewFiles(fileNames: string[]) {
    setSelectedFileNames(fileNames);
    setItems([]);
    setError("");
  }

  function updateSelectedFiles(files: FileList | File[] | null) {
    const nextFiles = getSelectedAudioFiles(files);
    resetOutputForNewFiles(nextFiles.map((file) => file.name));
    setSelectedFiles([]);

    void (async () => {
      setIsPreparingFiles(true);

      try {
        const preparedFiles = await prepareAudioFiles(nextFiles);
        setSelectedFiles(preparedFiles);
      } catch (prepareError) {
        setSelectedFiles([]);
        setError(
          prepareError instanceof Error
            ? prepareError.message
            : "Could not read one or more selected audio files."
        );
      } finally {
        setIsPreparingFiles(false);
      }
    })();
  }

  function handleDrop(files: FileList | null) {
    if (!files?.length || !fileInputRef.current) {
      return;
    }

    const transfer = new DataTransfer();

    Array.from(files).forEach((file) => {
      transfer.items.add(file);
    });

    fileInputRef.current.files = transfer.files;
    updateSelectedFiles(transfer.files);
  }

  async function handleSubmit(files: File[]) {
    setError("");

    if (!files.length) {
      setItems([]);
      setError("Please select at least one audio file.");
      return;
    }

    const nextItems: UploadItem[] = files.map((file, index) => ({
      id: buildUploadId(file, index),
      inputFileName: file.name,
      status: "queued"
    }));

    setItems(nextItems);
    setIsProcessing(true);

    try {
      const preparedFiles = await prepareAudioFiles(files);
      const jobTrackers: Array<Promise<void>> = [];

      for (const [index, file] of preparedFiles.entries()) {
        const itemId = nextItems[index].id;

        try {
          const job = await submitAudioJob(file);
          notifyUploadStatsUpdated();

          setItems((currentItems) =>
            currentItems.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    jobId: job.id,
                    status: job.status,
                    result: job.result
                      ? normalizeResultPayload(job.result)
                      : undefined,
                    error: job.error || ""
                  }
                : item
            )
          );

          jobTrackers.push(
            pollAudioJob(job.id, (updatedJob) => {
              setItems((currentItems) =>
                currentItems.map((item) =>
                  item.id === itemId
                    ? {
                        ...item,
                        status: updatedJob.status,
                        result: updatedJob.result
                          ? normalizeResultPayload(updatedJob.result)
                          : item.result,
                        error: updatedJob.error || ""
                      }
                    : item
                )
              );
            })
              .then((result) => {
                notifyUploadStatsUpdated();
                setItems((currentItems) =>
                  currentItems.map((item) =>
                    item.id === itemId
                      ? { ...item, status: "complete", result, error: "" }
                      : item
                  )
                );
              })
              .catch((itemError) => {
                notifyUploadStatsUpdated();
                const payload =
                  itemError instanceof ProcessError
                    ? itemError.payload
                    : undefined;
                const result = payload
                  ? normalizeResultPayload(payload)
                  : undefined;

                setItems((currentItems) =>
                  currentItems.map((item) =>
                    item.id === itemId
                      ? {
                          ...item,
                          status: "error",
                          result,
                          error:
                            itemError instanceof Error
                              ? itemError.message
                              : `Unexpected processing error for ${file.name}.`
                        }
                      : item
                  )
                );
              })
          );
        } catch (itemError) {
          notifyUploadStatsUpdated();
          const payload =
            itemError instanceof ProcessError ? itemError.payload : undefined;
          const result = payload ? normalizeResultPayload(payload) : undefined;

          setItems((currentItems) =>
            currentItems.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    status: "error",
                    result,
                    error:
                      itemError instanceof Error
                        ? itemError.message
                        : `Unexpected upload error for ${file.name}.`
                  }
                : item
            )
          );
        }
      }

      await Promise.allSettled(jobTrackers);
    } catch (prepareError) {
      setItems([]);
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Could not prepare selected audio files."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="layout">
      <section className="panel">
        <div className="panel-inner stack">
          <form
            className="form-grid"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();

              const files =
                selectedFiles.length > 0
                  ? selectedFiles
                  : getSelectedAudioFiles(fileInputRef.current?.files);

              void (async () => {
                try {
                  await handleSubmit(files);
                } catch (submitError) {
                  setIsProcessing(false);
                  setItems([]);
                  setError(
                    submitError instanceof Error
                      ? submitError.message
                      : "Unexpected upload error."
                  );
                }
              })();
            }}
          >
            <section className="upload-card">
              <div className="upload-copy">
                <h2>Upload Audio Files</h2>
              </div>

              <label
                className={`upload-dropzone ${isDragActive ? "is-drag-active" : ""}`}
                htmlFor="audio-file"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setIsDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();

                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    return;
                  }

                  setIsDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDragActive(false);
                  handleDrop(event.dataTransfer.files || null);
                }}
              >
                <input
                  ref={fileInputRef}
                  className="upload-input"
                  id="audio-file"
                  type="file"
                  name="audio"
                  accept="audio/*"
                  multiple
                  onChange={(event) => {
                    updateSelectedFiles(event.target.files);
                  }}
                />
                <span className="upload-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" role="presentation">
                    <path
                      d="M7 18a4 4 0 0 1-.38-7.98A5.5 5.5 0 0 1 17.3 8.1 4.5 4.5 0 1 1 18 18h-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M12 11v10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="m8.8 13.8 3.2-3.2 3.2 3.2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="upload-title">
                  Drag audio files here or click to browse
                </span>
                <span className="upload-subtitle">
                  Supported audio formats MP3, WAV, M4A
                </span>
                {selectedFileNames.length ? (
                  <span className="upload-selected-list">
                    {selectedFileNames.map((fileName, index) => (
                      <span
                        className="upload-selected"
                        key={`${fileName}-${index}`}
                      >
                        {fileName}
                      </span>
                    ))}
                  </span>
                ) : null}
              </label>
            </section>

            <div className="button-row">
              <button
                className="button button-primary"
                type="submit"
                disabled={
                  isProcessing ||
                  isPreparingFiles ||
                  (selectedFileNames.length > 0 && selectedFiles.length === 0)
                }
              >
                {isPreparingFiles
                  ? "Loading files..."
                  : isProcessing
                    ? "Processing..."
                    : "Submit"}
              </button>
            </div>

            <p className={`status ${error ? "error" : ""}`}>
              {error || ""}
            </p>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-inner statistics-dashboard">
          <div className="statistics-header">
            <div>
              <h3>Statistics Dashboard</h3>
              <p>{dashboardStatus}</p>
            </div>
            <strong>{progressPercent}%</strong>
          </div>

          <div
            className="statistics-progress"
            aria-label={`Batch progress ${progressPercent}%`}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="statistics-grid">
            {statistics.map((stat) => (
              <article
                className={`statistic-card is-${stat.tone || "neutral"}`}
                key={stat.label}
              >
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-inner">
          {items.length ? (
            <section className="results-stack">
              <div className="results-header">
                <div className="results-title">
                  <h3>Processed Files</h3>
                  <p>
                    {finishedCount} of {items.length} finished
                  </p>
                </div>
                <div className="results-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!isConsolidatedReady}
                    title={
                      isConsolidatedReady
                        ? "Download every individual Excel file"
                        : "Available after every file completes successfully"
                    }
                    onClick={() => {
                      try {
                        setError("");
                        downloadAllWorkbooks(items);
                      } catch (downloadError) {
                        setError(
                          downloadError instanceof Error
                            ? downloadError.message
                            : "Could not download the Excel files."
                        );
                      }
                    }}
                  >
                    Download All Excel
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={!isConsolidatedReady || isBuildingConsolidated}
                    title={
                      isConsolidatedReady
                        ? "Download one Consolidated tab plus each file's Conversation Data tab"
                        : "Available after every file completes successfully"
                    }
                    onClick={() => {
                      void (async () => {
                        setError("");
                        setIsBuildingConsolidated(true);

                        try {
                          await downloadConsolidatedWorkbook(items);
                        } catch (consolidationError) {
                          setError(
                            consolidationError instanceof Error
                              ? consolidationError.message
                              : "Could not build the consolidated Excel file."
                          );
                        } finally {
                          setIsBuildingConsolidated(false);
                        }
                      })();
                    }}
                  >
                    {isBuildingConsolidated
                      ? "Preparing..."
                      : "Download Consolidated Excel"}
                  </button>
                </div>
              </div>

              <div className="result-list">
                {items.map((item) => (
                  <article
                    className={`result-item is-${item.status}`}
                    key={item.id}
                  >
                    <div className="result-item-header">
                      <div className="result-title">
                        <h4>{item.inputFileName}</h4>
                        <p className="result-meta">
                          {item.status === "complete"
                            ? "Excel ready"
                            : item.status === "error"
                              ? "Needs attention"
                              : item.status === "processing"
                                ? "Processing"
                                : "Queued"}
                        </p>
                      </div>

                      {item.result?.workbookBase64 ? (
                        <button
                          className="button button-secondary"
                          type="button"
                          onClick={() =>
                            downloadWorkbook(
                              item.result?.fileName || "conversation-data.xlsx",
                              item.result?.workbookBase64 || ""
                            )
                          }
                        >
                          Download Excel
                        </button>
                      ) : null}
                    </div>

                    {item.result?.summary ? (
                      <p className="result-summary">{item.result.summary}</p>
                    ) : null}

                    {item.error ? (
                      <p className="status error">{item.error}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <p className="status">
              No processed audio yet. After upload, this panel will show each
              file with its Excel download.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
