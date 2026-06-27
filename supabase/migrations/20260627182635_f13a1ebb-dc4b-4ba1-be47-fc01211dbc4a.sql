
DROP INDEX IF EXISTS idx_city_name_prov;
ALTER TABLE public.res_city ADD CONSTRAINT res_city_name_prov_uniq UNIQUE (name, province_code);
