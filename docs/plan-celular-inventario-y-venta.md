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

---

# Actualización 3 (2026-10-26): estantes escaneables, modo consulta y "que todos tengan la app"

## H. Estantes y pasillos con código (idea de Gustavo)

**Problema:** al dar de alta o contar, a nadie le gusta escribir en qué pasillo/estante queda el producto, así que `ubicacion` queda vacía o desordenada.

**Idea:** crear el **mapa de la tienda** (Pasillo 1 → Estante 1, Estante 2 → niveles) e **imprimir una etiqueta con QR/código de barras por cada lugar**. Al hacer inventario se escanea primero el estante (pip, "Estante 2 · Pasillo 1") y **todo lo que se escanee o dé de alta después se guarda en ese estante**, hasta escanear otro.

**Cómo funcionaría**
- **Datos:** tabla nueva `ubicaciones` (negocio_id, código único, nombre, tipo pasillo/estante/nivel, padre_id, orden) y `productos.ubicacion_id` (nullable). El texto actual `productos.ubicacion` se conserva y se mantiene sincronizado ("Pasillo 1 › Estante 2") para no romper nada de lo que ya hay.
- **Códigos:** prefijo propio (p. ej. `EST-…`) para que nunca se confundan con un código de producto; el escáner reconoce el prefijo y cambia de "contexto" en vez de buscar un producto.
- **Pantalla "Mi tienda → Estantes"** (celular y computadora): crear pasillos y estantes arrastrando, renombrar, ver cuántos productos hay en cada uno, e **imprimir las etiquetas** con el editor de códigos de barras que ya existe (con las *secciones por pasillo* que ya se hicieron, un color por pasillo).
- **Modo estante en alta y conteo:** banner fijo "Guardando en Estante 2" mientras dure; botón "Cambiar" / escanear otro estante.
  - **Alta:** cada producto guardado queda con ese `ubicacion_id`.
  - **Conteo:** al escanear un estante, Nexo lista lo que *debería* estar ahí; al terminar muestra "no escaneaste estos 3" y "estos 2 estaban en otro estante (¿moverlos aquí?)".
- **"¿Dónde está?"**: en Vender, Inventario y Consulta se ve la ubicación de cada producto; en **Surtir** (exhibidores, pedidos) la lista se ordena por pasillo para recorrer la tienda una sola vez.
- **Permisos:** crear/renombrar estantes, solo quien administre; escanear estantes y guardar ahí, también empleados.

## I. Modo consulta (escanear = ver qué es)

Escanear un código desde Inventario sin estar en alta ni en conteo **muestra el producto**: foto, nombre, existencias, ubicación, precios, caducidad y últimas ventas, con atajos "ajustar existencia", "editar" y "imprimir etiqueta". Es el modo por defecto del escáner; los modos Alta, Conteo y Estante se eligen con una barra de chips.

## J. Sugerencia de configuración por familia (el flujo concreto de Gustavo)

Escaneo pijas de 3/4" que no tengo, y ya tengo las de 1":
1. El código no está en mi inventario → se busca en el catálogo maestro (Truper/Urrea/mis capturas): nombre, marca, categoría y foto del Banco.
2. Nexo detecta la **familia** ("Pija punta broca …") y encuentra la de 1" → tarjeta: *"Este producto es como tus pijas de 1 pulgada. ¿Reutilizar su configuración?"* con el resumen: *se compra por bolsa de 100 · se vende por kilo y por pieza · estante 3*.
3. Si acepta, solo hace **preguntas cuando algo es ambiguo** (¿las vendes por kilo o sueltas?, ¿cuántas piezas trae la bolsa?). Lo demás ya queda puesto, incluida la **foto**.
4. Se guarda y el escáner queda listo para el siguiente (con el mismo estante).

## K. Que todos tengan la app

Cada persona de la ferretería (dueño y empleados) entra con su propio usuario y ve solo lo que su rol permite (el control de roles ya existe). Para que sea fácil: invitación por **QR o enlace de WhatsApp** que instala la app (PWA en iPhone, tienda cuando Google Play la apruebe), y **pantalla inicial según el rol** (el empleado de piso cae directo en Escanear/Contar; el dueño en su resumen).

