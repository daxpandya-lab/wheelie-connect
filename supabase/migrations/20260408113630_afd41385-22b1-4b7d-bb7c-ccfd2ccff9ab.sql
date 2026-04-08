
-- Function to check if the user's tenant is active (not suspended/cancelled)
CREATE OR REPLACE FUNCTION public.is_tenant_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
    JOIN public.profiles p ON p.tenant_id = t.id
    WHERE p.user_id = auth.uid()
      AND t.status = 'active'
  )
$$;

-- Function to check if a specific tenant is active
CREATE OR REPLACE FUNCTION public.is_tenant_id_active(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants
    WHERE id = _tenant_id AND status = 'active'
  )
$$;

-- Lock down profiles INSERT to service_role only (trigger handles creation)
CREATE POLICY "Only service role can insert profiles"
  ON public.profiles FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Prevent users from deleting profiles
CREATE POLICY "No profile deletion"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (false);

-- Add tenant active status check to critical data tables
-- Service bookings: only active tenants can insert/update
DROP POLICY IF EXISTS "Tenant users can insert own data" ON public.service_bookings;
CREATE POLICY "Active tenant users can insert own data" ON public.service_bookings
  FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can update own data" ON public.service_bookings;
CREATE POLICY "Active tenant users can update own data" ON public.service_bookings
  FOR UPDATE TO authenticated
  USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

-- Leads: only active tenants can insert/update
DROP POLICY IF EXISTS "Tenant users can insert own data" ON public.leads;
CREATE POLICY "Active tenant users can insert own data" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can update own data" ON public.leads;
CREATE POLICY "Active tenant users can update own data" ON public.leads
  FOR UPDATE TO authenticated
  USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

-- Customers: only active tenants can insert/update
DROP POLICY IF EXISTS "Tenant users can insert own data" ON public.customers;
CREATE POLICY "Active tenant users can insert own data" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can update own data" ON public.customers;
CREATE POLICY "Active tenant users can update own data" ON public.customers
  FOR UPDATE TO authenticated
  USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

-- Campaigns: only active tenants can insert/update
DROP POLICY IF EXISTS "Tenant users can insert own data" ON public.campaigns;
CREATE POLICY "Active tenant users can insert own data" ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can update own data" ON public.campaigns;
CREATE POLICY "Active tenant users can update own data" ON public.campaigns
  FOR UPDATE TO authenticated
  USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

-- Chatbot flows: only active tenants can insert/update
DROP POLICY IF EXISTS "Tenant users can insert own data" ON public.chatbot_flows;
CREATE POLICY "Active tenant users can insert own data" ON public.chatbot_flows
  FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

DROP POLICY IF EXISTS "Tenant users can update own data" ON public.chatbot_flows;
CREATE POLICY "Active tenant users can update own data" ON public.chatbot_flows
  FOR UPDATE TO authenticated
  USING ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());

-- WhatsApp message queue: only active tenants
DROP POLICY IF EXISTS "Tenant users can insert own data" ON public.whatsapp_message_queue;
CREATE POLICY "Active tenant users can insert own data" ON public.whatsapp_message_queue
  FOR INSERT TO authenticated
  WITH CHECK ((is_user_tenant(tenant_id) AND is_tenant_id_active(tenant_id)) OR is_super_admin());
