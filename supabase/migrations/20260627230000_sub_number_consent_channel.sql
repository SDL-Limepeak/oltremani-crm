-- membership_number: YYXXXXX per-year progressive
ALTER TABLE public.membership_subscription
  ADD COLUMN IF NOT EXISTS membership_number text UNIQUE;

-- allow 'revoked' status
ALTER TABLE public.membership_subscription
  DROP CONSTRAINT IF EXISTS membership_subscription_status_check;
ALTER TABLE public.membership_subscription
  ADD CONSTRAINT membership_subscription_status_check
    CHECK (status IN ('active','inactive','revoked'));

-- privacy_consent: operator + channel
ALTER TABLE public.privacy_consent
  ADD COLUMN IF NOT EXISTS operator_id uuid REFERENCES public.res_users(id) ON DELETE SET NULL;
ALTER TABLE public.privacy_consent
  ADD COLUMN IF NOT EXISTS channel text;

-- Function: generate next membership number for a given year
-- Returns e.g. "2600001" for year 2026, first card
CREATE OR REPLACE FUNCTION public.generate_membership_number(p_year int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq int;
BEGIN
  SELECT COALESCE(
    MAX(CAST(SUBSTR(membership_number, 3) AS int)), 0
  ) + 1
  INTO v_seq
  FROM membership_subscription
  WHERE year = p_year
    AND membership_number IS NOT NULL
    AND LENGTH(membership_number) = 7;

  RETURN RIGHT(CAST(p_year AS text), 2) || LPAD(CAST(v_seq AS text), 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_membership_number(int) TO authenticated;
