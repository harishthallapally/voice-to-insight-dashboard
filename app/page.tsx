import { UploadForm } from "@/components/upload-form";

export default function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-header">
          <img
            className="hero-logo"
            src="/tvs-logo.svg"
            alt="TVS logo"
          />
          <h1>AI-Based Voice-to-Insight System for Connected Feature NPS</h1>
        </div>
      </section>

      <UploadForm />
    </main>
  );
}
