CREATE SEQUENCE IF NOT EXISTS public.invoice_seq;
CREATE SEQUENCE IF NOT EXISTS public.expense_seq;

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE DEFAULT ('INV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.invoice_seq')::text,5,'0')),
  patient_name text NOT NULL,
  patient_phone text,
  source text NOT NULL DEFAULT 'walk_in',
  reference text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Unpaid',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
GRANT USAGE ON SEQUENCE public.invoice_seq, public.expense_seq TO authenticated, service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view invoices" ON public.invoices FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Staff create invoices" ON public.invoices FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "Staff update invoices" ON public.invoices FOR UPDATE TO authenticated USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "Seniors delete invoices" ON public.invoices FOR DELETE TO authenticated USING (is_senior_scientist(auth.uid()));
CREATE TRIGGER invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  department text NOT NULL DEFAULT 'Other',
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view items" ON public.invoice_items FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Staff add items" ON public.invoice_items FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "Seniors manage items" ON public.invoice_items FOR DELETE TO authenticated USING (is_senior_scientist(auth.uid()));

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'Cash',
  reference text,
  received_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view payments" ON public.payments FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Staff record payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (is_staff(auth.uid()));
CREATE POLICY "Seniors delete payments" ON public.payments FOR DELETE TO authenticated USING (is_senior_scientist(auth.uid()));

CREATE OR REPLACE FUNCTION public.recalc_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv uuid := COALESCE(NEW.invoice_id, OLD.invoice_id); paid numeric; tot numeric;
BEGIN
  SELECT COALESCE(sum(amount),0) INTO paid FROM payments WHERE invoice_id = inv;
  SELECT total INTO tot FROM invoices WHERE id = inv;
  UPDATE invoices SET amount_paid = paid,
    status = CASE WHEN status = 'Void' THEN 'Void' WHEN paid >= tot AND tot > 0 THEN 'Paid' WHEN paid > 0 THEN 'Partial' ELSE 'Unpaid' END
  WHERE id = inv;
  RETURN NULL;
END $$;
CREATE TRIGGER payments_recalc AFTER INSERT OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice();

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number text NOT NULL UNIQUE DEFAULT ('EXP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.expense_seq')::text,5,'0')),
  category text NOT NULL,
  vendor text,
  description text,
  amount numeric NOT NULL,
  method text NOT NULL DEFAULT 'Cash',
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff view expenses" ON public.expenses FOR SELECT TO authenticated USING (is_staff(auth.uid()));
CREATE POLICY "Seniors manage expenses" ON public.expenses FOR ALL TO authenticated USING (is_senior_scientist(auth.uid())) WITH CHECK (is_senior_scientist(auth.uid()));
CREATE TRIGGER expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();