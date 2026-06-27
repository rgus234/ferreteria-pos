ALTER TABLE public.licencias
ADD COLUMN IF NOT EXISTS license_key TEXT;

ALTER TABLE public.licencias
ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;

UPDATE public.licencias
SET license_key = 'NXP-' || upper(substr(md5(negocio_id::text || '-' || id::text || '-' || created_at::text), 1, 6)) || '-' ||
                  upper(substr(md5(id::text || '-' || negocio_id::text), 1, 6)) || '-' ||
                  upper(substr(md5(created_at::text || '-' || id::text), 1, 6))
WHERE license_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_licencias_license_key_unique
ON public.licencias (license_key)
WHERE license_key IS NOT NULL;
