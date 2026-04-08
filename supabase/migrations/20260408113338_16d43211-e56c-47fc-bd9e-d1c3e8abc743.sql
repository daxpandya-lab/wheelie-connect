
-- Performance indexes for service_bookings
CREATE INDEX IF NOT EXISTS idx_service_bookings_tenant_status ON public.service_bookings (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_service_bookings_tenant_date ON public.service_bookings (tenant_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_service_bookings_tenant_phone ON public.service_bookings (tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_service_bookings_tenant_type ON public.service_bookings (tenant_id, service_type);

-- Performance indexes for leads
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON public.leads (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_source ON public.leads (tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON public.leads (tenant_id, created_at DESC);

-- Performance indexes for customers
CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON public.customers (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_email ON public.customers (tenant_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_name ON public.customers (tenant_id, name);

-- Performance indexes for chatbot tables
CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_tenant_status ON public.chatbot_conversations (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_chatbot_conversations_tenant_phone ON public.chatbot_conversations (tenant_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_conversation ON public.chatbot_messages (conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_tenant ON public.chatbot_messages (tenant_id, sent_at DESC);

-- Performance indexes for campaigns
CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_status ON public.campaigns (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON public.campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_tenant ON public.campaign_recipients (tenant_id, status);

-- Performance indexes for WhatsApp queue
CREATE INDEX IF NOT EXISTS idx_wa_queue_tenant_status ON public.whatsapp_message_queue (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_queue_status_attempts ON public.whatsapp_message_queue (status, attempts) WHERE status IN ('queued', 'sending');

-- Performance indexes for test drives
CREATE INDEX IF NOT EXISTS idx_test_drives_tenant_status ON public.test_drive_bookings (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_test_drives_tenant_date ON public.test_drive_bookings (tenant_id, preferred_date DESC);

-- Performance indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_user ON public.profiles (user_id);

-- Performance indexes for user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant ON public.user_roles (tenant_id);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  tokens integer NOT NULL DEFAULT 10,
  max_tokens integer NOT NULL DEFAULT 10,
  refill_rate integer NOT NULL DEFAULT 1,
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(key)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on rate_limits" ON public.rate_limits FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Rate limit check function (token bucket algorithm)
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _key text,
  _max_tokens integer DEFAULT 60,
  _refill_rate integer DEFAULT 1,
  _window_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row rate_limits%ROWTYPE;
  _now timestamptz := now();
  _elapsed_seconds numeric;
  _new_tokens integer;
BEGIN
  SELECT * INTO _row FROM rate_limits WHERE key = _key FOR UPDATE;
  
  IF NOT FOUND THEN
    INSERT INTO rate_limits (key, tokens, max_tokens, refill_rate, last_refill_at)
    VALUES (_key, _max_tokens - 1, _max_tokens, _refill_rate, _now)
    ON CONFLICT (key) DO NOTHING;
    RETURN true;
  END IF;
  
  _elapsed_seconds := EXTRACT(EPOCH FROM (_now - _row.last_refill_at));
  _new_tokens := LEAST(_max_tokens, _row.tokens + FLOOR(_elapsed_seconds / _window_seconds * _refill_rate * _max_tokens)::integer);
  
  IF _new_tokens < 1 THEN
    UPDATE rate_limits SET tokens = _new_tokens, last_refill_at = _now WHERE key = _key;
    RETURN false;
  END IF;
  
  UPDATE rate_limits SET tokens = _new_tokens - 1, last_refill_at = _now WHERE key = _key;
  RETURN true;
END;
$$;
