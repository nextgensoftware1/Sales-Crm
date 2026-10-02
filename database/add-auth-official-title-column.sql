-- Stores the NPPES authorized official title imported from lead CSV files.
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS auth_official_title text;