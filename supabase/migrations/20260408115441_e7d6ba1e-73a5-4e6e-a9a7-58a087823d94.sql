
-- Add contact fields to tenants table
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS contact_person text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS address text;
