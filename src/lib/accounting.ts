export const DEPARTMENTS = ["Haematology", "Chemical Pathology", "Microbiology", "Urinalysis", "Serology", "Imaging & Scans", "Pharmacy", "Shop", "Consultation", "Other"] as const;
export const PAYMENT_METHODS = ["Cash", "POS", "Transfer", "HMO"] as const;
export const EXPENSE_CATEGORIES = [
  "Reagents & Consumables", "Equipment & Maintenance", "Utilities & Fuel",
  "Waste Disposal & Compliance", "Salaries & Staff", "Rent", "Logistics & Courier", "Administrative", "Other",
] as const;
/** Categories counted as direct cost of tests (COGS) in the P&L. */
export const COGS_CATEGORIES = ["Reagents & Consumables"];

export interface Invoice {
  id: string; invoice_number: string; patient_name: string; patient_phone: string | null;
  source: string; reference: string | null; subtotal: number; discount: number; total: number;
  amount_paid: number; status: string; notes: string | null; created_at: string;
  invoice_items?: InvoiceItem[]; payments?: Payment[];
}
export interface InvoiceItem { id?: string; description: string; department: string; quantity: number; unit_price: number }
export interface Payment { id: string; invoice_id: string; amount: number; method: string; reference: string | null; created_at: string }
export interface Expense { id: string; expense_number: string; category: string; vendor: string | null; description: string | null; amount: number; method: string; expense_date: string }

export const naira = (n: number) => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function invoiceTotals(items: Pick<InvoiceItem, "quantity" | "unit_price">[], discount: number) {
  const subtotal = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
  const d = Math.min(Math.max(Number(discount || 0), 0), subtotal);
  return { subtotal, discount: d, total: subtotal - d };
}

export const balanceDue = (inv: Pick<Invoice, "total" | "amount_paid" | "status">) =>
  inv.status === "Void" ? 0 : Math.max(Number(inv.total) - Number(inv.amount_paid), 0);

export function agingBucket(createdAt: string, now = new Date()): "0-30" | "31-60" | "61-90" | "90+" {
  const days = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86400000);
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export function profitAndLoss(invoices: Invoice[], payments: Payment[], expenses: Expense[]) {
  const live = invoices.filter((i) => i.status !== "Void");
  const gross = live.reduce((s, i) => s + Number(i.subtotal), 0);
  const discounts = live.reduce((s, i) => s + Number(i.discount), 0);
  const netBilled = gross - discounts;
  const collected = payments.reduce((s, p) => s + Number(p.amount), 0);
  const cogs = expenses.filter((e) => COGS_CATEGORIES.includes(e.category)).reduce((s, e) => s + Number(e.amount), 0);
  const opex = expenses.filter((e) => !COGS_CATEGORIES.includes(e.category)).reduce((s, e) => s + Number(e.amount), 0);
  const grossMargin = netBilled - cogs;
  const netProfit = grossMargin - opex;
  return { gross, discounts, netBilled, collected, cogs, opex, grossMargin, netProfit };
}

export function sumBy<T>(rows: T[], key: (r: T) => string, val: (r: T) => number) {
  const m: Record<string, number> = {};
  for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + val(r);
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(Date.UTC(y!, m! - 1, 1));
  const end = new Date(Date.UTC(y!, m!, 1));
  return { start: start.toISOString(), end: end.toISOString(), startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
