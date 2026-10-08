-- Stores the NPPES authorized official name and credential for Practice Detail.
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS auth_official_name text;