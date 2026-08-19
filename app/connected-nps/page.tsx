import type { Metadata } from "next";

import { ConnectedNpsDashboard } from "@/components/connected-nps-dashboard";

export const metadata: Metadata = {
  title: "Connected NPS"
};

// Standalone route: /connected-nps
// Static-data replica of the "Connected NPS" report. Kept fully separate
// from the existing upload/home dashboard flow (no shared components,
// styles, or routes are modified).
export default function ConnectedNpsPage() {
  return <ConnectedNpsDashboard />;
}
