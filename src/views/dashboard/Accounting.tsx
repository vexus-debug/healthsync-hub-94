import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Printer, Wallet, Download, Ban } from "lucide-react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { SITE } from "@/lib/site";
import {
  DEPARTMENTS, PAYMENT_METHODS, EXPENSE_CATEGORIES, naira, invoiceTotals, balanceDue, agingBucket,
  profitAndLoss, sumBy, monthRange, type Invoice, type InvoiceItem, type Payment, type Expense,
} from "@/lib/accounting";

const db = supabase as any;
const thisMonth = () => new Date().toISOString().slice(0, 7);

function useMonthData(ym: string) {
  const r = monthRange(ym);
  return useQuery({
    queryKey: ["accounting", ym],
    queryFn: async () => {
      const [inv, pay, exp, open] = await Promise.all([
        db.from("invoices").select("*, invoice_items(*), payments(*)").gte("created_at", r.start).lt("created_at", r.end).order("created_at", { ascending: false }),
        db.from("payments").select("*").gte("created_at", r.start).lt("created_at", r.end),
        db.from("expenses").select("*").gte("expense_date", r.startDate).lt("expense_date", r.endDate).order("expense_date", { ascending: false }),
        db.from("invoices").select("*").in("status", ["Unpaid", "Partial"]),
      ]);
      for (const x of [inv, pay, exp, open]) if (x.error) throw x.error;
      return { invoices: inv.data as Invoice[], payments: pay.data as Payment[], expenses: exp.data as Expense[], open: open.data as Invoice[] };
    },
  });
}

const statusVariant = (s: string) => (s === "Paid" ? "default" : s === "Void" ? "outline" : s === "Partial" ? "secondary" : "destructive") as any;

function printReceipt(inv: Invoice) {
  const w = window.open("", "_blank", "width=420,height=640");
  if (!w) return;
  const items = (inv.invoice_items ?? []).map((i) => `<tr><td>${i.description}</td><td style="text-align:right">${i.quantity} × ${naira(i.unit_price)}</td></tr>`).join("");
  const pays = (inv.payments ?? []).map((p) => `<tr><td>${new Date(p.created_at).toLocaleDateString()} ${p.method}</td><td style="text-align:right">${naira(p.amount)}</td></tr>`).join("");
  w.document.write(`<html><head><title>${inv.invoice_number}</title><style>body{font-family:sans-serif;font-size:12px;padding:12px;max-width:340px}table{width:100%;border-collapse:collapse}td{padding:3px 0}h2{margin:0}hr{border:0;border-top:1px dashed #999}</style></head><body>
  <h2>${SITE.name ?? "Green Medical Diagnostics"}</h2><div>${SITE.address ?? ""}</div><div>${(SITE.phones ?? []).join(" / ")}</div><hr/>
  <b>Receipt ${inv.invoice_number}</b><div>${new Date(inv.created_at).toLocaleString()}</div><div>Patient: ${inv.patient_name}</div>${inv.reference ? `<div>Ref: ${inv.reference}</div>` : ""}<hr/>
  <table>${items}</table><hr/><table><tr><td>Subtotal</td><td style="text-align:right">${naira(inv.subtotal)}</td></tr><tr><td>Discount</td><td style="text-align:right">-${naira(inv.discount)}</td></tr><tr><td><b>Total</b></td><td style="text-align:right"><b>${naira(inv.total)}</b></td></tr></table><hr/>
  <table>${pays}</table><table><tr><td><b>Balance due</b></td><td style="text-align:right"><b>${naira(balanceDue(inv))}</b></td></tr></table><hr/><div style="text-align:center">Status: ${inv.status} — Thank you</div>
  <script>window.print()</script></body></html>`);
  w.document.close();
}

function exportCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name; a.click();
}

