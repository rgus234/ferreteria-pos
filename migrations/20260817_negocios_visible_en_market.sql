-- Nexo Market no distinguia entre negocios reales y negocios de
-- prueba/demo (creados para capturas de Play Store y pruebas de
-- catalogo, ver fases PLAY1 y CAT-PDF1) -- ambos pasaban el mismo
-- filtro que un negocio real (estado='activo' + sitio_web_config.activo)
-- y terminaban mezclados con inventario real en busqueda, "Ofertas del
-- dia" y el directorio de ferreterias, con boton "Agregar al carrito"
-- funcional. Un cliente real podia comprarle a una tienda que no
-- existe. Esta columna es el unico punto de filtro (tiendasPermitidasMarket
-- en market-server.js), asi que cubre toda superficie publica de
-- Market de una vez.

ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS visible_en_market BOOLEAN NOT NULL DEFAULT true;

-- Los 2 negocios de demo/prueba conocidos hoy -- quedan fuera de Market
-- pero siguen existiendo (su URL directa /market/ferreteria/:slug sigue
-- funcionando para quien ya la tenga, solo dejan de aparecer en
-- busqueda/ofertas/directorio).
UPDATE public.negocios
SET visible_en_market = false
WHERE slug IN ('ferreteria-demo-nexo', 'demo-tornillo-feliz');
