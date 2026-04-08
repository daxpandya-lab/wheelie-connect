
-- Add city and area to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS area text;

-- Add vehicle_type to vehicles (license_plate already exists as vehicle_number equivalent)
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS vehicle_type text;

-- Add issue_description, estimated_cost, approval_status to service_bookings
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS issue_description text;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS estimated_cost numeric;
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'pending';
ALTER TABLE public.service_bookings ADD COLUMN IF NOT EXISTS quotation_notes text;
