// Prueba manual end-to-end de "Actualizar precios (medio mayoreo)" en
// Catalogo proveedor: vista previa + aplicar precio medio mayoreo solo
// a productos vinculados a ESE catalogo, sin tocar otros. No es parte
// de la suite automatizada -- negocio sintetico, nunca negocio_id = 1,
// datos borrados al terminar.
// Uso: node --env-file=.env scripts/verificar-precio-mayoreo-catalogo.js
const http = require("http");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("../tests/helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba } = require("../tests/helpers/servidor-prueba");

let fallos = 0;
function log(etiqueta, ok, extra = "") {
    console.log(`${ok ? "OK  " : "FAIL"} ${etiqueta}${extra ? " -- " + JSON.stringify(extra) : ""}`);
    if (!ok) fallos++;
}

function llamar(metodo, ruta, { json, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const cabeceras = { ...headers };
        let payload = null;
        if (json) {
            payload = Buffer.from(JSON.stringify(json), "utf8");
            cabeceras["Content-Type"] = "application/json";
            cabeceras["Content-Length"] = payload.length;
        }

        const req = http.request({ hostname: "localhost", port: 3099, path: ruta, method: metodo, headers: cabeceras }, res => {
            const trozos = [];
            res.on("data", chunk => trozos.push(chunk));
            res.on("end", () => {
                const texto = Buffer.concat(trozos).toString("utf8");
                let datos = null;
                try { datos = JSON.parse(texto); } catch (e) { /* no-json */ }
                resolve({ status: res.statusCode, datos });
            });
        });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

(async () => {
    await iniciarServidorPrueba();
    const negocio = await crearNegocioPrueba("precio-mayoreo");

    try {
        const auth = { "x-dispositivo-token": negocio.token };

        // Producto de otro proveedor (nunca debe tocarse).
        await pool.query(
            `INSERT INTO public.productos (negocio_id, codigo, nombre, precio, stock, proveedor) VALUES ($1, 'OTRO-001', 'Producto de otro proveedor', 100, 5, 'Truper')`,
            [negocio.negocioId]
        );

        // Producto real de Diprofer, ya en inventario con un precio,
        // categoria y marca viejos.
        await pool.query(
            `INSERT INTO public.productos (negocio_id, codigo, nombre, precio, stock, proveedor, categoria, marca) VALUES ($1, 'DIP-001', 'Producto Diprofer viejo', 50, 5, 'Diprofer', 'Electrico', 'VOLTECK')`,
            [negocio.negocioId]
        );

        // Producto vinculado sin categoria/marca en el catalogo -- para
        // confirmar que una columna vacia en el archivo del proveedor
        // NUNCA borra un dato que el dueno ya tenia.
        await pool.query(
            `INSERT INTO public.productos (negocio_id, codigo, nombre, precio, stock, proveedor, categoria, marca) VALUES ($1, 'DIP-003', 'Producto Diprofer con datos propios', 20, 5, 'Diprofer', 'Plomeria', 'Trupencia')`,
            [negocio.negocioId]
        );

        // Subir catalogo de Diprofer con 3 filas: DIP-001 coincide por
        // codigo (categoria/marca nuevas), DIP-002 es nueva, DIP-003
        // coincide por codigo pero sin categoria/marca en el archivo.
        const subir = await llamar("POST", "/catalogo-proveedor/Diprofer/subir", {
            headers: auth,
            json: {
                productos: [
                    { codigo: "DIP-001", codigoInterno: "DIP-001", nombre: "Producto Diprofer viejo", categoria: "Herramientas", marca: "Diprofer", medioMayoreo: 65, publico: 80 },
                    { codigo: "DIP-002", nombre: "Taladro percutor inalambrico 18V", medioMayoreo: 40, publico: 55 },
                    { codigo: "DIP-003", codigoInterno: "DIP-003", nombre: "Producto Diprofer con datos propios", medioMayoreo: 25, publico: 30 }
                ]
            }
        });
        log("Subir catalogo Diprofer -> 200", subir.status === 200 && subir.datos?.ok === true, subir.datos);
        const catalogoId = subir.datos?.catalogoId;

        // Vista previa: 2 cambios (DIP-001 con precio+categoria+marca, DIP-003 solo precio).
        const vistaPrevia = await llamar("GET", `/catalogo-proveedor/${catalogoId}/vista-previa-precio-mayoreo`, { headers: auth });
        const cambios = vistaPrevia.datos?.cambios || [];
        const cambioDip1 = cambios.find(c => c.nombre === "Producto Diprofer viejo");
        const cambioDip3 = cambios.find(c => c.nombre === "Producto Diprofer con datos propios");
        log("Vista previa trae 2 cambios (DIP-001 y DIP-003)", cambios.length === 2, cambios);
        log("DIP-001 cambia precio+categoria+marca", cambioDip1?.campos?.sort().join(",") === "categoria,marca,precio", cambioDip1);
        log("DIP-003 solo cambia precio (sin categoria/marca en el archivo)", cambioDip3?.campos?.sort().join(",") === "precio", cambioDip3);

        // Aplicar.
        const aplicar = await llamar("POST", `/catalogo-proveedor/${catalogoId}/aplicar-precio-mayoreo`, { headers: auth });
        log("Aplicar -> actualizados = 2", aplicar.datos?.ok === true && aplicar.datos?.actualizados === 2, aplicar.datos);

        // Confirmar en base: DIP-001 quedo en 65 con categoria/marca nuevas.
        const filaDip = await pool.query("SELECT precio, categoria, marca FROM public.productos WHERE negocio_id = $1 AND codigo = 'DIP-001'", [negocio.negocioId]);
        log("DIP-001 quedo en precio 65, categoria Herramientas, marca Diprofer", Number(filaDip.rows[0]?.precio) === 65 && filaDip.rows[0]?.categoria === "Herramientas" && filaDip.rows[0]?.marca === "Diprofer", filaDip.rows[0]);

        // DIP-003: precio cambio pero categoria/marca originales se conservaron.
        const filaDip3 = await pool.query("SELECT precio, categoria, marca FROM public.productos WHERE negocio_id = $1 AND codigo = 'DIP-003'", [negocio.negocioId]);
        log("DIP-003 quedo en precio 25 pero conservo categoria/marca propias (Plomeria/Trupencia)", Number(filaDip3.rows[0]?.precio) === 25 && filaDip3.rows[0]?.categoria === "Plomeria" && filaDip3.rows[0]?.marca === "Trupencia", filaDip3.rows[0]);

        const filaOtro = await pool.query("SELECT precio FROM public.productos WHERE negocio_id = $1 AND codigo = 'OTRO-001'", [negocio.negocioId]);
        log("Producto de otro proveedor NO se toco (sigue en 100)", Number(filaOtro.rows[0]?.precio) === 100, filaOtro.rows[0]);

        // Vista previa de nuevo: ya no deberia haber cambios pendientes.
        const vistaPreviaFinal = await llamar("GET", `/catalogo-proveedor/${catalogoId}/vista-previa-precio-mayoreo`, { headers: auth });
        log("Segunda vista previa queda vacia (ya aplicado)", (vistaPreviaFinal.datos?.cambios || []).length === 0, vistaPreviaFinal.datos);

        // Crear producto nuevo desde la fila DIP-002 -- debe tomar medio mayoreo (40), no publico (55).
        const detalle = await llamar("GET", `/catalogo-proveedor/${catalogoId}/productos?estado=sin_vincular`, { headers: auth });
        const filaNueva = detalle.datos?.productos?.find(p => p.codigo_proveedor === "DIP-002");
        if (filaNueva) {
            const crear = await llamar("POST", `/catalogo-proveedor/${catalogoId}/productos/${filaNueva.id}/crear-producto`, { headers: auth });
            const productoNuevo = await pool.query("SELECT precio FROM public.productos WHERE id = $1", [crear.datos?.productoId]);
            log("Producto nuevo creado con precio = medio mayoreo (40, no 55)", Number(productoNuevo.rows[0]?.precio) === 40, productoNuevo.rows[0]);
        } else {
            log("Producto nuevo creado con precio = medio mayoreo (40, no 55)", false, "no se encontro la fila DIP-002 sin vincular");
        }

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        await pool.query("DELETE FROM public.catalogos_proveedor WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocio.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