const Kpi = ({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) => (
  <Card><CardContent className="p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className={`text-xl font-bold ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-primary" : ""}`}>{naira(value)}</div>
  </CardContent></Card>
);

function NewInvoiceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [patient, setPatient] = useState(""); const [phone, setPhone] = useState("");
  const [reference, setReference] = useState(""); const [discount, setDiscount] = useState("0");
  const [items, setItems] = useState<InvoiceItem[]>([{ description: "", department: "Haematology", quantity: 1, unit_price: 0 }]);
  const [payNow, setPayNow] = useState("0"); const [method, setMethod] = useState("Cash");
  const t = invoiceTotals(items, Number(discount));
  const reset = () => { setPatient(""); setPhone(""); setReference(""); setDiscount("0"); setPayNow("0"); setItems([{ description: "", department: "Haematology", quantity: 1, unit_price: 0 }]); };

  const save = useMutation({
    mutationFn: async () => {
      const valid = items.filter((i) => i.description.trim() && i.unit_price > 0);
      if (!patient.trim() || !valid.length) throw new Error("Enter patient name and at least one priced item");
      const { data: inv, error } = await db.from("invoices").insert({
        patient_name: patient.trim(), patient_phone: phone || null, reference: reference || null,
        source: reference.startsWith("GM-") ? "test_form" : "walk_in",
        subtotal: t.subtotal, discount: t.discount, total: t.total, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      const ie = await db.from("invoice_items").insert(valid.map((i) => ({ ...i, invoice_id: inv.id })));
      if (ie.error) throw ie.error;
      const amt = Math.min(Number(payNow), t.total);
      if (amt > 0) {
        const pe = await db.from("payments").insert({ invoice_id: inv.id, amount: amt, method, received_by: user?.id });
        if (pe.error) throw pe.error;
      }
    },
    onSuccess: () => { toast({ title: "Invoice created" }); qc.invalidateQueries({ queryKey: ["accounting"] }); reset(); onOpenChange(false); },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const upd = (i: number, patch: Partial<InvoiceItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Patient name</Label><Input value={patient} onChange={(e) => setPatient(e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label>Form / scan serial</Label><Input placeholder="GM-2026-00001" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <Label>Items</Label>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <Input className="col-span-12 sm:col-span-4" placeholder="Test / service" value={it.description} onChange={(e) => upd(i, { description: e.target.value })} />
              <div className="col-span-5 sm:col-span-3">
                <Select value={it.department} onValueChange={(v) => upd(i, { department: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Input className="col-span-2 sm:col-span-1" type="number" min={1} value={it.quantity} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} />
              <Input className="col-span-4 sm:col-span-3" type="number" min={0} placeholder="Price" value={it.unit_price || ""} onChange={(e) => upd(i, { unit_price: Number(e.target.value) })} />
              <Button variant="ghost" size="icon" className="col-span-1" aria-label="Remove item" onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setItems([...items, { description: "", department: "Haematology", quantity: 1, unit_price: 0 }])}><Plus className="h-4 w-4 mr-1" />Add item</Button>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <div><Label>Discount (₦)</Label><Input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          <div><Label>Amount paid now (₦)</Label><Input type="number" min={0} value={payNow} onChange={(e) => setPayNow(e.target.value)} /></div>
          <div><Label>Method</Label>
            <Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
          </div>
        </div>
        <div className="text-right text-sm">Subtotal {naira(t.subtotal)} · Discount {naira(t.discount)} · <b>Total {naira(t.total)}</b></div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Save invoice</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ inv, onClose }: { inv: Invoice | null; onClose: () => void }) {
  const qc = useQueryClient(); const { user } = useAuth();
  const [amount, setAmount] = useState(""); const [method, setMethod] = useState("Cash"); const [ref, setRef] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const a = Number(amount);
      if (!inv || a <= 0) throw new Error("Enter an amount");
      if (a > balanceDue(inv)) throw new Error("Amount is more than the balance due");
      const { error } = await db.from("payments").insert({ invoice_id: inv.id, amount: a, method, reference: ref || null, received_by: user?.id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Payment recorded" }); qc.invalidateQueries({ queryKey: ["accounting"] }); setAmount(""); setRef(""); onClose(); },
    onError: (e: any) => toast({ title: "Could not record payment", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={!!inv} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment — {inv?.invoice_number}</DialogTitle></DialogHeader>
        <p className="text-sm">Balance due: <b>{inv && naira(balanceDue(inv))}</b></p>
        <div><Label>Amount (₦)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>Method</Label><Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
        <div><Label>Reference (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Save payment</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient(); const { user } = useAuth();
  const [f, setF] = useState({ category: "Reagents & Consumables", vendor: "", description: "", amount: "", method: "Cash", expense_date: new Date().toISOString().slice(0, 10) });
  const save = useMutation({
    mutationFn: async () => {
      if (Number(f.amount) <= 0) throw new Error("Enter an amount");
      const { error } = await db.from("expenses").insert({ ...f, amount: Number(f.amount), recorded_by: user?.id });
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Expense saved" }); qc.invalidateQueries({ queryKey: ["accounting"] }); setF({ ...f, vendor: "", description: "", amount: "" }); onOpenChange(false); },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Log expense</DialogTitle></DialogHeader>
        <div><Label>Category</Label><Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Vendor / payee</Label><Input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} /></div>
          <div><Label>Amount (₦)</Label><Input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div><Label>Date</Label><Input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></div>
          <div><Label>Method</Label><Select value={f.method} onValueChange={(v) => setF({ ...f, method: v })}><SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENT_METHODS.filter((m) => m !== "HMO").map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <div><Label>Description</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Save expense</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const Accounting = () => {
  const { profile } = useAuth();
  const isSenior = (profile?.role ?? "").toLowerCase().includes("senior");
  const qc = useQueryClient();
  const [ym, setYm] = useState(thisMonth());
  const [newInv, setNewInv] = useState(false); const [newExp, setNewExp] = useState(false);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useMonthData(ym);

  const today = new Date().toISOString().slice(0, 10);
  const calc = useMemo(() => {
    if (!data) return null;
    const pl = profitAndLoss(data.invoices, data.payments, data.expenses);
    const live = data.invoices.filter((i) => i.status !== "Void");
    const byDept = sumBy(live.flatMap((i) => i.invoice_items ?? []), (it) => it.department, (it) => it.quantity * it.unit_price);
    const byMethod = sumBy(data.payments, (p) => p.method, (p) => Number(p.amount));
    const byExp = sumBy(data.expenses, (e) => e.category, (e) => Number(e.amount));
    const todays = data.payments.filter((p) => p.created_at.slice(0, 10) === today);
    const tillToday = sumBy(todays, (p) => p.method, (p) => Number(p.amount));
    const aging: Record<string, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    for (const i of data.open) aging[agingBucket(i.created_at)] += balanceDue(i);
    const receivable = Object.values(aging).reduce((a, b) => a + b, 0);
    return { pl, byDept, byMethod, byExp, tillToday, aging, receivable };
  }, [data, today]);

  const voidInv = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("invoices").update({ status: "Void" }).eq("id", id); if (error) throw error; },
    onSuccess: () => { toast({ title: "Invoice voided" }); qc.invalidateQueries({ queryKey: ["accounting"] }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const delExp = useMutation({
    mutationFn: async (id: string) => { const { error } = await db.from("expenses").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounting"] }),
  });

  const filtered = (data?.invoices ?? []).filter((i) => `${i.invoice_number} ${i.patient_name} ${i.reference ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <DashboardLayout>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Accounting</h1>
          <p className="text-sm text-muted-foreground">Invoices, payments, expenses and monthly profit & loss.</p>
        </div>
        <div className="flex gap-2 items-end">
          <div><Label htmlFor="month">Month</Label><Input id="month" type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></div>
          <Button onClick={() => setNewInv(true)}><Plus className="h-4 w-4 mr-1" />New invoice</Button>
          {isSenior && <Button variant="outline" onClick={() => setNewExp(true)}><Plus className="h-4 w-4 mr-1" />Log expense</Button>}
        </div>
      </div>

      {error && <p className="text-destructive">{(error as Error).message}</p>}
      {isLoading || !calc || !data ? <p>Loading…</p> : (
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
            <TabsTrigger value="till">Today's till</TabsTrigger>
            <TabsTrigger value="debtors">Debtors</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Net billed revenue" value={calc.pl.netBilled} />
              <Kpi label="Cash collected" value={calc.pl.collected} tone="good" />
              <Kpi label="Total expenses" value={calc.pl.cogs + calc.pl.opex} tone="bad" />
              <Kpi label="Net profit" value={calc.pl.netProfit} tone={calc.pl.netProfit >= 0 ? "good" : "bad"} />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Card><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">Profit & Loss — {ym}</CardTitle>
                <Button size="sm" variant="outline" onClick={() => exportCsv(`pnl-${ym}.csv`, [["Line", "Amount"], ["Gross revenue", calc.pl.gross], ["Discounts", -calc.pl.discounts], ["Net revenue", calc.pl.netBilled], ["Cost of tests (reagents)", -calc.pl.cogs], ["Gross margin", calc.pl.grossMargin], ["Operating expenses", -calc.pl.opex], ["Net profit", calc.pl.netProfit], ["Cash collected", calc.pl.collected]])}><Download className="h-4 w-4 mr-1" />CSV</Button>
              </CardHeader>
                <CardContent><Table><TableBody>
                  {[["Gross revenue", calc.pl.gross], ["Less discounts", -calc.pl.discounts], ["Net revenue", calc.pl.netBilled, true], ["Less cost of tests (reagents)", -calc.pl.cogs], ["Gross margin", calc.pl.grossMargin, true], ["Less operating expenses", -calc.pl.opex], ["Net profit", calc.pl.netProfit, true]].map(([l, v, b]) => (
                    <TableRow key={l as string}><TableCell className={b ? "font-bold" : ""}>{l}</TableCell><TableCell className={`text-right ${b ? "font-bold" : ""}`}>{naira(v as number)}</TableCell></TableRow>
                  ))}
                </TableBody></Table></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Revenue by department</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {calc.byDept.length === 0 && <p className="text-sm text-muted-foreground">No invoices this month.</p>}
                  {calc.byDept.map(([d, v]) => (
                    <div key={d}><div className="flex justify-between text-sm"><span>{d}</span><span>{naira(v)}</span></div>
                      <div className="h-2 bg-muted rounded"><div className="h-2 bg-primary rounded" style={{ width: `${calc.pl.gross ? (v / calc.pl.gross) * 100 : 0}%` }} /></div></div>
                  ))}
                </CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Collections by method</CardTitle></CardHeader>
                <CardContent><Table><TableBody>{calc.byMethod.map(([m, v]) => <TableRow key={m}><TableCell>{m}</TableCell><TableCell className="text-right">{naira(v)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Expenses by category</CardTitle></CardHeader>
                <CardContent><Table><TableBody>{calc.byExp.map(([m, v]) => <TableRow key={m}><TableCell>{m}</TableCell><TableCell className="text-right">{naira(v)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="invoices" className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="Search invoice, patient or serial" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="outline" onClick={() => exportCsv(`invoices-${ym}.csv`, [["Invoice", "Date", "Patient", "Reference", "Total", "Paid", "Balance", "Status"], ...data.invoices.map((i) => [i.invoice_number, i.created_at.slice(0, 10), i.patient_name, i.reference ?? "", i.total, i.amount_paid, balanceDue(i), i.status])])}><Download className="h-4 w-4 mr-1" />CSV</Button>
            </div>
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Patient</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Balance</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No invoices this month.</TableCell></TableRow>}
                {filtered.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell><div className="font-medium">{i.invoice_number}</div><div className="text-xs text-muted-foreground">{new Date(i.created_at).toLocaleDateString()}{i.reference ? ` · ${i.reference}` : ""}</div></TableCell>
                    <TableCell>{i.patient_name}</TableCell>
                    <TableCell className="text-right">{naira(i.total)}</TableCell>
                    <TableCell className="text-right">{naira(balanceDue(i))}</TableCell>
                    <TableCell><Badge variant={statusVariant(i.status)}>{i.status}</Badge></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {balanceDue(i) > 0 && <Button size="sm" variant="outline" onClick={() => setPayFor(i)}><Wallet className="h-4 w-4 mr-1" />Pay</Button>}
                      <Button size="icon" variant="ghost" aria-label="Print receipt" onClick={() => printReceipt(i)}><Printer className="h-4 w-4" /></Button>
                      {isSenior && i.status !== "Void" && <Button size="icon" variant="ghost" aria-label="Void invoice" onClick={() => confirm("Void this invoice?") && voidInv.mutate(i.id)}><Ban className="h-4 w-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </TabsContent>

          <TabsContent value="expenses">
            <div className="overflow-x-auto"><Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Category</TableHead><TableHead>Vendor / details</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {data.expenses.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No expenses this month.</TableCell></TableRow>}
                {data.expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.expense_date}</TableCell><TableCell>{e.category}</TableCell>
                    <TableCell>{e.vendor}<div className="text-xs text-muted-foreground">{e.description}</div></TableCell>
                    <TableCell className="text-right">{naira(e.amount)}</TableCell>
                    <TableCell>{isSenior && <Button size="icon" variant="ghost" aria-label="Delete expense" onClick={() => confirm("Delete this expense?") && delExp.mutate(e.id)}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></div>
          </TabsContent>

          <TabsContent value="till">
            <Card><CardHeader><CardTitle className="text-base">Collected today ({today})</CardTitle></CardHeader>
              <CardContent>
                {ym !== thisMonth() && <p className="text-sm text-muted-foreground mb-2">Switch to the current month to see today's till.</p>}
                <Table><TableBody>
                  {PAYMENT_METHODS.map((m) => <TableRow key={m}><TableCell>{m}</TableCell><TableCell className="text-right">{naira(calc.tillToday.find(([k]) => k === m)?.[1] ?? 0)}</TableCell></TableRow>)}
                  <TableRow><TableCell className="font-bold">Total</TableCell><TableCell className="text-right font-bold">{naira(calc.tillToday.reduce((s, [, v]) => s + v, 0))}</TableCell></TableRow>
                </TableBody></Table>
                <p className="text-xs text-muted-foreground mt-2">Count the cash drawer and compare with the Cash line before closing.</p>
              </CardContent></Card>
          </TabsContent>

          <TabsContent value="debtors" className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Kpi label="Total owed" value={calc.receivable} tone="bad" />
              {Object.entries(calc.aging).map(([k, v]) => <Kpi key={k} label={`${k} days`} value={v} />)}
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Patient</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Balance</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{data.open.map((i) => (
                <TableRow key={i.id}><TableCell>{i.invoice_number}</TableCell><TableCell>{i.patient_name}<div className="text-xs text-muted-foreground">{i.patient_phone}</div></TableCell>
                  <TableCell>{agingBucket(i.created_at)} days</TableCell><TableCell className="text-right">{naira(balanceDue(i))}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => setPayFor(i)}>Pay</Button></TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      )}
      <NewInvoiceDialog open={newInv} onOpenChange={setNewInv} />
      <ExpenseDialog open={newExp} onOpenChange={setNewExp} />
      <PaymentDialog inv={payFor} onClose={() => setPayFor(null)} />
    </DashboardLayout>
  );
};

export default Accounting;
