// Pulls audio out of a OneDrive folder, runs it through the existing
// transcription/extraction pipeline, and appends the resulting rows to a single
// workbook that lives on the same drive.
//
// The workbook is treated as a plain data sheet: rows are appended to a flat
// table and the file is rewritten wholesale. Nothing here preserves cell
// styling, charts, or formulas - if the target ever becomes a formatted report,
// this needs to move off SheetJS.

import * as XLSX from "xlsx";

import {
  AudioProcessingError,
  processAudioBuffer
} from "@/lib/audio-processing";
import { getDriveProvider, type DriveItem } from "@/lib/drive-provider";

/** Sheet the appended rows live on. Matches buildWorkbook's data sheet name. */
const DATA_SHEET = "Conversation Data";

/** Provenance columns, appended after the pipeline's own columns. */
const SOURCE_FILE_COLUMN = "Source File";
const PROCESSED_AT_COLUMN = "Processed At";

const DATA_COLUMNS = [
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
  "Next Step",
  "Summary",
  SOURCE_FILE_COLUMN,
  PROCESSED_AT_COLUMN
];

const AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".m4a",
  ".mp4",
  ".aac",
  ".flac",
  ".ogg",
  ".oga",
  ".opus",
  ".webm",
  ".amr",
  ".wma"
]);

type SheetRow = Record<string, string>;

export type SyncFileOutcome = {
  fileName: string;
  status: "processed" | "skipped" | "failed";
  rowsAdded?: number;
  reason?: string;
};

export type SyncResult = {
  provider: "onedrive" | "local";
  audioFolder: string;
  workbookPath: string;
  filesSeen: number;
  filesProcessed: number;
  rowsAdded: number;
  workbookUpdated: boolean;
  results: SyncFileOutcome[];
};

function hasAudioExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && AUDIO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/**
 * Reads the rows the pipeline just produced back out of its own workbook, so
 * processAudioBuffer stays untouched and there is one definition of how a
 * transcript becomes spreadsheet columns.
 */
function extractRows(workbookBase64: string): SheetRow[] {
  const workbook = XLSX.read(Buffer.from(workbookBase64, "base64"), {
    type: "buffer"
  });
  const sheet = workbook.Sheets[DATA_SHEET];

  if (!sheet) {
    return [];
  }

  return XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: "" });
}

function readExistingRows(workbookBuffer: Buffer | null): SheetRow[] {
  if (!workbookBuffer) {
    return [];
  }

  const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.includes(DATA_SHEET)
    ? DATA_SHEET
    : workbook.SheetNames[0];

  if (!sheetName) {
    return [];
  }

  return XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[sheetName], {
    defval: ""
  });
}

function buildOutputWorkbook(rows: SheetRow[]) {
  // json_to_sheet emits only the columns named in `header`, so any column the
  // existing workbook carries that the pipeline does not know about (a manual
  // reviewer note, say) would be silently dropped. Union them onto the end
  // instead, keeping the pipeline's column order for everything it owns.
  const extraColumns: string[] = [];

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!DATA_COLUMNS.includes(key) && !extraColumns.includes(key)) {
        extraColumns.push(key);
      }
    }
  }

  const sheet = XLSX.utils.json_to_sheet(rows, {
    header: [...DATA_COLUMNS, ...extraColumns]
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, DATA_SHEET);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * Lists the audio in the folder and flags which files a sync would actually
 * process, without downloading or transcribing anything. Cheap enough to call
 * before a run to sanity-check the folder and workbook paths.
 */
export async function listPendingAudio(options?: {
  audioFolder?: string;
  workbookPath?: string;
}) {
  const audioFolder =
    options?.audioFolder ?? process.env.ONEDRIVE_AUDIO_FOLDER?.trim();
  const workbookPath =
    options?.workbookPath ?? process.env.ONEDRIVE_WORKBOOK_PATH?.trim();

  if (!audioFolder) {
    throw new Error("ONEDRIVE_AUDIO_FOLDER is not set.");
  }

  const drive = await getDriveProvider();
  const children = await drive.listFolderChildren(audioFolder);
  const existingRows = workbookPath
    ? readExistingRows(await drive.downloadByPath(workbookPath))
    : [];
  const alreadyProcessed = new Set(
    existingRows
      .map((row) => String(row[SOURCE_FILE_COLUMN] ?? "").trim())
      .filter(Boolean)
  );

  const files = children
    .filter((item) => Boolean(item.file) && hasAudioExtension(item.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      fileName: item.name,
      sizeBytes: item.size,
      lastModified: item.lastModifiedDateTime,
      pending: !alreadyProcessed.has(item.name)
    }));

  return {
    provider: drive.name,
    audioFolder,
    workbookPath: workbookPath ?? null,
    existingRowCount: existingRows.length,
    pendingCount: files.filter((file) => file.pending).length,
    files
  };
}

