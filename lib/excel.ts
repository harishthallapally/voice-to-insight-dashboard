import * as XLSX from "xlsx";

import { excelColumns, type ExtractionRow } from "@/lib/types";

function normalizeVehicleTerms(value: string) {
  return value
    .replace(/\bcars\b/gi, "two wheelers")
    .replace(/\bcar\b/gi, "two wheeler");
}

export function buildWorkbook(rows: ExtractionRow[]) {
  const worksheetRows = rows.map((row) => ({
    Speaker: normalizeVehicleTerms(row.speaker),
    Topic: normalizeVehicleTerms(row.topic),
    "Customer Name": normalizeVehicleTerms(row.customerName),
    Sentiement: normalizeVehicleTerms(row.sentiment),
    Notes: normalizeVehicleTerms(row.notes),
    Rating: normalizeVehicleTerms(row.rating),
    "Next Step": normalizeVehicleTerms(row.nextStep)
  }));

  const worksheet = XLSX.utils.json_to_sheet(worksheetRows, {
    header: [
      "Speaker",
      "Topic",
      "Customer Name",
      "Sentiement",
      "Notes",
      "Rating",
      "Next Step"
    ]
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Conversation Data");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
