
CREATE TABLE public.audience_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  segment_id UUID NOT NULL REFERENCES public.contact_segments(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (segment_id, phone)
);

CREATE INDEX idx_audience_contacts_tenant ON public.audience_contacts(tenant_id);
CREATE INDEX idx_audience_contacts_segment ON public.audience_contacts(segment_id);

ALTER TABLE public.audience_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on audience_contacts"
  ON public.audience_contacts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Tenant users can view own audience contacts"
  ON public.audience_contacts FOR SELECT TO authenticated
  USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE POLICY "Active tenant users can insert audience contacts"
  ON public.audience_contacts FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

CREATE POLICY "Active tenant users can update audience contacts"
  ON public.audience_contacts FOR UPDATE TO authenticated
  USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

CREATE POLICY "Tenant users can delete own audience contacts"
  ON public.audience_contacts FOR DELETE TO authenticated
  USING (is_user_tenant(tenant_id) OR is_super_admin());

CREATE TRIGGER update_audience_contacts_updated_at
  BEFORE UPDATE ON public.audience_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
