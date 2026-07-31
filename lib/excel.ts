import * as XLSX from "xlsx";

import { resolveDriverHierarchy } from "@/lib/driver-taxonomy";
import { excelColumns, type ExtractionRow } from "@/lib/types";

function normalizeVehicleTerms(value: string) {
  return value
    .replace(/\bcars\b/gi, "two wheelers")
    .replace(/\bcar\b/gi, "two wheeler");
}

export function buildWorkbook(rows: ExtractionRow[], transcript: string) {
  const worksheetRows = rows.map((row) => {
    const hierarchy = resolveDriverHierarchy(row);

    return {
      Speaker: normalizeVehicleTerms(row.speaker),
      Topic: normalizeVehicleTerms(row.topic),
      "Customer Name": normalizeVehicleTerms(row.customerName),
      Sentiement: normalizeVehicleTerms(row.sentiment),
      Transcription: normalizeVehicleTerms(row.transcription),
      Notes: normalizeVehicleTerms(row.notes),
      "L3 Driver": normalizeVehicleTerms(row.l3Driver),
      "L2 Driver": normalizeVehicleTerms(hierarchy.l2Driver),
      "L1 Driver": normalizeVehicleTerms(hierarchy.l1Driver),
      Rating: normalizeVehicleTerms(row.rating),
      "Next Step": normalizeVehicleTerms(row.nextStep)
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(worksheetRows, {
    header: [
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
    ]
  });

  const summaryWorksheet = XLSX.utils.aoa_to_sheet([
    ["Transcription Summary"],
    [normalizeVehicleTerms(transcript.trim())]
  ]);
  summaryWorksheet["!cols"] = [{ wch: 120 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Conversation Data");
  XLSX.utils.book_append_sheet(
    workbook,
    summaryWorksheet,
    "Transcription Summary"
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
