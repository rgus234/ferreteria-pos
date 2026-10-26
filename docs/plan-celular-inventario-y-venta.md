# Plan: Nexo que aprende cómo das de alta tus productos + celular como herramienta de inventario y venta

Escrito el 2026-10-26 (solo planeación, nada construido). Pedido de Gustavo: que Nexo aprenda cómo cada ferretería configura sus productos (pijas por bolsa → kilo → pieza, varias medidas), que dar de alta con el celular sea rápido (escanear, nombre, listo), y que vender y hacer inventario desde el celular valgan la pena frente a la computadora.

## 1. El problema, en concreto

1. Cada producto "especial" (pijas, tornillos, clavos, cable) se configura desde cero: se compra por **bolsa/costal/caja**, se vende por **kilo, pieza o bolsa**, con **varias medidas** (1/2, 3/4, 1, 1 1/2). Esa configuración (presentación de compra, factor de conversión, venta suelta, precios por unidad) se repite idéntica en cada medida.
2. El alta en el celular (/dueno) no es rápida: hay que escribir mucho; en la computadora hay que estar parado frente a ella.
3. La venta en el celular existe pero no compite: nadie dice "mejor vendo por aquí porque es más rápido".

## 2. Idea central: el inventario es el "entrenamiento"

No hace falta un modelo de IA para empezar. Nexo ya sabe cómo configuras tus productos porque **ya están guardados**. Para un producto nuevo, se buscan los productos del mismo negocio más parecidos (misma familia de nombre, misma categoría, mismo proveedor/marca) y se **propone copiar su configuración**:

> "Como tus otras pijas: se compra por bolsa de 100 piezas, se vende por pieza y por kilo. ¿Usar esta configuración?"

- Siempre es una **sugerencia**; nunca se escribe sola. Se muestra de dónde salió ("según 5 productos parecidos").
- Campos que se copian (todos ya existen en `productos`): `unidad_venta`, `presentacion_compra`, `factor_conversion`, `permite_venta_pieza`, `piezas_por_bolsa`, `precio_pieza`, `unidad_suelta`, `bascula_digital`, `stock_minimo`, `categoria`/`subcategoria`/`categoria_nexo_id`, `proveedor_id`, `ubicacion`. **Nunca** se copia: nombre, código, precio de venta, costo, stock.
- Se decide por votación: de los K productos más parecidos, se toma la configuración más repetida y se muestra cuántos la usan.
- Sirve igual en computadora y celular (mismo endpoint).

Más adelante (fase 6) se agrega un paso de IA: "Nexo, agrega pijas de 1 pulgada a 85 pesos la bolsa" → arma el borrador usando esta misma sugerencia.

## 3. Fases (en orden de valor / riesgo)

**Fase 0 — Auditoría (medio día, sin código nuevo).** Leer `public/dueno-inventario.js`, el flujo actual de alta en celular y en computadora, y la venta móvil de `public/dueno.js`. Contar toques/campos de un alta y de una venta típica. Decidir con datos qué se rediseña.

**Fase 1 — Motor de sugerencias de alta.** `GET /productos/sugerencia-alta?nombre=&categoria=&proveedor=&codigo=` → configuración sugerida + productos de evidencia + confianza. Reglas: similitud de nombre (palabras de la familia, `pg_trgm`), misma categoría Nexo, mismo proveedor. Con pruebas. En "Agregar producto" de la computadora aparece la tarjeta "Como tus otras pijas…". Detrás de un flag por negocio mientras se prueba (Olímpico está en producción).

**Fase 2 — Alta rápida en el celular (modo "ir guardando").** Pantalla nueva en /dueno → Inventario:
- Escanear (cámara, ZXing ya integrado) o escribir código → búsqueda en cascada: (a) ya está en tu inventario → editar existencia; (b) catálogo maestro (Truper, Urrea, Open Food Facts, tus capturas) → nombre, marca, categoría y foto del Banco precargados; (c) sugerencia de configuración de la fase 1; (d) desconocido → escribir nombre.
- Una sola tarjeta con 4 campos grandes (nombre, precio, cantidad, y chips con la configuración sugerida "Se compra por bolsa de 100 · Se vende por pieza") y el botón **"Guardar y escanear siguiente"**.
- Cola sin internet (ya existe `dueno-offline.js`).
- Referencia de ritmo: el escáner privado "Capturar códigos" (escanear → nombre → listo).

**Fase 3 — Familias y variantes ("agrega todas las medidas").** Desde un producto o desde la sugerencia: "Agregar varias medidas": escribes la base ("Pija punta broca") y una lista de medidas con precio (1/2, 3/4, 1, 1 1/2); Nexo crea N productos con la misma configuración, nombres consistentes ("Pija punta broca 3/4") y códigos internos generados. Funciona en computadora y celular. Reusa el formato de nombres que ya usamos en PVC y las secciones de etiquetas.

**Fase 4 — Inventario por conteo en el celular.** Escanear → contar → diferencia → ajuste en lote con registro (historial de ajustes ya existe). Conteo por estante/ubicación, con resumen "faltan 12, sobran 3" antes de aplicar. Soporta venta suelta (kilos/piezas).

**Fase 5 — Venta móvil que valga la pena.** Primero medir (fase 0), después rediseñar con una meta numérica: venta común en **≤ 4 toques**. Ideas ya probadas en otras partes: escaneo continuo que agrega al carrito, favoritos y exhibidores a un toque, teclado de cantidad, búsqueda por palabras sueltas (ya está), cobro en efectivo con cambio en un toque, fiado rápido, ticket digital con QR, ventas sin internet (ya existe).

**Fase 6 — "Dile a Nexo".** Voz/texto con Nexo IA: "agrega pijas de 1 pulgada a 85 la bolsa" → borrador con la configuración sugerida, tú confirmas. Solo después de que las fases 1–3 funcionen sin IA.

## 4. Reglas para no romper producción

- Todo lo nuevo detrás de un flag por negocio; Olímpico lo recibe al final y con aviso.
- Las sugerencias nunca escriben solas ni pisan valores existentes.
- El aprendizaje es **por negocio**. Nada se comparte entre negocios en esta etapa (un "forma de venta típica por categoría" global se evalúa después, solo con datos agregados y anónimos).
- Cada fase con pruebas (el servidor de pruebas comparte la base de datos real: usar `NEXO_PRUEBAS` y negocios `test-auto-*`).
- Subir el `CACHE_NAME` de `dueno-sw.js` en cada cambio del celular.

## 5. Decisiones que necesito de Gustavo

1. ¿Empezamos por **alta rápida en el celular** (fases 1+2) o por **conteo de inventario** (fase 4)? Recomendación: 1+2 primero, porque 3 y 4 se apoyan en eso.
2. Producto piloto para probar la sugerencia: **pijas/tornillos** (los más enredados). ¿Cuántas medidas y presentaciones reales tiene Olímpico para tenerlo de caso de prueba?
3. Venta por kilo de piezas sueltas (pijas): ¿se pesa en báscula o se calcula con "piezas por kilo"? Define cómo se guarda la conversión.
4. ¿El alta y el conteo en celular son solo para el dueño o también para empleados (permisos)?
5. ¿Qué es lo que hoy más te estorba al vender desde el celular? (para la fase 5: 2 o 3 situaciones concretas).