## L. Dónde entra en el orden de fases

Se agrega a la **Fase C** y la **Fase E**:
- **Fase C (alta efectiva):** además del modo Esencial/Completo y las sugerencias, entran el **modo consulta** (I), la **sugerencia por familia** (J) y el **contexto de estante** (H, versión simple: escanear estante → se asigna a lo que se guarda).
- **Fase E (conteo):** el conteo **por estante** con "lo que debería estar" y "lo que no escaneaste".
- **Antes de C:** el **mapa de tienda + etiquetas de estantes** (H) como mini-fase propia, porque alta y conteo dependen de él.

## M. Preguntas nuevas

1. ¿Los estantes tienen **niveles** (repisa alta/media/baja) o basta Pasillo › Estante?
2. ¿Un mismo producto puede estar en **más de un lugar** (bodega y mostrador)? Si sí, hay que contar existencias por ubicación (mucho más trabajo); si no, un lugar por producto (lo recomendado para empezar).
3. ¿Las etiquetas de estante se pegan en el mueble (tamaño grande, QR + nombre en letras grandes)? Con esto defino la plantilla del editor.

---

# Actualización 4 (2026-10-26): de la factura al acomodo (recepción → verificación → acomodo en el celular)

## N. El flujo completo que describe Gustavo

1. **Llega la factura** y se sube en la computadora (XML/CFDI o PDF). Nexo la lee y *detecta* la recepción.
2. **Verificación con escaneo.** Llega la mercancía; se escanean los productos (con el escáner de la computadora o con el celular como escáner remoto). Cada escaneo marca la línea de la factura en verde, suma la cantidad que llegó y señala lo que **no** viene en la factura (sobrante) o **no llegó** (faltante). Se corrigen cantidades.
3. **Guardar recepción.** Entra el inventario (con la misma ruta de recepción que ya existe, sin lógica nueva de existencias) y Nexo crea una **tarea de acomodo**.
4. **Aviso al celular.** Notificación a quien le toque acomodar (o a todo el personal de piso): *"Llegaron 23 productos (factura A-1234). Es hora de acomodarlos."*
5. **Acomodo en el celular.** La lista de lo que llegó, **agrupada por pasillo/estante destino** y ordenada para recorrer la tienda una sola vez: producto, foto, cantidad, "va en Pasillo 2 › Estante 3". Un toque (o escanear el producto y luego el estante) marca **"acomodado"**; barra de avance (12 de 23). Quien acomoda puede cambiar el destino escaneando otro estante.
6. **Finalizar.** Botón "Terminar acomodo": si faltan líneas pide confirmar o las deja pendientes; queda registrado quién acomodó qué y cuándo. La computadora ve el avance en vivo.

## O. Piezas y datos

- **Reutiliza lo que ya existe:** Recepción inteligente (lectura de factura), "confirmar por escaneo" (filas roja/verde; Gustavo siente que no quedó bien: se **audita en la Fase 0** y se corrige, no se reescribe), `POST /recepciones-mercancia/rapida` (existencias con transacción y sin duplicar), historial de recepciones, notificaciones push por rol, y el mapa de estantes (sección H).
- **Tablas nuevas:** `acomodos` (negocio, recepción de origen, estado `pendiente|en_curso|terminado`, asignado_a, creado_at, terminado_por/at) y `acomodo_items` (producto, cantidad, `ubicacion_destino_id`, estado `pendiente|acomodado`, acomodado_por/at, ubicación real si cambió).
- **Destino de cada producto:** su `ubicacion_id` actual; si no tiene, la línea sale "sin lugar: escanea el estante donde lo dejas" y **ese escaneo le asigna la ubicación** (así el mapa de la tienda se va llenando solo).
- **Tomar la tarea:** el primero que toca "Iniciar acomodo" la toma (con su nombre), para que dos personas no acomoden lo mismo; se puede soltar o reasignar.
- **Tiempo real:** el avance se refleja en la computadora al momento (mismo canal en vivo que el escáner remoto, sección B).
- **Sin internet:** los "acomodado" se encolan y se sincronizan (ya existe la cola offline del celular).
- **Permisos:** subir/guardar la factura, quien reciba mercancía; acomodar, cualquier empleado de piso.

