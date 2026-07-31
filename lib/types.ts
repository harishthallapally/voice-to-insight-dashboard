export type ExtractionRow = {
  speaker: string;
  timestamp: string;
  topic: string;
  customerName: string;
  company: string;
  email: string;
  phone: string;
  sentiment: string;
  transcription: string;
  notes: string;
  l3Driver: string;
  l2Driver: string;
  l1Driver: string;
  nextStep: string;
  rating: string;
  actionItems: string;
};

export const excelColumns: Array<keyof ExtractionRow> = [
  "speaker",
  "topic",
  "customerName",
  "sentiment",
  "transcription",
  "notes",
  "l3Driver",
  "l2Driver",
  "l1Driver",
  "rating",
  "nextStep"
];
