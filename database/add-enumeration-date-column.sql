-- Adds the one column genuinely missing for the new Credentialing
-- sub-filters. NPPES_EnumerationType (entity_type) and NPPES_LastUpdated
-- (nppes_last_updated) already exist on providers — only
-- NPPES_EnumerationDate had no column at all.
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS enumeration_date text;
