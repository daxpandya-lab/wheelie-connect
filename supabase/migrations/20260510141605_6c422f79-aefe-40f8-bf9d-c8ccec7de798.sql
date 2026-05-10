
-- 1. Tag each flow with its purpose so it can auto-link to the correct tab
ALTER TABLE public.chatbot_flows
  ADD COLUMN IF NOT EXISTS flow_type text NOT NULL DEFAULT 'custom';

CREATE INDEX IF NOT EXISTS idx_chatbot_flows_tenant_type
  ON public.chatbot_flows (tenant_id, flow_type);

-- 2. Master templates table (tenant-agnostic, super-admin managed)
CREATE TABLE IF NOT EXISTS public.flow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  flow_type text NOT NULL UNIQUE,
  flow_data jsonb NOT NULL,
  language text NOT NULL DEFAULT 'en',
  channel text NOT NULL DEFAULT 'both',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flow_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins manage flow templates" ON public.flow_templates;
CREATE POLICY "Super admins manage flow templates"
  ON public.flow_templates FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Authenticated users can read flow templates" ON public.flow_templates;
CREATE POLICY "Authenticated users can read flow templates"
  ON public.flow_templates FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role full access on flow_templates" ON public.flow_templates;
CREATE POLICY "Service role full access on flow_templates"
  ON public.flow_templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_flow_templates_updated_at ON public.flow_templates;
CREATE TRIGGER update_flow_templates_updated_at
  BEFORE UPDATE ON public.flow_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Clone helper: copies all active master templates into a tenant's flows
CREATE OR REPLACE FUNCTION public.clone_master_flows_for_tenant(_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.chatbot_flows
    (tenant_id, name, description, flow_data, is_active, language, channel, flow_type)
  SELECT
    _tenant_id, ft.name, ft.description, ft.flow_data, true,
    ft.language, ft.channel::conversation_channel, ft.flow_type
  FROM public.flow_templates ft
  WHERE ft.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.chatbot_flows cf
      WHERE cf.tenant_id = _tenant_id AND cf.flow_type = ft.flow_type
    );
END;
$$;

-- 4. Trigger: auto-clone master templates whenever a new tenant is created
CREATE OR REPLACE FUNCTION public.trg_clone_master_flows_on_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.clone_master_flows_for_tenant(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clone_master_flows_after_tenant_insert ON public.tenants;
CREATE TRIGGER clone_master_flows_after_tenant_insert
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_clone_master_flows_on_tenant();
