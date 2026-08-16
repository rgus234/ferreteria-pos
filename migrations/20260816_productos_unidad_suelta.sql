-- La venta "por pieza suelta" (permite_venta_pieza/piezas_por_bolsa/
-- precio_pieza) asumia hasta ahora que lo suelto siempre es "pieza" --
-- el modal del POS y el formulario decian literalmente "Bolsa completa"
-- / "Piezas sueltas" sin importar el producto. Eso no sirve para un
-- bulto de cemento que se abre y se vende por kilo (no por pieza
-- entera). unidad_suelta guarda que tan es lo suelto (pieza, kg, litro,
-- metro, gramo...) -- unidad_venta (ya existente, ya flexible: bulto,
-- saco, bolsa, caja...) sigue describiendo el contenedor completo.
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS unidad_suelta TEXT NOT NULL DEFAULT 'pieza';
