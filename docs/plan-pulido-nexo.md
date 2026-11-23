# Plan de pulido de Nexo (módulo por módulo, giro por giro)

Meta: que cada pantalla funcione sin fallos y se sienta hecha para el giro de quien la usa (ferretería, abarrotes, papelería), como se hizo con Inventario.

## Cómo se pule UN módulo (el mismo método siempre)

1. **Recorrido como usuario real.** Con un negocio de PRUEBA por giro (nunca Olímpico ni Rinconada), se hace lo que haría un dueño un día normal. Escritorio y celular.
2. **Lista de hallazgos**, cada uno con gravedad:
   - A = pierde dinero o datos, o no deja trabajar.
   - B = confunde o estorba.
   - C = detalle visual o de texto.
3. **Qué cambia por giro.** Para cada hallazgo: ¿es igual en todos los giros o distinto? Lo distinto se decide por giro (`perfilEsSimple`, `negocios.giro`). Lo riesgoso va detrás de una función beta.
4. **Arreglos chicos**, un commit por tema, con su prueba. Primero los A, luego B, luego C.
5. **Verificación.** Prueba automática + recorrido otra vez en pantalla. No se da por cerrado sin ver la pantalla.
6. **Cierre.** Se anota qué quedó y qué se decidió no hacer.

Reglas fijas: producción en uso (Olímpico) = cambios mínimos, no pisar valores existentes. Subir solo con tu "súbelo". Si se toca `/dueno`, subir `CACHE_NAME`.

## Orden propuesto (de lo que más se usa a lo que menos)

| # | Módulo | Por qué en este lugar | Qué cambia por giro |
|---|--------|-----------------------|---------------------|
| 1 | Vender / cobrar (escritorio y celular) | Es lo que más se ve y donde un fallo cuesta dinero | Ferretería: precios por nivel, descuentos. Abarrotes: escaneo rápido, granel, recargas |
| 2 | Inventario (cierre) | Ya avanzado; falta pasarlo por los dos giros de punta a punta | Granel, caducidad y lotes (abarrotes). Medio mayoreo y presentaciones (ferretería) |
| 3 | Créditos / fiado | Dinero de clientes | Ferretería: cuentas largas. Abarrotes: fiado chico y frecuente |
| 4 | Caja y cortes | Cuadre diario | Métodos de pago, recargas, efectivo |
| 5 | Compras y recepción de mercancía | Costos y precios | Facturas con IVA; catálogos de proveedor (ferretería) |
| 6 | Proveedores y pedidos sugeridos | Reabasto | Por marca (abarrotes) o por proveedor (ferretería) |
| 7 | Clientes y encargos | Relación con el cliente | Encargos (ferretería) |
| 8 | Reportes y Nexo IA | Lo que el dueño mira para decidir | Qué reportes importan por giro |
| 9 | Recargas y servicios | Ingreso nuevo; depende de Taecel en producción | Abarrotes sobre todo |
| 10 | Market y pedidos | Venta en línea | Por giro y departamento |
| 11 | Configuración, asistente de inicio, planes | Primera impresión de un negocio nuevo | Preguntas distintas por giro (ya empezado) |
| 12 | Celular `/dueno` y app de escritorio | Paridad y arranque | Rinconada ya tiene su versión |

## Cómo vamos por partes

Cada módulo es una sesión corta con este formato:
1. Yo recorro el módulo y te paso la lista de hallazgos con gravedad (corta, sin relleno).
2. Tú marcas cuáles sí, cuáles no, y decides lo que sea de negocio.
3. Arreglo, pruebo y te enseño una captura de cada cosa importante.
4. Subes cuando tú digas.

## Qué necesito de ti

- Un negocio de prueba por giro (yo lo creo con datos de ejemplo).
- Que me avises cuando un cliente real (Olímpico, Rinconada) se queje de algo: eso va primero que cualquier lista.
- Decidir si el pulido de cada módulo incluye el celular o se hace después.

## Ya hecho (para no repetirlo)

Inventario por giro (granel, caducidad, lotes), mostrador de precios, versión sencilla de Rinconada (escritorio y celular), asistente de inicio por giro, recargas con Taecel en modo demostración.
