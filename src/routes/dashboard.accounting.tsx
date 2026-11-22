import { createFileRoute } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/dashboard/ProtectedRoute";
import AccountingPage from "@/views/dashboard/Accounting";

export const Route = createFileRoute("/dashboard/accounting")({
  head: () => ({
    meta: [
      { title: "Accounting | Green Medical Diagnostics" },
      { name: "description", content: "Invoices, payments, expenses and monthly revenue for the lab." },
      { property: "og:title", content: "Accounting | Green Medical Diagnostics" },
      { property: "og:description", content: "Invoices, payments, expenses and monthly revenue for the lab." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <ProtectedRoute>
      <AccountingPage />
    </ProtectedRoute>
  ),
});