export async function syncOneDriveAudio(options?: {
  /** Overrides ONEDRIVE_AUDIO_FOLDER. */
  audioFolder?: string;
  /** Overrides ONEDRIVE_WORKBOOK_PATH. */
  workbookPath?: string;
  /** Stop after this many files - useful for a first smoke run. */
  limit?: number;
  /** Reprocess files already recorded in the workbook. */
  force?: boolean;
}): Promise<SyncResult> {
  const audioFolder =
    options?.audioFolder ?? process.env.ONEDRIVE_AUDIO_FOLDER?.trim();
  const workbookPath =
    options?.workbookPath ?? process.env.ONEDRIVE_WORKBOOK_PATH?.trim();

  if (!audioFolder) {
    throw new Error("ONEDRIVE_AUDIO_FOLDER is not set.");
  }

  if (!workbookPath) {
    throw new Error("ONEDRIVE_WORKBOOK_PATH is not set.");
  }

  const drive = await getDriveProvider();
  const children = await drive.listFolderChildren(audioFolder);
  const audioFiles = children
    .filter((item): item is DriveItem => Boolean(item.file))
    .filter((item) => hasAudioExtension(item.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const existingRows = readExistingRows(await drive.downloadByPath(workbookPath));
  // The Source File column is the dedupe key: a name already in the sheet has
  // been through the pipeline, so a re-run is idempotent by default.
  const alreadyProcessed = new Set(
    existingRows
      .map((row) => String(row[SOURCE_FILE_COLUMN] ?? "").trim())
      .filter(Boolean)
  );

  const results: SyncFileOutcome[] = [];
  const newRows: SheetRow[] = [];
  let filesProcessed = 0;

  for (const item of audioFiles) {
    if (options?.limit && filesProcessed >= options.limit) {
      results.push({
        fileName: item.name,
        status: "skipped",
        reason: `limit of ${options.limit} reached`
      });
      continue;
    }

    if (!options?.force && alreadyProcessed.has(item.name)) {
      results.push({
        fileName: item.name,
        status: "skipped",
        reason: "already in workbook"
      });
      continue;
    }

    try {
      const audioBuffer = await drive.downloadItem(item.id);
      const processed = await processAudioBuffer({
        audioBuffer,
        fileName: item.name
      });
      const processedAt = new Date().toISOString();
      const rows = extractRows(processed.workbookBase64).map((row) => ({
        ...row,
        [SOURCE_FILE_COLUMN]: item.name,
        [PROCESSED_AT_COLUMN]: processedAt
      }));

      newRows.push(...rows);
      filesProcessed += 1;
      results.push({
        fileName: item.name,
        status: "processed",
        rowsAdded: rows.length
      });

      const archiveFolder = process.env.ONEDRIVE_PROCESSED_FOLDER?.trim();

      if (archiveFolder) {
        await drive.moveItem({
          itemId: item.id,
          destinationFolderPath: archiveFolder
        });
      }
    } catch (error) {
      // One bad file must not sink the run - record it and keep going, so a
      // 40-file batch still writes back the 39 that worked.
      const reason =
        error instanceof AudioProcessingError || error instanceof Error
          ? error.message
          : "Unexpected processing error.";

      results.push({ fileName: item.name, status: "failed", reason });
    }
  }

  let workbookUpdated = false;

  if (newRows.length) {
    await drive.uploadByPath({
      path: workbookPath,
      content: buildOutputWorkbook([...existingRows, ...newRows]),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    workbookUpdated = true;
  }

  return {
    provider: drive.name,
    audioFolder,
    workbookPath,
    filesSeen: audioFiles.length,
    filesProcessed,
    rowsAdded: newRows.length,
    workbookUpdated,
    results
  };
}