## P. Dónde entra

Es la **Fase H** (después del mapa de estantes y del escáner remoto, porque usa los dos): *recepción con verificación por escaneo + acomodo móvil*. Orden resultante:
A venta móvil (4 estorbos) → B diseño y navegación → mapa de estantes + etiquetas → C alta efectiva (+consulta, familia, contexto de estante) → D escáner remoto → E conteo por estante y medidas de Truper → **H recepción + acomodo** → F venta móvil completa → G "Dile a Nexo".

## Q. Preguntas nuevas

1. Hoy, cuando llega mercancía, ¿quién la recibe y quién la acomoda? ¿Son la misma persona?
2. Si la factura trae 80 renglones, ¿se escanean todos o solo los productos que tienen código de barras y el resto se confirma a mano?
3. ¿Qué pasa con un producto que llega y todavía no existe en el inventario? (propuesta: se da de alta ahí mismo con la sugerencia por familia y queda ya con estante).

---

# Actualización 5 (2026-10-26): quién usa el sistema, renglones sin código y productos nuevos que llegan

## R. Respuestas de Gustavo

- **Quién recibe y acomoda:** quien esté presente (los trabajadores). No hay un responsable fijo → la tarea de acomodo se avisa a **todo el personal conectado** y la toma el primero que toque "Iniciar acomodo" (se puede soltar o reasignar).
- **Problema real:** el empleado (Diego) tiene la sesión abierta, llega el dueño (Ketus) y usa el sistema **sin cambiar de usuario**. Todo queda a nombre de Diego y con los permisos de Diego.

## S. Cambio rápido de usuario (y elevar permisos sin cerrar sesión)

1. **Selector de usuario siempre visible** (avatar con el nombre de quien está activo, arriba en celular y computadora). Un toque → lista de las personas del negocio → **PIN de 4 dígitos** → cambia al instante, **sin cerrar sesión ni recargar**, conservando el carrito y la pantalla donde se estaba.
2. **Cada acción queda a nombre de quien la hizo** (venta, recepción, acomodo, ajuste, cambio de precio): `usuario_activo` se envía en cada petición; no depende de quién abrió la sesión del equipo.
3. **PIN de dueño para una sola acción** (elevar permisos): si Diego intenta algo que no puede (cambiar precio, anular venta, ajuste grande), aparece "Pide al dueño: PIN" y la acción se hace **a nombre del dueño** sin que Diego cambie de usuario. (Ya existe un PIN de administrador para el cambio de producto en créditos: se generaliza.)
4. **Bloqueo por inactividad** configurable (p. ej. 2 min): pide PIN para volver; evita que se quede la sesión de uno usada por otro.
5. **Respeta lo ya hecho:** horario laboral por empleado y turnos simultáneos, y los roles actuales (RBAC). Cambiar de usuario aplica *el rol de esa persona* al instante.
6. Más adelante: huella/Face ID con WebAuthn (passkeys) donde el navegador lo permita.

**Reglas de seguridad:** PIN de 4 dígitos con límite de intentos y espera; los PIN nunca se guardan en claro; el cambio de usuario queda en bitácora.

## T. Facturas con muchos renglones: qué se escanea y qué no

Ejemplo de una factura de 80 renglones: unos productos traen **código de barras** (se escanean); otros **no** (tornillos a granel, PVC y tubería con código interno, cosas que se compran por caja/costal). Propuesta:

- **Con código → escanear** para verificar (verde al leer; suma la cantidad).
- **Sin código → un toque**: "Llegó completo" o teclear la cantidad que llegó.
- **Botón "Confirmar el resto como llegó completo"** al final: marca de una vez todos los renglones que no se escanearon, mostrando antes la lista para revisarla. Útil con proveedores de confianza; se registra quién lo confirmó.
- Contador siempre visible: *"58 verificados · 20 pendientes · 2 con diferencia"*; los renglones con diferencia se resaltan en rojo.
- Se puede **dejar la verificación a medias y retomarla** (desde el celular o la computadora).

## U. Producto que llega y todavía no existe: alta completa en el momento

