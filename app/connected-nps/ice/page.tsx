import type { Metadata } from "next";

import { ConnectedNpsDashboard } from "@/components/connected-nps-dashboard";

export const metadata: Metadata = {
  title: "ICE Performance"
};

// ICE-only view. Scoping the dashboard to a fuel type keeps the two reports
// genuinely separate: EV workbooks dropped here are ignored rather than
// blended into the ICE totals. The EV page will mirror this with fuel="EV".
export default function ConnectedNpsIcePage() {
  return <ConnectedNpsDashboard fuel="ICE" title="ICE Performance" />;
}
