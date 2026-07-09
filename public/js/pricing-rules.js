/* Motor de reglas de precio por proveedor: margen general, por categoria y por
   producto (prioridad producto > categoria > general), mas redondeo. Las
   funciones de calculo son puras (sin acceso a red/localStorage); solo las
   funciones *Guardadas/guardar* tocan el servidor. */

let __cacheReglasPrecioProveedor = {};

function resolverMargenProducto(reglas, producto) {
 if (!reglas) return null;

 const codigo =
 normalizarCodigo(producto?.codigo || "");

 if (codigo && reglas.margenesProducto && reglas.margenesProducto[codigo] != null) {
 return { margen: Number(reglas.margenesProducto[codigo]), origen: "producto" };
 }

 const categoria =
 normalizarTexto(producto?.categoria || "");

 if (categoria && reglas.margenesCategoria && reglas.margenesCategoria[categoria] != null) {
 return { margen: Number(reglas.margenesCategoria[categoria]), origen: "categoria" };
 }

 if (reglas.margenGeneral != null && reglas.margenGeneral !== "") {
 return { margen: Number(reglas.margenGeneral), origen: "general" };
 }

 return null;
}

function redondeoPsicologico(precio) {
 const paso = 50;
 const base = 49;
 const n = Math.max(0, Math.ceil((precio - base) / paso));
 return base + paso * n;
}

function aplicarRedondeo(precio, reglaRedondeo) {
 const valor =
 Number(precio) || 0;

 switch (reglaRedondeo) {
 case "peso":
 return Math.round(valor);
 case "multiplo5":
 return Math.round(valor / 5) * 5;
 case "multiplo10":
 return Math.round(valor / 10) * 10;
 case "psicologico":
 return redondeoPsicologico(valor);
 case "ninguno":
 default:
 return Math.round(valor * 100) / 100;
 }
}

function calcularPrecioSugerido(reglas, producto) {
 const precioLista =
 Number(producto?.publico ?? producto?.precioLista ?? 0);

 if (!precioLista) return null;

 const resuelto =
 resolverMargenProducto(reglas, producto);

 if (!resuelto) return null;

 const bruto =
 precioLista * (1 + resuelto.margen / 100);

 return {
 precioLista,
 margen: resuelto.margen,
 origenMargen: resuelto.origen,
 precioSugerido: aplicarRedondeo(bruto, reglas.redondeo)
 };
}

async function obtenerReglasPrecioProveedor(proveedor, forzar = false) {
 if (!proveedor) return null;

 if (!forzar && __cacheReglasPrecioProveedor[proveedor] !== undefined) {
 return __cacheReglasPrecioProveedor[proveedor];
 }

 try {
 const respuesta =
 await fetch(`/reglas-precios/${encodeURIComponent(proveedor)}`);

 if (!respuesta.ok) {
 __cacheReglasPrecioProveedor[proveedor] = null;
 return null;
 }

 const datos =
 await respuesta.json();

 const regla =
 datos.regla
 ? {
 proveedor: datos.regla.proveedor,
 margenGeneral: datos.regla.margen_general != null ? Number(datos.regla.margen_general) : null,
 redondeo: datos.regla.redondeo || "ninguno",
 margenesCategoria: datos.regla.margenes_categoria || {},
 margenesProducto: datos.regla.margenes_producto || {}
 }
 : null;

 __cacheReglasPrecioProveedor[proveedor] = regla;
 return regla;
 } catch (error) {
 console.warn("No se pudieron leer las reglas de precio", error);
 return null;
 }
}

async function todasLasReglasPrecio() {
 try {
 const respuesta =
 await fetch("/reglas-precios");

 if (!respuesta.ok) return [];

 const datos =
 await respuesta.json();

 return (datos.reglas || []).map(fila => ({
 proveedor: fila.proveedor,
 margenGeneral: fila.margen_general != null ? Number(fila.margen_general) : null,
 redondeo: fila.redondeo || "ninguno",
 margenesCategoria: fila.margenes_categoria || {},
 margenesProducto: fila.margenes_producto || {}
 }));
 } catch (error) {
 console.warn("No se pudieron leer las reglas de precio", error);
 return [];
 }
}

async function guardarReglasPrecioProveedor(reglas) {
 const respuesta =
 await fetch("/reglas-precios", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({
 proveedor: reglas.proveedor,
 margenGeneral: reglas.margenGeneral,
 redondeo: reglas.redondeo || "ninguno",
 margenesCategoria: reglas.margenesCategoria || {},
 margenesProducto: reglas.margenesProducto || {}
 })
 });

 if (!respuesta.ok) {
 throw new Error("No se pudieron guardar las reglas de precio");
 }

 const datos =
 await respuesta.json();

 __cacheReglasPrecioProveedor[reglas.proveedor] = {
 proveedor: datos.regla.proveedor,
 margenGeneral: datos.regla.margen_general != null ? Number(datos.regla.margen_general) : null,
 redondeo: datos.regla.redondeo || "ninguno",
 margenesCategoria: datos.regla.margenes_categoria || {},
 margenesProducto: datos.regla.margenes_producto || {}
 };

 return __cacheReglasPrecioProveedor[reglas.proveedor];
}
