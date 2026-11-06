# Abarrotes: armar productos, venta por importe y báscula (diseño)

**Estado (2026-11-05):** construido y probado en local, sin commit. Falta: lector probado con una báscula física real (se escribió para los formatos comunes), descontar al vender y el celular. Todo va detrás de una función por negocio (`funciones_beta`), apagada por defecto en negocios existentes (Ferretería Olímpico no cambia) y encendida en Abarrotes Díaz.

## Qué problema resuelve

| Caso real | Hoy | Con este diseño |
|---|---|---|
| Jamón por kilo | Funciona: ventana de kilos con total | Igual, más "quiero $50" |
| "Dame $50 de jamón" | El cajero calcula los kilos a mano | Teclea 50 y Nexo dice cuántos kg son |
| Churros / azúcar / jamón en porciones | Dos productos que se desajustan | "Armar": descuenta el granel y suma las bolsitas |
| "Con salsa, +$2" | Producto aparte o Artículo rápido | Extras rápidos ligados al producto |
| Báscula digital | Peso tecleado | Lectura en vivo con barra de color |

## 1. Venta por importe ("quiero $50")

En la ventana de kilos de un producto por peso, un interruptor **Kilos | Pesos**.

- En Pesos: el cajero teclea 50. Nexo calcula `kg = 50 / precio_kg`, redondeado a gramo (0.001), y lo muestra grande: **0.312 kg**.
- La línea del carrito guarda los kilos y el total real. Atajos: $20, $50, $100.
- Sin báscula: el cajero corta hasta ese peso. Con báscula: ver sección 4.
- Todo en el frente, sin migración: la cantidad sigue siendo kilos, solo cambia cómo se captura.

## 2. Armar productos (granel → bolsitas)

### Datos (migración aditiva)
- `producto_armado`: `negocio_id`, `producto_origen_id`, `producto_destino_id`, `cantidad_origen` (0.1 kg por bolsita), `merma_pct` (default 0), `costo_extra` (costo de la bolsita vacía).
- `armados_log`: quién, cuándo, cuántas unidades, cuánto origen se gastó, merma. Todo pasa por bitácora.

### Dos modos por producto vinculado
1. **Armar por lote** (primero): botón "Armar" en Inventario. Eliges el producto destino, escribes "hice 20 bolsitas". Nexo descuenta `20 × 0.1 kg × (1 + merma)` del granel y suma 20 al destino. Confirma antes y se puede deshacer en las siguientes 24 h.
2. **Descontar al vender** (después): al vender 1 bolsita, baja 0.1 kg del granel directo. Sirve para lo que se prepara al momento.

### Reglas
- El costo del destino se calcula: `costo_kg × cantidad_origen + costo_extra`.
- Usa el mismo manejo de fracciones que ya existe (`stock` + `stock_resto`), no uno nuevo.
- Si el granel no alcanza, avisa y no deja armar (con PIN de administrador para forzarlo).

## 3. Extras rápidos (salsa)

- En el producto: lista de extras con nombre y precio (Salsa $2, Limón $0).
- Al agregarlo al carrito salen fichas chicas debajo de la línea; un toque suma el extra como renglón ligado. Si se quita el producto, se va el extra.
- Un extra puede ser un producto con inventario (vasito de salsa) o solo un cargo.

## 4. Báscula digital conectada

### Pantalla (dentro de la misma ventana de peso, sin saturar)
Solo aparece si hay báscula conectada; si no, la ventana queda como hoy.

- Arriba: producto y precio por kilo.
- Centro: el **peso en vivo** en grande y debajo una barra horizontal.
- Meta: "Meta $50 = 0.312 kg".
- Colores con transición suave (CSS, 200 ms):
  - **Rojo** menos del 80 % de la meta.
  - **Ámbar** del 80 % al 97 %.
  - **Verde** del 97 % al 103 % (margen de unos gramos). La barra hace un pulso corto y suena un tono suave opcional.
  - **Azul/gris** más del 103 %: "Te pasaste 12 g".
- El color nunca va solo: siempre acompaña un texto ("Faltan 85 g", "Listo", "Te pasaste 12 g").
- Se marca "Listo" solo cuando la báscula reporta peso estable por ~0.4 s, para que no parpadee.
- Usa las variables de color del tema de Nexo, así se ve bien en claro y oscuro y no rompe el estilo.

### Conexión
- Escritorio (Electron/Chrome): Web Serial / USB, el mismo patrón que cualquier lector. Se elige el puerto una vez y se recuerda.
- Celular: sin báscula en esta primera etapa (se sigue tecleando).
- **Depende del modelo.** Cada báscula manda el peso con un formato propio (baudios, texto). Hay que saber la marca para escribir el lector. Antes de construir se necesita el modelo real.
- Si la báscula se desconecta, la ventana vuelve a modo manual sin perder lo capturado.

## Orden de construcción
1. Venta por importe (manual). Chico, sin migración.
2. Armar por lote + deshacer.
3. Extras rápidos.
4. Báscula (cuando se tenga el modelo).
5. Descontar al vender.

Pruebas por fase, `CACHE_NAME` de los service workers al tocar archivos de cliente, y verificación visual en claro y oscuro.

## Lo que se decidió al construir
- Una sola función nueva para armar y extras (`armado`) y otra para importe y báscula (`bascula`); las dos sirven también en ferretería (tornillos, clavos) pero nacen apagadas.
- Pasado del 3 %: se cobra lo que pesó; dentro del 3 %, lo pedido. En modo importe el total puede salir en centavos ($50.04) porque la cantidad va al gramo.
- Los extras son productos normales con su inventario, y las fichas salen arriba del carrito.
- Armar por lote ya existe; "descontar al vender" queda para después.

## Preguntas abiertas
1. ¿Qué marca/modelo de báscula? Define el lector.
2. Si el cliente pide $50 y se pasa unos gramos, ¿se cobra lo pedido ($50) o lo que realmente pesó? Propuesta: lo pedido hasta un margen del 3 %, y avisar si es mayor.
3. ¿Los churros se preparan por lote (armar) o al momento (descontar al vender)?