Meta: que **no haya que volver después a completarlo** y que llegue al acomodo ya con su lugar.

1. En la verificación, el renglón sale **"No está en tu inventario → Dar de alta"**.
2. Se abre una **hoja inferior (celular) o panel (computadora)** con el alta **ya precargada**:
   - de la **factura**: nombre, código, cantidad, costo, unidad;
   - del **catálogo maestro** (Truper, Urrea, tus capturas, Open Food Facts): nombre limpio, marca, categoría, foto del Banco;
   - de la **sugerencia por familia**: configuración de compra y venta (bolsa/kilo/pieza), proveedor, ubicación;
   - de una **sugerencia de precio** a partir del costo y del margen que ya usa el negocio por categoría.
3. Modo **Esencial** (revisar lo precargado y confirmar) o **Completo** (todo editable). Al guardar, el producto ya existe con **todas sus especificaciones** y **su estante** (se escanea el estante ahí mismo o se toma el sugerido).
4. **Cola de nuevos:** si llegan 5 productos nuevos, se pueden dar de alta uno por uno sin perder la verificación; un indicador "3 de 5 completos" muestra el avance.
5. **Nada queda incompleto en silencio:** si falta algo obligatorio (precio, configuración), el producto queda marcado **"por completar"**, aparece en la lista de pendientes del dueño, y la línea de acomodo lo muestra con advertencia.

## V. Cómo cambia el orden de fases

- **Nueva fase transversal al inicio (junto a la A):** *cambio rápido de usuario con PIN + acciones a nombre de quien las hace + PIN de dueño por acción*. Es pequeña, de alto impacto y es base para todo lo demás (acomodo, conteo, recepción).
- Fase H (recepción + acomodo) incluye T y U.

## W. Preguntas abiertas nuevas

1. ¿PIN de 4 dígitos por persona está bien, o prefieres elegir al usuario y tocar su foto/nombre sin PIN en el celular de la tienda (menos seguro)?
2. Bloqueo por inactividad: ¿cuántos minutos le parecen razonables en la ferretería?
3. ¿El dueño quiere ver en un reporte "quién hizo qué" (recepciones, ajustes, precios)? (se arma solo con el registro por usuario)

---

# Actualización 6 (2026-10-26): PIN por persona, bloqueo por horario (no por minutos) y reporte

## X. Decisiones de Gustavo

1. **PIN por persona: sí.** Nadie entra solo tocando su nombre.
2. **El bloqueo se rige por el horario de cada persona, no por minutos de inactividad:** "a tal hora entra este, a tal hora entra este". Y hay que cubrir el caso de **quien se queda más tarde** y **llega el siguiente a vender**.
3. **Reporte "quién hizo qué": sí.**

## Y. Cómo encaja con lo que ya existe

Ya hay **horario laboral por empleado, turnos simultáneos y bloqueo con PIN de administrador** (shipped 2026-08-25, 8c35675). El plan **extiende** eso, no lo rehace:

- **Quién debe estar activo ahora:** el sistema calcula, según los horarios, qué personas están en turno. El selector de usuario (sección S) muestra primero a los que están en turno.
- **Fin de turno = se cierra esa sesión de uso.** Cuando termina el horario de alguien, su "usuario activo" se bloquea: para seguir, hay que **teclear su PIN** (si sigue trabajando) o **cambiar a otra persona** con su PIN. Así nadie sigue vendiendo "a nombre de" alguien que ya se fue.
- **Alguien salió más tarde y llega el siguiente:**
  - El que llega **no necesita esperar nada**: toca el selector, pone **su** PIN y empieza. Los turnos se pueden **traslapar** (ya soportado: turnos simultáneos); cada venta queda a nombre de quien la hizo.
  - El que se queda después de su hora: al terminar su turno la app le pregunta **"¿Sigues trabajando?"** → su PIN **extiende su turno** (queda registrado como tiempo extra, con hora de salida real) o lo cierra. El **dueño** también puede **extender el turno** de alguien con su PIN, desde el celular.
  - **Entrada anticipada:** si alguien llega antes de su hora, puede entrar con su PIN; queda registrada la hora real (el dueño puede aprobar o corregir).
