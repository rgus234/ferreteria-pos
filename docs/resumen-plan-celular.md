# Resumen del plan: Nexo en el celular (2026-10-26)

Detalle completo en `docs/plan-celular-inventario-y-venta.md`. Este es el resumen de una página.

## Visión
El celular puede ser **la herramienta principal** de un negocio que apenas empieza (sin computadora ni lector) y **parte conectada** de uno que ya tiene computadora. Todo se ve igual en los dos lados, se hace rápido y completo, con una interfaz cuidada.

## Decisiones cerradas (con Gustavo)
- **Alta efectiva:** modo *Esencial* (nombre, precio, cantidad) y *Completo* (toda la información de la computadora), mismo producto.
- **Nexo aprende del inventario:** al dar de alta algo parecido, propone **reutilizar la configuración** de la familia (pijas: bolsa → kilo/pieza). Siempre sugerencia, nunca automático.
- **Piloto:** pijas y tornillos; las medidas salen del catálogo de Truper. Pijas por kilo se **pesan en báscula** (peso capturado a mano en el celular).
- **Usuarios:** **PIN por persona**; cambio rápido de usuario sin cerrar sesión; cada acción a nombre de quien la hace; PIN del dueño para una acción puntual; **bloqueo por horario de turno** (no por minutos), **gracia de 15 min**; **tiempo extra solo se registra**; el **empleado ve su propio historial**; **reporte "quién hizo qué"**.
- **Conteo y alta en el celular:** dueño **y empleados**, con permisos por rol.
- **iPhone:** se usa como PWA desde Safari (Google Play aún no aprueba).

## Lo que se va a construir (orden)
0. **Auditoría** del alta, la venta móvil y la recepción por escaneo actuales.
1. **Fase A — Venta móvil, los 4 estorbos:** teclado que tapa → mini-carrito fijo; escanear sin aviso → tarjeta grande con foto/precio + sonido; producto que queda hasta abajo → el carrito baja y resalta; líneas con foto, precio, cantidad.
2. **Usuarios y turnos:** PIN, cambio rápido, turnos por horario con gracia, extensión de turno por PIN, acciones a nombre de quien las hace, historial propio y reporte.
3. **Fase B — Diseño y navegación:** barra inferior de 5 destinos (Inicio · Vender · Inventario · Clientes · Más), sistema de diseño único con la computadora, todo conectado.
4. **Mapa de la tienda:** pasillos y estantes con **etiqueta QR/código de barras** para imprimir (editor de etiquetas con secciones por color).
5. **Fase C — Alta efectiva en el celular:** Esencial/Completo, **sugerencia por familia**, **modo consulta** (escanear = ver qué es), **contexto de estante** (escaneas el estante y todo lo que guardas queda ahí), escaneo continuo "guardar y siguiente".
6. **Fase D — Celular como escáner de la computadora** (se empareja con un QR; lo escaneado cae donde esté el cursor).
7. **Fase E — Medidas de Truper + conteo por estante** (qué debería estar y qué no se escaneó).
8. **Fase H — Recepción de mercancía:** subir factura → **verificar escaneando** (sin código: un toque; "confirmar el resto") → **alta completa en el momento** de los productos nuevos → **aviso al celular** → **acomodo** por pasillo/estante, marcando uno por uno, con avance y "Terminar acomodo".
9. **Fase F — Venta móvil completa:** venta por peso, fiado, ticket digital, cobro en un toque.
10. **Fase G — "Dile a Nexo":** voz/texto para dar de alta ("agrega pijas de 1 pulgada a 85 la bolsa").
- **App para todos:** invitación por QR o WhatsApp para cada empleado, con pantalla inicial según su rol.

## Reglas para no romper producción
Todo nuevo va detrás de un flag por negocio (Olímpico al final y avisado); las sugerencias nunca escriben solas ni pisan valores; el aprendizaje es por negocio; cada fase con pruebas; subir `CACHE_NAME` del service worker en cada cambio del celular.

## Pendientes fuera de este plan
- Subir los commits locales (script de nombres de Urrea y estos documentos).
- Enviar el formulario de Urrea (ya está lleno en tu Chrome) y esperar su respuesta sobre descripciones, fotos, precios y EAN.
- Probar en la tienda: Importar de Truper (empezar con el 50138), Etiquetas del exhibidor, Exhibidores en el celular, descarga de PDF de etiquetas, aviso diario de exhibidores.
- Asignar proveedor a los 89 productos de Olímpico sin proveedor.
