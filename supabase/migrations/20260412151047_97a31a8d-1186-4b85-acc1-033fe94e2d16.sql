
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS service_booking_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS test_drive_enabled boolean NOT NULL DEFAULT true;
