// Funciones nuevas (beta) por negocio: interruptores que prenden o apagan cosas nuevas de la computadora SIN tocar a los demas negocios.
// Todo nace APAGADO: un negocio no ve ningun cambio hasta que su dueño (o tu desde aqui) lo enciende.
//   mapa_tienda       Mapa de la tienda en la computadora: lugares, ¿Donde esta?, Resurtir y Conteos por revisar
//   recibir_por_marca Recibir por marca (con factura del correo) en la computadora
//   inicio_pendientes Pendientes tocables en el Inicio de la computadora (stock critico, fiado/creditos, facturas por recibir)
//   diseno_nuevo      Diseño mas limpio (menos cajas) en la computadora
//   menu_simplificado Menu corto (Productos, Compras, Clientes, Ventas...) con tarjetas en lugar de ~40 entradas sueltas
//   envases           Envases retornables (abarrotes): importe del envase por producto y "Trae envase" en la venta
//   alcohol           Venta de alcohol (abarrotes): horario en que no se vende (PIN de administrador para saltarlo) y aviso de mayoria de edad
//   armado            Armar productos (granel a bolsitas, con merma y deshacer) y extras rapidos en la venta ("+ salsa $2")
//   bascula           Vender por importe ("quiero $50") y bascula digital con barra de color en la ventana de peso (abarrotes y ferreteria)
//   gafi_captura      Pantalla "Gafi: codigos y fotos" (solo administrador): busca un producto de la lista de Gafi, guarda su codigo de barras y su foto
//   recargas          Pantalla "Recargas" (tiempo aire): compañia, numero, monto y listo. Hoy en modo demostracion hasta conectar al proveedor
//   catalogo_por_proveedor  En Agregar producto, el proveedor elegido (Diprofer, Gafi, Truper) manda: la busqueda se queda en SU catalogo
//
// La columna se crea sola la primera vez (ADD COLUMN IF NOT EXISTS): no hace falta correr nada a mano y si algo falla, todo queda apagado.
const { responderError } = require("./error-utils");
const { resolverIdentidadNexo } = require("./rbac");

const FUNCIONES = {
    mapa_tienda: "Mapa de la tienda",
    recibir_por_marca: "Recibir por marca",
    inicio_pendientes: "Pendientes en el Inicio",
    diseno_nuevo: "Diseño nuevo",
    menu_simplificado: "Menú simplificado",
    envases: "Envases retornables",
    alcohol: "Venta de alcohol",
    bascula: "Báscula y venta por importe",
    armado: "Armar productos y extras",
    catalogo_por_proveedor: "Catálogo por proveedor",
    gafi_captura: "Gafi: códigos y fotos",
    recargas: "Recargas"
};

let columnaLista = false;

async function asegurarColumna(pool) {
    if (columnaLista) return;
    await pool.query(`ALTER TABLE public.negocios ADD COLUMN IF NOT EXISTS funciones_beta JSONB NOT NULL DEFAULT '{}'::jsonb`);
    columnaLista = true;
}

// Un negocio con "_todas": true (solo se pone a mano en la base, p. ej. la cuenta de demostracion) recibe TODAS las funciones nuevas,
// tambien las que se agreguen despues, sin tener que encenderlas; lo que su dueño apague a proposito (false) se respeta.
function limpiar(valor) {
    const salida = {};
    const todas = Boolean(valor && valor._todas === true);
    Object.keys(FUNCIONES).forEach(clave => { salida[clave] = valor ? (todas ? valor[clave] !== false : valor[clave] === true) : false; });
    return salida;
}

module.exports = (app, pool, requerirAccesoNegocio) => {
    const negocioId = req => req.negocioDispositivo?.negocio_id ?? req.negocioAutenticado?.negocio_id;

    app.get("/funciones-beta", requerirAccesoNegocio, async (req, res) => {
        try {
            await asegurarColumna(pool);
            const fila = (await pool.query(`SELECT funciones_beta FROM public.negocios WHERE id = $1`, [negocioId(req)])).rows[0];

            res.json({ ok: true, funciones: limpiar(fila?.funciones_beta), nombres: FUNCIONES });
        } catch (error) {
            // Sin la columna (o sin permiso de la base): todo apagado, nunca un error que estorbe al negocio.
            res.json({ ok: true, funciones: limpiar({}), nombres: FUNCIONES });
        }
    });

    // Solo el dueño las enciende o apaga.
    app.put("/funciones-beta", requerirAccesoNegocio, async (req, res) => {
        try {
            const identidad = await resolverIdentidadNexo(req);

            if (!(identidad.rol === "owner" || identidad.permisos === null)) {
                res.status(403).json({ ok: false, error: "Solo el dueño puede cambiar las funciones nuevas." });
                return;
            }

            const clave = String(req.body?.clave || "");

            if (!FUNCIONES[clave]) { res.status(400).json({ ok: false, error: "Esa función no existe." }); return; }

            await asegurarColumna(pool);
            const fila = (await pool.query(
                `UPDATE public.negocios SET funciones_beta = jsonb_set(COALESCE(funciones_beta, '{}'::jsonb), ARRAY[$2]::text[], to_jsonb($3::boolean)), updated_at = NOW()
                 WHERE id = $1 RETURNING funciones_beta`,
                [negocioId(req), clave, req.body?.activo === true]
            )).rows[0];

            res.json({ ok: true, funciones: limpiar(fila?.funciones_beta) });
        } catch (error) {
            responderError(res, error);
        }
    });
};

module.exports.FUNCIONES = FUNCIONES;
