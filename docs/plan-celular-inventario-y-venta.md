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

---

# Actualización (2026-10-26, mismo día): visión completa y respuestas de Gustavo

## A. Visión

**El celular puede ser la computadora.** Un abarrotes que apenas empieza no tiene computadora ni lector: con el celular debe poder dar de alta inventario, vender y llevar su negocio. Cuando después compre computadora (y todavía no tenga escáner), el celular le sirve de escáner. Todo conectado: lo que se hace en un lado se ve en el otro.

**Alta efectiva, no solo rápida.** Debe capturar *toda* la información que maneja la computadora (presentación de compra, factor de conversión, venta suelta, precios por nivel, categoría, proveedor, ubicación, stock mínimo, caducidad, foto…) pero con una interfaz pensada para el celular:
- **Dos modos:** *Esencial* (nombre, precio, cantidad: 3 campos, el resto ya sugerido) y *Completo* (todas las secciones). Mismo producto, mismos datos; solo cambia cuánto se muestra.
- **Secciones colapsables en tarjetas** (Identidad · Cómo lo compras y lo vendes · Precios · Existencias · Más), con un resumen en una línea de cada sección ("Se compra por bolsa de 100 · se vende por kilo"), para entender de un vistazo sin entrar a cada una.
- **Lo visual cuenta:** foto grande (del Banco o con la cámara), chips de colores para la configuración, vista previa de "así lo verá el cliente en la venta", validaciones en el momento, y animación/sonido al guardar.

## B. Escáner remoto: celular → computadora

Para negocios con computadora pero sin lector de códigos:
1. En la computadora: botón "Usar mi celular como escáner" → muestra un **código QR** de emparejamiento (token corto, vence en minutos).
2. En el celular: se escanea el QR → abre la pantalla de cámara de Nexo, ya vinculada a esa sesión.
3. Cada lectura viaja al servidor (`POST /escaner/sesiones/:id/lecturas`) y la computadora la recibe en vivo (SSE o sondeo corto) y la **inyecta donde esté el cursor**: agrega al carrito en Vender, llena el código en Agregar producto, cuenta en Conteo.
4. Indicador visible en ambos lados ("Celular conectado ✓"), desconexión con un toque, y la sesión se liga al negocio autenticado (no se puede escanear hacia otro negocio).
Es la misma tecnología que "Capturar códigos" (cámara con ZXing, que ya funciona en iPhone) más un canal en vivo.

## C. Reacomodar y rediseñar la app del celular

Hoy /dueno acumula funciones (Más → Mi tienda, Exhibidores, Capturar códigos, Créditos, Caja…). Propuesta:
- **Una arquitectura de información clara:** barra inferior con 5 destinos fijos (Inicio · Vender · Inventario · Clientes/Créditos · Más) y todo lo demás agrupado por tarea dentro de ellos, no como una lista suelta en "Más". Los atajos frecuentes (escanear, nuevo producto) como botón flotante central.
- **Sistema de diseño único** (tipografía, colores Nexo, tarjetas, botones, estados vacíos, toasts, hojas inferiores) compartido con la computadora para que se sienta la misma app.
- **Conectado:** lo que se hace en el celular se refleja al instante en la computadora y viceversa (mismo dato; solo cambia la presentación). Un "estado de conexión" visible y cola sin internet.
- **Interacción cuidada:** transiciones cortas, hojas que suben desde abajo, feedback inmediato en cada acción.

## D. Lo que hoy más estorba al vender desde el iPhone (navegador / PWA)

1. **El teclado tapa lo que se vende.** Al escribir, el teclado cubre la lista y el cobro.
2. **Escanear no avisa.** Se agrega el producto pero no hay confirmación, y la línea queda hasta abajo; hay que bajar para verla. Se puede seguir escaneando "a ciegas".
3. **La línea del carrito es solo texto**: sin foto, sin precio destacado, sin cantidad cómoda.
4. No se percibe como una experiencia de venta (no se ve el total mientras se agrega).

**Arreglos concretos (Fase A, de bajo riesgo y mucho efecto):**
- **Mini-carrito fijo arriba** (no se tapa con el teclado): cuántas piezas, total y botón Cobrar siempre visibles; el área de captura se ajusta con `visualViewport` cuando sale el teclado.
- **Confirmación al escanear:** tarjeta grande que aparece unos segundos con foto, nombre, precio y cantidad ("Coca-Cola 600 ml · $18 · ×1 ✓") y **sonido corto** (iOS no soporta vibración en Safari); la línea nueva se resalta y el carrito se desplaza solo hasta ella. Si el código no existe, aviso rojo con opción de darlo de alta ahí mismo.
- **Pantalla de escaneo continuo:** cámara arriba, carrito resumido abajo, cantidades con botones grandes; el escaneo de un mismo producto sube la cantidad en lugar de duplicar líneas.
- **Líneas del carrito con foto, nombre, precio, cantidad y subtotal**, deslizar para quitar.
- **Venta por peso en el celular:** para lo que se pesa (pijas por kilo), teclado numérico para capturar el peso leído de la báscula y cálculo del importe; más adelante, báscula Bluetooth.

## E. Respuestas de Gustavo

- **Piloto:** pijas y tornillos; las medidas y presentaciones salen del **catálogo de Truper** (no hay que adivinarlas: se importan de ahí).
- **Pijas por kilo:** se pesan en báscula → venta por peso con captura manual del peso en el celular (y báscula Bluetooth después).
- **Conteo de inventario y alta en el celular:** para **dueño y empleados** (con permisos por rol: el empleado cuenta y da de alta; ajustes grandes y precios, solo quien tenga permiso).
- **Dispositivo:** iPhone, sin app de tienda todavía (Google Play aún no aprueba la solicitud): se usa como **PWA instalada en la pantalla de inicio** de Safari; todo lo diseñado debe funcionar bien así.

## F. Orden recomendado (reemplaza el de la sección 3)

1. **Fase A — Venta móvil: los 4 estorbos** (teclado, confirmación al escanear, mini-carrito fijo, líneas con foto/precio). Rápido, poco riesgo, se nota de inmediato.
2. **Fase B — Auditoría + sistema de diseño y navegación** (la reorganización de /dueno con barra inferior de 5 destinos).
3. **Fase C — Alta efectiva en el celular** (modo Esencial/Completo + sugerencias que aprenden del inventario + escaneo continuo + guardar y seguir) y el mismo motor de sugerencias en la computadora.
4. **Fase D — Escáner remoto celular→computadora** (emparejar por QR).
5. **Fase E — Familias de medidas (desde Truper) y conteo de inventario con empleados.**
6. **Fase F — Venta móvil completa** (peso, fiado, ticket digital, cobro en 1 toque).
7. **Fase G — "Dile a Nexo"** (voz/texto).

## G. Preguntas que siguen abiertas

1. ¿Aprobamos este orden (empezar por la Fase A)?
2. Barra inferior de 5 destinos: ¿Inicio · Vender · Inventario · Clientes · Más es la mezcla correcta, o prefieres otros?
3. En abarrotes sin computadora: ¿qué más necesita hacer el dueño solo con el celular el primer día? (corte de caja, compras a proveedor, fiado, reportes)
4. Permisos: ¿el empleado puede cambiar precios al dar de alta o solo capturar existencias y que el dueño confirme?
