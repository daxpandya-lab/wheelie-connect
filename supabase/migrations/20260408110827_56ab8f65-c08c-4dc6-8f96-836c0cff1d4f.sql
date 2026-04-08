
-- WhatsApp message queue status
CREATE TYPE public.wa_message_status AS ENUM ('queued', 'sending', 'sent', 'failed', 'delivered', 'read');
CREATE TYPE public.wa_template_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE public.wa_template_category AS ENUM ('marketing', 'utility', 'authentication');

-- WhatsApp sessions (per-tenant API config)
CREATE TABLE public.whatsapp_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT,
  verify_token TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_webhook_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WhatsApp templates
CREATE TABLE public.whatsapp_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  category wa_template_category NOT NULL DEFAULT 'utility',
  components JSONB NOT NULL DEFAULT '[]',
  status wa_template_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, template_name, language)
);

-- WhatsApp message queue
CREATE TABLE public.whatsapp_message_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.chatbot_conversations(id) ON DELETE SET NULL,
  recipient_phone TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  content TEXT,
  template_name TEXT,
  template_params JSONB DEFAULT '[]',
  status wa_message_status NOT NULL DEFAULT 'queued',
  external_message_id TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_wa_sessions_tenant ON public.whatsapp_sessions(tenant_id);
CREATE INDEX idx_wa_sessions_phone ON public.whatsapp_sessions(phone_number_id);
CREATE INDEX idx_wa_templates_tenant ON public.whatsapp_templates(tenant_id);
CREATE INDEX idx_wa_templates_name ON public.whatsapp_templates(template_name);
CREATE INDEX idx_wa_queue_tenant ON public.whatsapp_message_queue(tenant_id);
CREATE INDEX idx_wa_queue_status ON public.whatsapp_message_queue(status);
CREATE INDEX idx_wa_queue_phone ON public.whatsapp_message_queue(recipient_phone);
CREATE INDEX idx_wa_queue_ext_id ON public.whatsapp_message_queue(external_message_id);

-- RLS
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_queue ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped RLS
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['whatsapp_sessions','whatsapp_templates','whatsapp_message_queue']
  LOOP
    EXECUTE format('CREATE POLICY "Tenant users can view own data" ON public.%I FOR SELECT TO authenticated USING (public.is_user_tenant(tenant_id) OR public.is_super_admin())', tbl);
    EXECUTE format('CREATE POLICY "Tenant users can insert own data" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_user_tenant(tenant_id) OR public.is_super_admin())', tbl);
    EXECUTE format('CREATE POLICY "Tenant users can update own data" ON public.%I FOR UPDATE TO authenticated USING (public.is_user_tenant(tenant_id) OR public.is_super_admin())', tbl);
    EXECUTE format('CREATE POLICY "Tenant users can delete own data" ON public.%I FOR DELETE TO authenticated USING (public.is_user_tenant(tenant_id) OR public.is_super_admin())', tbl);
  END LOOP;
END $$;

-- Service role access for edge functions (webhook)
CREATE POLICY "Service role full access" ON public.whatsapp_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.whatsapp_templates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.whatsapp_message_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Service role on existing chatbot tables for webhook processing
CREATE POLICY "Service role full access" ON public.chatbot_conversations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.chatbot_messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.chatbot_responses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.chatbot_flows FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.customers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.service_bookings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.test_drive_bookings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Updated_at triggers
CREATE TRIGGER update_wa_sessions_updated_at BEFORE UPDATE ON public.whatsapp_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wa_templates_updated_at BEFORE UPDATE ON public.whatsapp_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_wa_queue_updated_at BEFORE UPDATE ON public.whatsapp_message_queue FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
