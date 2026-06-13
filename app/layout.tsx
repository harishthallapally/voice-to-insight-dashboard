import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI voice to insights dashboard",
  description: "AI voice to insights dashboard"
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