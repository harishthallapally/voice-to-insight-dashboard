export type ExtractionRow = {
  speaker: string;
  timestamp: string;
  topic: string;
  customerName: string;
  company: string;
  email: string;
  phone: string;
  sentiment: string;
  notes: string;
  nextStep: string;
  rating: string;
  actionItems: string;
};

export const excelColumns: Array<keyof ExtractionRow> = [
  "speaker",
  "topic",
  "customerName",
  "sentiment",
  "notes",
  "rating",
  "nextStep"
];
