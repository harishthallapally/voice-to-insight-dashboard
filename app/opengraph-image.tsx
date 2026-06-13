import { ImageResponse } from "next/og";

export const alt = "AI voice to insights dashboard";
export const size = {
  width: 1200,
  height: 630
};
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          color: "#14213d",
          padding: "56px 64px",
          fontFamily: "Arial, sans-serif",
          border: "14px solid #183883"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 116,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #183883",
              borderRadius: 10,
              color: "#183883",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: 1
            }}
          >
            TVS
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#183883" }}>
            AI voice to insights dashboard
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 980 }}>
          <div style={{ fontSize: 64, lineHeight: 1.05, fontWeight: 800 }}>
            Voice conversations into structured business insight.
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.35, color: "#5a6470" }}>
            Upload audio, transcribe in English, extract key fields, and export Excel-ready rows.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: 22, color: "#183883", fontWeight: 700 }}>
            TVS Motor Company
          </div>
          <div style={{ fontSize: 20, color: "#5a6470" }}>
            AI-powered voice-to-insight workflow
          </div>
        </div>
      </div>
    ),
    {
      ...size
    }
  );
}
