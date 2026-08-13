import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";

export function DashboardPage() {
  const { user } = useAuth();

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold text-gray-900">Welcome back, {user?.name}</h1>
      <p className="mt-2 text-gray-600">
        Stock value, low-stock alerts, and recent activity will appear here once the
        dashboard endpoints ship (see docs/PRD.md, Day 6).
      </p>
    </AppShell>
  );
}
