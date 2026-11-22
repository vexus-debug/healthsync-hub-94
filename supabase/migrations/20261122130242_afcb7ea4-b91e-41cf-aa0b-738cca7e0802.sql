REVOKE EXECUTE ON FUNCTION public.recalc_invoice() FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS invoice_items_invoice_idx ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS payments_invoice_idx ON public.payments(invoice_id);