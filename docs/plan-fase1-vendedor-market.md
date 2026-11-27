# Fase 1: Vendedor de Market para tiendas físicas

Decisiones (2026-11-25): vende solo un negocio con tienda física; entrega por recolección y entrega local; publicar es gratis y Nexo cobra comisión por venta (6 % hoy); cada vendedor nuevo se aprueba UNA vez; devoluciones las resuelven tienda y comprador, con Nexo como mediador.

Idea: una cuenta con la función `vendedor_market` ve un panel sencillo (Inicio con pasos, Mi mercancía, Pedidos de Market, Mi tienda, Configuración). No ve caja, créditos, reportes ni compras. Todo va detrás de la función (nace apagada, `_todas` no la enciende), igual que "Solo lo necesario", para no tocar a ningún negocio que ya existe.

## Incrementos (cada uno se prueba y se sube por separado)

| # | Incremento | Estado |
|---|-----------|--------|
| A1 | Función `vendedor_market`, menú recortado, Inicio con los 4 pasos | subido |
| A2 | Publicación: pedir publicar, aprobación del vendedor por enlace en correo; no sale en Market hasta aprobar | subido |
| B | Alta pública "Quiero vender en Market" en la página Vende en Nexo (cuenta con la función, oculta hasta aprobar, licencia que no vence) y asistente corto | subido |
| C | Foto propia del producto en Mi mercancía (celular y computadora) | hecho (local) |
| C2 | Panel del vendedor en el celular (/dueno): Inicio con pasos, datos y entrega desde el teléfono, Mercancía, Pedidos, Más | hecho (local) |
| D | Cobros en línea (Stripe Connect) como paso del panel, y Pedidos de Market con su aviso | por revisar |
| E | Reportar un problema (botón del comprador) y aviso a Nexo | por hacer |
| F | Prueba con 2 o 3 tiendas de confianza | por hacer |

## Reglas que no se rompen

- Ningún negocio existente cambia: nada se enciende solo.
- Un vendedor nuevo NO aparece en Market hasta que se apruebe (`negocios.visible_en_market` hoy nace en verdadero: los vendedores nuevos deben nacer en falso).
- Sin punto de venta no hay descuento de existencias por venta de mostrador: el panel lo avisa y ofrece activar el punto de venta.
