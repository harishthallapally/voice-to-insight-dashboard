import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audio To Excel Dashboard",
  description: "Upload conversation audio, transcribe it, and export structured rows to Excel."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
