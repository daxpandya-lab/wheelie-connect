
-- Enums for new tables
CREATE TYPE public.service_status AS ENUM ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.conversation_channel AS ENUM ('whatsapp', 'web', 'both');
CREATE TYPE public.conversation_status AS ENUM ('active', 'closed', 'escalated');
CREATE TYPE public.message_sender AS ENUM ('customer', 'bot', 'agent');
CREATE TYPE public.message_type AS ENUM ('text', 'image', 'document', 'template');
CREATE TYPE public.lead_source AS ENUM ('whatsapp', 'web', 'walkin', 'referral', 'campaign');
CREATE TYPE public.lead_status AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');
CREATE TYPE public.campaign_type AS ENUM ('whatsapp', 'sms', 'email');
CREATE TYPE public.campaign_status AS ENUM ('draft', 'scheduled', 'sending', 'sent', 'cancelled');

-- Customers
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vehicles
CREATE TABLE public.vehicles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  make TEXT,
  model TEXT NOT NULL,
  year INT,
  vin TEXT,
  license_plate TEXT,
  kms_driven INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service Bookings
CREATE TABLE public.service_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  kms_driven INT,
  service_type TEXT NOT NULL,
  booking_date DATE NOT NULL,
  preferred_time TEXT,
  status service_status NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_required BOOLEAN DEFAULT false,
  drop_required BOOLEAN DEFAULT false,
  notes TEXT,
  total_amount NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Test Drive Bookings
CREATE TABLE public.test_drive_bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  vehicle_model TEXT NOT NULL,
  preferred_date DATE NOT NULL,
  preferred_time TEXT,
  status service_status NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  follow_up_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chatbot Flows
CREATE TABLE public.chatbot_flows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  flow_data JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  language TEXT NOT NULL DEFAULT 'en',
  channel conversation_channel NOT NULL DEFAULT 'both',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chatbot Conversations
CREATE TABLE public.chatbot_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  channel conversation_channel NOT NULL DEFAULT 'whatsapp',
  phone_number TEXT,
  status conversation_status NOT NULL DEFAULT 'active',
  assigned_agent UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);

-- Chatbot Messages
CREATE TABLE public.chatbot_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.chatbot_conversations(id) ON DELETE CASCADE,
  sender_type message_sender NOT NULL,
  content TEXT NOT NULL,
  message_type message_type NOT NULL DEFAULT 'text',
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chatbot Responses (analytics / tracking)
CREATE TABLE public.chatbot_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.chatbot_conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.chatbot_messages(id) ON DELETE SET NULL,
  flow_id UUID REFERENCES public.chatbot_flows(id) ON DELETE SET NULL,
  intent_detected TEXT,
  confidence_score NUMERIC(5,4),
  response_text TEXT,
  response_time_ms INT,
  was_helpful BOOLEAN,
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Leads
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  source lead_source NOT NULL DEFAULT 'web',
  status lead_status NOT NULL DEFAULT 'new',
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  vehicle_interest TEXT,
  notes TEXT,
  follow_up_date DATE,
  score INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Campaigns
CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type campaign_type NOT NULL DEFAULT 'whatsapp',
  template_id TEXT,
  audience_filter JSONB DEFAULT '{}',
  scheduled_at TIMESTAMPTZ,
  status campaign_status NOT NULL DEFAULT 'draft',
  sent_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  read_count INT DEFAULT 0,
  replied_count INT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===================== INDEXES =====================

-- tenant_id on all tables
CREATE INDEX idx_customers_tenant ON public.customers(tenant_id);
CREATE INDEX idx_vehicles_tenant ON public.vehicles(tenant_id);
CREATE INDEX idx_service_bookings_tenant ON public.service_bookings(tenant_id);
CREATE INDEX idx_test_drive_bookings_tenant ON public.test_drive_bookings(tenant_id);
CREATE INDEX idx_chatbot_flows_tenant ON public.chatbot_flows(tenant_id);
CREATE INDEX idx_chatbot_conversations_tenant ON public.chatbot_conversations(tenant_id);
CREATE INDEX idx_chatbot_messages_tenant ON public.chatbot_messages(tenant_id);
CREATE INDEX idx_chatbot_responses_tenant ON public.chatbot_responses(tenant_id);
CREATE INDEX idx_leads_tenant ON public.leads(tenant_id);
CREATE INDEX idx_campaigns_tenant ON public.campaigns(tenant_id);

-- Service bookings specific
CREATE INDEX idx_service_bookings_date ON public.service_bookings(booking_date);
CREATE INDEX idx_service_bookings_phone ON public.service_bookings(phone_number);
CREATE INDEX idx_service_bookings_status ON public.service_bookings(status);

-- Test drive bookings
CREATE INDEX idx_test_drive_bookings_date ON public.test_drive_bookings(preferred_date);
CREATE INDEX idx_test_drive_bookings_phone ON public.test_drive_bookings(phone_number);

-- Chatbot conversations
CREATE INDEX idx_chatbot_conversations_phone ON public.chatbot_conversations(phone_number);
CREATE INDEX idx_chatbot_conversations_status ON public.chatbot_conversations(status);
CREATE INDEX idx_chatbot_conversations_channel ON public.chatbot_conversations(channel);

-- Chatbot messages
CREATE INDEX idx_chatbot_messages_conversation ON public.chatbot_messages(conversation_id);
CREATE INDEX idx_chatbot_messages_sent ON public.chatbot_messages(sent_at);

-- Chatbot responses
CREATE INDEX idx_chatbot_responses_conversation ON public.chatbot_responses(conversation_id);
CREATE INDEX idx_chatbot_responses_flow ON public.chatbot_responses(flow_id);
CREATE INDEX idx_chatbot_responses_intent ON public.chatbot_responses(intent_detected);

-- Leads
CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_follow_up ON public.leads(follow_up_date);
CREATE INDEX idx_leads_phone ON public.leads(phone_number);

-- Campaigns
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_campaigns_scheduled ON public.campaigns(scheduled_at);

-- Customers
CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE INDEX idx_customers_email ON public.customers(email);

-- Vehicles
CREATE INDEX idx_vehicles_customer ON public.vehicles(customer_id);

-- ===================== RLS =====================

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_drive_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatbot_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Helper: tenant isolation check
CREATE OR REPLACE FUNCTION public.is_user_tenant(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _tenant_id = (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)
$$;

-- Generate tenant-scoped RLS policies for all new tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customers','vehicles','service_bookings','test_drive_bookings',
    'chatbot_flows','chatbot_conversations','chatbot_messages','chatbot_responses',
    'leads','campaigns'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY "Tenant users can view own data" ON public.%I FOR SELECT TO authenticated USING (public.is_user_tenant(tenant_id) OR public.is_super_admin())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Tenant users can insert own data" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_user_tenant(tenant_id) OR public.is_super_admin())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Tenant users can update own data" ON public.%I FOR UPDATE TO authenticated USING (public.is_user_tenant(tenant_id) OR public.is_super_admin())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Tenant users can delete own data" ON public.%I FOR DELETE TO authenticated USING (public.is_user_tenant(tenant_id) OR public.is_super_admin())',
      tbl
    );
  END LOOP;
END
$$;

-- Updated_at triggers for all new tables
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_service_bookings_updated_at BEFORE UPDATE ON public.service_bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_test_drive_bookings_updated_at BEFORE UPDATE ON public.test_drive_bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_chatbot_flows_updated_at BEFORE UPDATE ON public.chatbot_flows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