- **Gracia configurable** (p. ej. 15–30 min después de la hora de salida antes de pedir PIN) para no estorbar en el cambio de turno.
- **Inactividad por minutos:** queda **opcional y apagada por defecto** (solo como red de seguridad si el dueño la quiere activar).
- **Registro:** cada entrada, salida, extensión y cambio de usuario queda en bitácora, también útil para asistencia.

## Z. Reporte "quién hizo qué"

Una pantalla (computadora y celular) con filtros por **persona, día y tipo de acción**: ventas, cancelaciones, cambios de precio, ajustes de inventario, recepciones, acomodos, conteos, altas de producto, entradas/salidas y turnos extendidos. Resumen por persona (cuántas ventas, cuánto vendió, cuántas correcciones) y lista detallada con hora. Se alimenta del `usuario_activo` que viaja en cada acción (sección S), así que no depende de quién abrió la sesión del equipo.

## AA. Qué queda por decidir

1. **Gracia al terminar el turno:** ¿cuántos minutos antes de pedir PIN? (propuesta: 15)
2. **Tiempo extra:** ¿solo se registra, o el dueño debe aprobarlo?
3. ¿El empleado puede **ver su propio historial** ("qué hice hoy") o solo el dueño?

---

# Actualización 7 (2026-10-26): bodega con secciones y productos en dos lugares

## AB. Lo que pide Gustavo

Además del piso de venta (Pasillo 1 › Estante 1, Estante 2…), el negocio puede tener **bodega**, con **sus propias secciones**. Un mismo producto puede estar **exhibido y también en bodega** (responde la pregunta M.2: **sí, más de un lugar**).

## AC. Modelo

- **Zonas:** cada ubicación pertenece a una **zona**: `tienda` (exhibición) o `bodega`. El mapa de la tienda se arma por zona: *Tienda › Pasillo 1 › Estante 2* y *Bodega › Sección A › Rack 3 › Nivel 2* (árbol de profundidad libre).
- **Existencias por lugar (`producto_ubicaciones`):** producto, ubicación, cantidad. El **total del producto (`productos.stock`) sigue siendo la fuente de verdad para vender**: la distribución por lugar es un desglose encima de él, así el POS actual no cambia y nada se rompe.
- **Dos lugares "principales" por producto:** su lugar de **exhibición** y su lugar de **bodega** (pueden ser varias secciones de bodega). Los productos sin lugar siguen funcionando ("sin ubicar").
- **Ventas:** descuentan del total (como hoy) y, en el desglose, **primero de exhibición**; cuando la exhibición llega a cero y queda en bodega, el producto aparece en la lista **"Resurtir de bodega"**.
- **Traslado bodega → exhibición ("Resurtir"):** movimiento registrado (quién, cuándo, cuánto, de qué sección a qué estante); se hace en el celular escaneando la sección de bodega, el producto y el estante destino; no cambia el total, solo mueve el desglose.
- **Recepción y acomodo:** la mercancía que llega puede mandarse **a exhibición, a bodega o repartida** (ej. "6 al estante, 24 a bodega Sección A"); el acomodo del celular muestra ambos destinos.
- **Conteo:** por lugar (estante o sección de bodega); la suma de lugares se compara con el total y avisa "faltan/sobran".
- **Etiquetas:** QR/código para cada sección de bodega igual que para los estantes (plantilla con el nombre grande y la zona).
- **Compatibilidad:** `productos.ubicacion` (texto) se mantiene y muestra "Estante 2 · Bodega A" con lo principal.

## AD. Dónde entra

Dentro del **mapa de la tienda** (ya planeado antes de la Fase C): el modelo de zonas y ubicaciones nace con `zona` desde el principio; las existencias por lugar y los traslados se construyen en la **Fase E (conteo por estante)** junto con "Resurtir de bodega".

## AE. Preguntas

1. ¿La bodega vive en el mismo local o es **otro domicilio**? (si es otro, es una **sucursal/almacén** con otra dirección: se maneja como zona distinta con traslados entre locales).
2. ¿Quieres alertas de **"resurtir de bodega"** (exhibición vacía con producto en bodega)?
