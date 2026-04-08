
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS work_notes text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS parts_required text;
