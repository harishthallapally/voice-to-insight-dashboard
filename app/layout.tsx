import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "AI voice to insights dashboard",
  description:
    "Upload conversation audio, transcribe it, and export structured rows to Excel.",
  metadataBase: new URL(siteUrl),
  alternates: {
    canonical: siteUrl
  },
  openGraph: {
    title: "AI voice to insights dashboard",
    description: "Upload conversation audio, transcribe it, and export structured rows to Excel.",
    url: siteUrl,
    siteName: "AI voice to insights dashboard",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "AI voice to insights dashboard"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "AI voice to insights dashboard",
    description: "Upload conversation audio, transcribe it, and export structured rows to Excel.",
    images: ["/opengraph-image"]
  }
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
