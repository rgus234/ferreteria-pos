// "Equipamiento para tu negocio": datos separados de la pagina, precios iguales al catalogo del fabricante cargado
// en Nexo, y nada afirmado sin verificar (compatibilidad con Nexo, disponibilidad, fotos).

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");

const sitio = ruta => path.join(__dirname, "..", "public", "site", ruta);
const datos = JSON.parse(fs.readFileSync(sitio("equipamiento.json"), "utf8"));

after(async () => { await pool.end(); });

test("el catalogo trae los 7 equipos con sus datos completos y sin inventar disponibilidad", () => {
    assert.equal(datos.productos.length, 7);
    assert.deepEqual(datos.categorias.map(c => c.id), ["impresoras", "lectores"]);
    assert.equal(datos.productos.filter(p => p.categoria === "impresoras").length, 3);
    assert.equal(datos.productos.filter(p => p.categoria === "lectores").length, 4);

    for (const p of datos.productos) {
        for (const campo of ["id", "codigo", "clave", "marca", "nombre", "garantia"]) assert.ok(p[campo], `${p.id} sin ${campo}`);
        assert.ok(p.precios.mayoreo > 0 && p.precios.medioMayoreo >= p.precios.mayoreo && p.precios.publico >= p.precios.medioMayoreo, `${p.clave}: orden de precios`);
        assert.ok(p.especificaciones.length >= 6 && p.incluye.length >= 2 && p.compatibilidad.sistemas.length >= 3);
        assert.ok(fs.existsSync(sitio(`equipos/${p.codigo}.jpg`)), `${p.clave}: falta su foto original`);
        assert.equal(p.disponibilidad, undefined, "la disponibilidad no se inventa");
        assert.equal(p.compatibilidad.conNexo, undefined, "compatibilidad con Nexo no afirmada: la pagina dice 'por confirmar'");
    }

    // El propietario autorizo publicar las fotos.
    assert.equal(datos.fotosAutorizadas, true);
});

test("los precios coinciden con el catalogo del fabricante cargado en Nexo (donde el catalogo los trae)", async () => {
    const filas = (await pool.query(
        `SELECT codigo, clave, precio_mayoreo, precio_medio_mayoreo, precio_publico FROM public.catalogo_fabricante_productos WHERE codigo = ANY($1)`,
        [datos.productos.map(p => p.codigo)]
    )).rows;

    assert.equal(filas.length, 7, "los 7 estan en el catalogo");

    for (const p of datos.productos) {
        const fila = filas.find(f => f.codigo === p.codigo);
        assert.equal(fila.clave, p.clave);
        assert.equal(Number(fila.precio_mayoreo), p.precios.mayoreo, `${p.clave} mayoreo`);
        assert.equal(Number(fila.precio_publico), p.precios.publico, `${p.clave} publico`);

        // Las impresoras no traen medio mayoreo en el catalogo cargado: ese valor sale de la ficha impresa.
        if (fila.precio_medio_mayoreo !== null) assert.equal(Number(fila.precio_medio_mayoreo), p.precios.medioMayoreo, `${p.clave} medio mayoreo`);
    }
});

test("la pagina muestra la seccion, la ficha y distingue compatibilidad comprobada de pendiente", () => {
    const html = fs.readFileSync(sitio("index.html"), "utf8");
    const js = fs.readFileSync(sitio("equipamiento.js"), "utf8");

    assert.match(html, /<section id="equipamiento"/);
    assert.match(html, /Equipamiento para tu negocio/);
    assert.match(html, /equipamiento\.js[^>]*defer/);
    assert.match(html, /href="#equipamiento"/);

    assert.match(js, /Con Nexo POS: por confirmar/);
    assert.match(js, /\/site\/equipamiento\.json/);
    assert.match(js, /fotosAutorizadas/);
    // En la pagina solo se muestra el precio de mayoreo; los otros niveles quedan solo en los datos.
    assert.match(js, /<span>Precio<\/span><strong>/);
    assert.match(js, /<span>Medio mayoreo<\/span><strong>/);
    assert.doesNotMatch(js, /precios\.publico|precios\.mayoreo/);
    assert.match(js, /Referencia · confirma vigencia/);
    assert.match(js, /data-ficha/);
    assert.match(js, /equipoBuscar/);
    assert.match(js, /equipoConexion/);
});

test("pedir informacion de un equipo NO usa el formulario de pruebas de Nexo: WhatsApp precargado y solicitud propia", () => {
    const js = fs.readFileSync(sitio("equipamiento.js"), "utf8");
    const servidor = fs.readFileSync(path.join(__dirname, "..", "solicitud-equipo-server.js"), "utf8");

    assert.doesNotMatch(js, /contactoMensaje|"participa"/, "ya no manda al formulario de participar");
    assert.match(js, /function enlaceWhatsapp\(p\)/);
    assert.match(js, /" \+ p\.marca \+ " " \+ p\.clave/, "el mensaje lleva marca y clave");
    assert.match(js, /\/api\/solicitud-equipo/);
    assert.match(js, /equipoForm/);

    assert.match(servidor, /\/api\/solicitud-equipo/);
    assert.match(servidor, /solicitudes_equipo/);
    assert.match(servidor, /empresaWeb/, "campo trampa contra robots");
});

// Requiere la migracion 20261031_solicitudes_equipo.sql.
test("la solicitud de un equipo se guarda aparte, valida y no crea invitaciones", async () => {
    const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
    await iniciarServidorPrueba();

    try {
        const enviar = cuerpo => fetch(`${BASE_URL}/api/solicitud-equipo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
        const marca = `Prueba equipo ${Date.now()}`;
        const contactosAntes = Number((await pool.query("SELECT COUNT(*) AS n FROM public.contactos_landing")).rows[0].n);

        assert.equal((await enviar({ equipoId: "no-existe", nombre: marca, telefono: "4421234567" })).status, 400, "equipo inexistente");
        assert.equal((await enviar({ equipoId: "43946", nombre: "", telefono: "4421234567" })).status, 400, "falta el nombre");
        assert.equal((await enviar({ equipoId: "43946", nombre: marca })).status, 400, "falta telefono o correo");
        assert.equal((await enviar({ equipoId: "43946", nombre: marca, correo: "no-es-correo" })).status, 400);

        const ok = await enviar({ equipoId: "43946", nombre: marca, telefono: "4421234567", cantidad: "2", ciudad: "Rio Grande", mensaje: "Para mi tienda" });
        assert.equal(ok.status, 201);

        const fila = (await pool.query("SELECT equipo_clave, cantidad, telefono, ciudad FROM public.solicitudes_equipo WHERE nombre = $1", [marca])).rows[0];
        assert.deepEqual([fila.equipo_clave, fila.cantidad, fila.telefono, fila.ciudad], ["PDV-81I", 2, "4421234567", "Rio Grande"]);

        // Un robot que llena el campo trampa recibe "ok" pero no se guarda nada.
        await enviar({ equipoId: "43946", nombre: marca + " robot", telefono: "1", empresaWeb: "spam" });
        assert.equal((await pool.query("SELECT COUNT(*) AS n FROM public.solicitudes_equipo WHERE nombre = $1", [marca + " robot"])).rows[0].n, "0");

        // No es una solicitud de pruebas de Nexo: no toca contactos_landing (ni genera invitaciones).
        assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM public.contactos_landing")).rows[0].n), contactosAntes);

        await pool.query("DELETE FROM public.solicitudes_equipo WHERE nombre LIKE $1", [marca + "%"]);
    } finally {
        await detenerServidorPrueba();
    }
});
