
-- Add email and initial_password to profiles for credential visibility
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS initial_password text;

-- Add assigned_to column to customers for executive assignment
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS assigned_to uuid;
