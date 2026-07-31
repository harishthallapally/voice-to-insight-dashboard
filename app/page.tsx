import { AuthGate } from "@/components/auth-gate";

export default function HomePage() {
  return (
    <main className="page-shell">
      <AuthGate />
    </main>
  );
}
