-- Adds the column needed for the new "NPI Found" category filter.
-- Purely additive — a new nullable text column on `providers`, same
-- convention as the other raw-text provider fields (nppes_sex, at_risk,
-- penalty, etc.). Does not change any existing column, row, or query.
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS record_source text;
