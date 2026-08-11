// Prueba manual end-to-end de categorias de Nexo: catalogo canonico +
// categoriaNexoId en agregar/editar producto + deteccion con IA.
// Negocio sintetico, nunca negocio_id = 1, se borra al terminar.
// Uso: node --env-file=.env scripts/verificar-categorias-nexo.js
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
    const negocio = await crearNegocioPrueba("categorias-nexo");

    try {
        const auth = { "x-dispositivo-token": negocio.token };

        // 1. El catalogo canonico esta sembrado y expuesto.
        const catalogo = await llamar("GET", "/categorias-nexo", { headers: auth });
        log("GET /categorias-nexo -> 200 con departamentos", catalogo.status === 200 && catalogo.datos?.ok === true && catalogo.datos.departamentos.length > 0, { total: catalogo.datos?.departamentos?.length });

        const departamentoElectrico = catalogo.datos.departamentos.find(d => d.departamento === "Electrico");
        const subcategoriaContactos = departamentoElectrico?.subcategorias.find(s => s.nombre === "Contactos y apagadores");
        log("Departamento 'Electrico' con subcategoria 'Contactos y apagadores' existe", Boolean(subcategoriaContactos), subcategoriaContactos);

        // 2. Agregar producto CON categoriaNexoId -> categoria/subcategoria
        //    salen del catalogo canonico, categoria_nexo_id queda escrito.
        const agregar = await llamar("POST", "/agregar-producto", {
            headers: auth,
            json: {
                nombre: "Contacto dúplex de prueba",
                precio: 25,
                stock: 10,
                codigo: "TESTCATNEXO-001",
                categoriaNexoId: subcategoriaContactos.id
            }
        });
        log("POST /agregar-producto con categoriaNexoId -> 200", agregar.status === 200 && agregar.datos?.success === true, agregar.datos);
        log("Respuesta trae categoria='Electrico', categoria_nexo_id correcto",
            agregar.datos?.producto?.categoria === "Electrico" && Number(agregar.datos?.producto?.categoria_nexo_id) === Number(subcategoriaContactos.id),
            agregar.datos?.producto);

        const filaProducto = await pool.query(
            "SELECT categoria, subcategoria, categoria_nexo_id FROM public.productos WHERE id = $1",
            [agregar.datos.productoId]
        );
        log("En la base: categoria='Electrico', categoria_nexo_id correcto",
            filaProducto.rows[0].categoria === "Electrico" && Number(filaProducto.rows[0].categoria_nexo_id) === Number(subcategoriaContactos.id),
            filaProducto.rows[0]);

        // 3. Agregar producto CON un categoriaNexoId inventado -> se
        //    ignora sin tronar, cae al comportamiento de texto libre de
        //    siempre.
        const agregarInventado = await llamar("POST", "/agregar-producto", {
            headers: auth,
            json: {
                nombre: "Producto con id inventado",
                precio: 10,
                stock: 5,
                codigo: "TESTCATNEXO-002",
                categoria: "Texto libre viejo",
                categoriaNexoId: 999999999
            }
        });
        log("categoriaNexoId inventado -> no truena, usa texto libre",
            agregarInventado.status === 200 && agregarInventado.datos?.producto?.categoria === "Texto libre viejo",
            agregarInventado.datos?.producto);

        const filaInventado = await pool.query(
            "SELECT categoria, categoria_nexo_id FROM public.productos WHERE id = $1",
            [agregarInventado.datos.productoId]
        );
        log("En la base: categoria_nexo_id quedo NULL (id invalido descartado)",
            filaInventado.rows[0].categoria === "Texto libre viejo" && filaInventado.rows[0].categoria_nexo_id === null,
            filaInventado.rows[0]);

        // 4. Agregar producto SIN categoriaNexoId -> comportamiento de
        //    texto libre identico al de siempre (regresion).
        const agregarLibre = await llamar("POST", "/agregar-producto", {
            headers: auth,
            json: {
                nombre: "Producto texto libre",
                precio: 15,
                stock: 3,
                codigo: "TESTCATNEXO-003",
                categoria: "Categoria escrita a mano"
            }
        });
        log("Sin categoriaNexoId -> comportamiento de texto libre sin cambios",
            agregarLibre.status === 200 && agregarLibre.datos?.producto?.categoria === "Categoria escrita a mano",
            agregarLibre.datos?.producto);

        // 5. Editar producto, cambiando a una categoria Nexo distinta.
        const departamentoPlomeria = catalogo.datos.departamentos.find(d => d.departamento === "Plomeria");
        const subcategoriaValvulas = departamentoPlomeria?.subcategorias.find(s => s.nombre === "Llaves y valvulas");
        const editar = await llamar("PUT", `/editar-producto/${agregar.datos.productoId}`, {
            headers: auth,
            json: {
                nombre: "Contacto dúplex de prueba",
                precio: 30,
                stock: 8,
                codigo: "TESTCATNEXO-001",
                categoriaNexoId: subcategoriaValvulas.id
            }
        });
        log("PUT /editar-producto cambia a otra categoria Nexo -> 200",
            editar.status === 200 && editar.datos?.producto?.categoria === "Plomeria",
            editar.datos?.producto);

        const filaEditada = await pool.query(
            "SELECT categoria, categoria_nexo_id FROM public.productos WHERE id = $1",
            [agregar.datos.productoId]
        );
        log("En la base tras editar: categoria='Plomeria', categoria_nexo_id actualizado",
            filaEditada.rows[0].categoria === "Plomeria" && Number(filaEditada.rows[0].categoria_nexo_id) === Number(subcategoriaValvulas.id),
            filaEditada.rows[0]);

        // 6. Editar SIN mandar categoriaNexoId (ej. solo cambia precio)
        //    -> categoria_nexo_id se conserva (COALESCE), no se borra.
        const editarSinCategoria = await llamar("PUT", `/editar-producto/${agregar.datos.productoId}`, {
            headers: auth,
            json: {
                nombre: "Contacto dúplex de prueba",
                precio: 33,
                stock: 8,
                codigo: "TESTCATNEXO-001",
                categoria: "Plomeria"
            }
        });
        log("Editar sin categoriaNexoId -> 200", editarSinCategoria.status === 200, editarSinCategoria.datos);

        const filaConservada = await pool.query(
            "SELECT categoria_nexo_id FROM public.productos WHERE id = $1",
            [agregar.datos.productoId]
        );
        log("categoria_nexo_id se conserva cuando no se manda en el body",
            Number(filaConservada.rows[0].categoria_nexo_id) === Number(subcategoriaValvulas.id),
            filaConservada.rows[0]);

        // 7. Deteccion con IA -- nombre obvio, confirma que regresa un
        //    categoriaNexoId real de la lista.
        const deteccion = await llamar("POST", "/ia/sugerir-categoria-nexo", {
            headers: auth,
            json: { nombre: "Taladro percutor inalambrico 18V", marca: "TRUPER" }
        });
        console.log("Respuesta /ia/sugerir-categoria-nexo:", JSON.stringify(deteccion.datos));
        if (deteccion.datos?.disponible === false) {
            log("Deteccion con IA (sin cupo/plan -- se acepta como resultado valido)", true, deteccion.datos);
        } else {
            const idValido = catalogo.datos.departamentos.some(d => d.subcategorias.some(s => Number(s.id) === Number(deteccion.datos?.categoriaNexoId)));
            log("Deteccion con IA regresa un categoriaNexoId real de la lista", deteccion.status === 200 && deteccion.datos?.ok === true && idValido, deteccion.datos);
        }

        console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
    } finally {
        await pool.query("DELETE FROM public.productos WHERE negocio_id = $1", [negocio.negocioId]).catch(() => {});
        await borrarNegocioPrueba(negocio.negocioId);
        await detenerServidorPrueba();
        await pool.end();
    }

    process.exit(fallos === 0 ? 0 : 1);
})().catch(error => {
    console.error("FALLO INESPERADO:", error);
    process.exit(1);
});
