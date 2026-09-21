-- "Cambiar producto" (POST /ventas/:id/cambios) siempre exigia un
-- producto de reemplazo -- no habia forma de solo quitar un producto de
-- la venta y regresar el dinero (o reducir el cargo a credito) sin
-- entregar nada a cambio. Pedido real de Ferreteria Olimpico: un
-- cliente devuelve UN producto de varios que compro y ya no quiere
-- nada mas, no siempre un cambio 1 a 1.
--
-- Se relaja el NOT NULL de las 3 columnas del "lado nuevo" -- quedan en
-- NULL cuando el registro es una devolucion sin reemplazo, para
-- distinguirla de un cambio real (nunca un valor 0/vacio inventado).
-- Aditiva en espiritu: ninguna fila existente cambia de valor, solo se
-- permite que las futuras puedan quedar en NULL.
ALTER TABLE public.cambios_producto
ALTER COLUMN producto_nuevo_nombre DROP NOT NULL,
ALTER COLUMN cantidad_nueva DROP NOT NULL,
ALTER COLUMN precio_nuevo DROP NOT NULL;
