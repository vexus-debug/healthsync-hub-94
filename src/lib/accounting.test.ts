import { describe, it, expect } from "vitest";
import { invoiceTotals, balanceDue, agingBucket, profitAndLoss, monthRange } from "./accounting";

describe("accounting", () => {
  it("totals items and caps discount at subtotal", () => {
    expect(invoiceTotals([{ quantity: 2, unit_price: 5000 }, { quantity: 1, unit_price: 3000 }], 1000)).toEqual({ subtotal: 13000, discount: 1000, total: 12000 });
    expect(invoiceTotals([{ quantity: 1, unit_price: 500 }], 900).total).toBe(0);
  });
  it("void invoices owe nothing", () => {
    expect(balanceDue({ total: 1000, amount_paid: 400, status: "Partial" })).toBe(600);
    expect(balanceDue({ total: 1000, amount_paid: 0, status: "Void" })).toBe(0);
  });
  it("aging buckets", () => {
    const now = new Date("2026-06-30T00:00:00Z");
    expect(agingBucket("2026-06-10T00:00:00Z", now)).toBe("0-30");
    expect(agingBucket("2026-05-15T00:00:00Z", now)).toBe("31-60");
    expect(agingBucket("2026-01-01T00:00:00Z", now)).toBe("90+");
  });
  it("P&L: reagents are COGS, others opex, void excluded", () => {
    const inv = [
      { subtotal: 10000, discount: 1000, status: "Paid" },
      { subtotal: 5000, discount: 0, status: "Void" },
    ] as any;
    const exp = [{ category: "Reagents & Consumables", amount: 2000 }, { category: "Rent", amount: 3000 }] as any;
    const r = profitAndLoss(inv, [{ amount: 9000 }] as any, exp);
    expect(r).toMatchObject({ netBilled: 9000, collected: 9000, cogs: 2000, opex: 3000, grossMargin: 7000, netProfit: 4000 });
  });
  it("month range", () => {
    expect(monthRange("2026-12")).toMatchObject({ startDate: "2026-12-01", endDate: "2027-01-01" });
  });
});
