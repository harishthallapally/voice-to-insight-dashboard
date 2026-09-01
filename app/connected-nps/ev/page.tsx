import type { Metadata } from "next";

import { ConnectedNpsDashboard } from "@/components/connected-nps-dashboard";

export const metadata: Metadata = {
  title: "EV Performance"
};

// EV-only view, mirroring /connected-nps/ice. Scoping to a fuel type keeps the
// two reports separate: ICE workbooks dropped here are ignored rather than
// blended into the EV totals.
export default function ConnectedNpsEvPage() {
  return <ConnectedNpsDashboard fuel="EV" title="EV Performance" />;
}
