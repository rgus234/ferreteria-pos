ALTER TABLE public.clientes_credito
    ADD COLUMN IF NOT EXISTS nivel_precio_preferido TEXT
    CHECK (nivel_precio_preferido IN ('publico', 'mayoreo', 'distribuidor') OR nivel_precio_preferido IS NULL);
