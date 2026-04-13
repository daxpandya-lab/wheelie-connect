ALTER TABLE public.service_bookings ADD COLUMN booking_source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.test_drive_bookings ADD COLUMN booking_source text NOT NULL DEFAULT 'manual';