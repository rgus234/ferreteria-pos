// Tareas y avisos del equipo: calculo de que toca cada dia + el servidor (permiso de encargado, asignar, marcar hecha, avisos).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ocurreEnFecha, textoRepeticion, normalizarTarea } = require("../tareas-calculo");
const { pool, crearNegocioPrueba, borrarNegocioPrueba } = require("./helpers/negocio-prueba");
const { iniciarServidorPrueba, detenerServidorPrueba, BASE_URL } = require("./helpers/servidor-prueba");
const { hashPassword } = require("../password-utils");

// 2026-11-02 es lunes
test("una sola vez toca solo su dia; diaria desde que empieza; semanal en sus dias; mensual el dia del mes (31 cae el ultimo dia)", () => {
    assert.equal(ocurreEnFecha({ repite: "no", fecha: "2026-11-02" }, "2026-11-02"), true);
    assert.equal(ocurreEnFecha({ repite: "no", fecha: "2026-11-02" }, "2026-11-03"), false);

    assert.equal(ocurreEnFecha({ repite: "diaria", fecha: "2026-11-02" }, "2026-11-01"), false, "antes de empezar no");
    assert.equal(ocurreEnFecha({ repite: "diaria", fecha: "2026-11-02" }, "2027-01-15"), true);

    const lunes = { repite: "semanal", fecha: "2026-10-01", diasSemana: [1] };
    assert.equal(ocurreEnFecha(lunes, "2026-11-02"), true, "lunes");
    assert.equal(ocurreEnFecha(lunes, "2026-11-03"), false, "martes");
    assert.equal(ocurreEnFecha({ ...lunes, diasSemana: [1, 4, 7] }, "2026-11-08"), true, "domingo");

    const mensual = { repite: "mensual", fecha: "2026-01-01", diaMes: 31 };
    assert.equal(ocurreEnFecha(mensual, "2026-11-30"), true, "noviembre tiene 30: cae el 30");
    assert.equal(ocurreEnFecha(mensual, "2026-11-29"), false);
    assert.equal(ocurreEnFecha(mensual, "2026-12-31"), true);
});

test("el texto de la repeticion se lee como una persona", () => {
    assert.equal(textoRepeticion({ repite: "no" }), "Una sola vez");
    assert.equal(textoRepeticion({ repite: "diaria" }), "Todos los días");
    assert.equal(textoRepeticion({ repite: "semanal", diasSemana: [1] }), "Cada lunes");
    assert.equal(textoRepeticion({ repite: "semanal", diasSemana: [1, 3, 5] }), "Cada lunes, miércoles y viernes");
    assert.equal(textoRepeticion({ repite: "mensual", diaMes: 15, fecha: "2026-01-01" }), "Cada mes, el día 15");
});

test("el formulario se limpia y se piden los datos que faltan", () => {
    assert.match(normalizarTarea({ titulo: "  " }, "2026-11-02").error, /Escribe/);
    assert.match(normalizarTarea({ titulo: "x", repite: "semanal" }, "2026-11-02").error, /día de la semana/);
    assert.match(normalizarTarea({ titulo: "x", repite: "mensual", diaMes: 40 }, "2026-11-02").error, /día del mes/);
    const ok = normalizarTarea({ titulo: " Revisar caducidades ", repite: "semanal", diasSemana: [1, "1", 5], hora: "08:30", asignadoA: "7" }, "2026-11-02").tarea;
    assert.deepEqual({ t: ok.titulo, d: ok.diasSemana, h: ok.hora, a: ok.asignadoA, f: ok.fecha }, { t: "Revisar caducidades", d: [1, 5], h: "08:30", a: 7, f: "2026-11-02" });
    assert.equal(normalizarTarea({ titulo: "x", hora: "25:99" }, "2026-11-02").tarea.hora, null);
});

let negocio, dueno, encargado, cajero;
const pedir = async (ruta, { metodo = "GET", cuerpo, quien } = {}) => {
    const r = await fetch(`${BASE_URL}${ruta}`, { method: metodo, headers: { "Content-Type": "application/json", "x-dispositivo-token": negocio.token, ...(quien ? { "x-empleado-id": String(quien) } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, cuerpo: await r.json().catch(() => ({})) };
};

before(async () => {
    await iniciarServidorPrueba();
    negocio = await crearNegocioPrueba("tareas-equipo");
    const alta = async (nombre, rol, permisos = {}) => (await pool.query(`INSERT INTO public.empleados (negocio_id, nombre, rol, pin_hash, activo, permisos) VALUES ($1, $2, $3, $4, true, $5::jsonb) RETURNING id`, [negocio.negocioId, nombre, rol, hashPassword("1234"), JSON.stringify(permisos)])).rows[0].id;
    dueno = await alta("Dueña", "Administrador");
    encargado = await alta("Marta", "Encargado", { gestionar_tareas: true });
    cajero = await alta("Luis", "Cajero");
});

after(async () => {
    if (negocio) {
        await pool.query(`DELETE FROM public.tareas_equipo WHERE negocio_id = $1`, [negocio.negocioId]).catch(() => {});
        await pool.query(`DELETE FROM public.avisos_equipo WHERE negocio_id = $1`, [negocio.negocioId]).catch(() => {});
        await pool.query(`DELETE FROM public.empleados WHERE negocio_id = $1`, [negocio.negocioId]);
        await borrarNegocioPrueba(negocio.negocioId);
    }
    await detenerServidorPrueba();
    await pool.end();
});

test("el dueño y un encargado crean tareas (varias el mismo dia); un cajero no", async () => {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

    assert.equal((await pedir("/tareas", { metodo: "POST", cuerpo: { titulo: "Abrir y prender luces", hora: "07:45", repite: "diaria" } })).status, 201, "dueño (sin persona elegida)");
    assert.equal((await pedir("/tareas", { metodo: "POST", quien: encargado, cuerpo: { titulo: "Revisar caducidades", repite: "semanal", diasSemana: [1, 2, 3, 4, 5, 6, 7], hora: "09:00" } })).status, 201, "encargado");
    assert.equal((await pedir("/tareas", { metodo: "POST", quien: encargado, cuerpo: { titulo: "Acomodar refrescos", asignadoA: cajero, fecha: hoy } })).status, 201, "tercera tarea del dia, para Luis");

    const rechazo = await pedir("/tareas", { metodo: "POST", quien: cajero, cuerpo: { titulo: "No debe poder" } });
    assert.equal(rechazo.status, 403);
    assert.equal(rechazo.cuerpo.requierePermiso, "gestionar_tareas");
});

test("cada quien ve las suyas y las de todo el equipo; el dueño ve todo; se marca hecha y queda quien", async () => {
    const luis = (await pedir("/tareas/hoy", { quien: cajero })).cuerpo;
    assert.deepEqual(luis.tareas.map(t => t.titulo).sort(), ["Abrir y prender luces", "Acomodar refrescos", "Revisar caducidades"], "las 2 del equipo + la suya");

    const marta = (await pedir("/tareas/hoy", { quien: encargado })).cuerpo;
    assert.ok(!marta.tareas.some(t => t.titulo === "Acomodar refrescos"), "la de Luis no es de Marta");
    assert.equal(marta.esGestor, true);
    assert.equal(luis.esGestor, false);

    const todo = (await pedir("/tareas/hoy")).cuerpo;
    assert.equal(todo.tareas.length, 3);
    assert.ok(String(todo.tareas[0].hora || "99:99") <= String(todo.tareas[1].hora || "99:99"), "ordenadas por hora");

    const suya = luis.tareas.find(t => t.titulo === "Acomodar refrescos");
    assert.equal((await pedir(`/tareas/${suya.id}/hecha`, { metodo: "POST", quien: cajero, cuerpo: {} })).status, 200);
    assert.equal((await pedir(`/tareas/${suya.id}/hecha`, { metodo: "POST", quien: encargado, cuerpo: {} })).status, 403, "otra persona no marca la de Luis");

    const despues = (await pedir("/tareas/hoy")).cuerpo;
    const hecha = despues.tareas.find(t => t.id === suya.id);
    assert.equal(hecha.hecha, true);
    assert.equal(hecha.hechaPor, "Luis");
    assert.deepEqual(despues.resumen, { total: 3, hechas: 1 });
    assert.equal(despues.tareas[despues.tareas.length - 1].id, suya.id, "las hechas se van al final");

    assert.equal((await pedir(`/tareas/${suya.id}/hecha`, { metodo: "POST", quien: cajero, cuerpo: { hecha: false } })).status, 200);
    assert.equal((await pedir("/tareas/hoy")).cuerpo.resumen.hechas, 0, "se puede desmarcar");
});

test("el dueño le da el permiso a un cajero y ya puede crear; se lo quita y ya no", async () => {
    assert.equal((await pedir(`/equipo/${cajero}/gestor-tareas`, { metodo: "PUT", cuerpo: { permitido: true } })).status, 200);
    assert.equal((await pedir("/tareas", { metodo: "POST", quien: cajero, cuerpo: { titulo: "Ahora si puede" } })).status, 201);
    assert.equal((await pedir(`/equipo/${cajero}/gestor-tareas`, { metodo: "PUT", cuerpo: { permitido: false } })).status, 200);
    assert.equal((await pedir("/tareas", { metodo: "POST", quien: cajero, cuerpo: { titulo: "Ya no" } })).status, 403);

    assert.equal((await pedir(`/equipo/${dueno}/gestor-tareas`, { metodo: "PUT", quien: cajero, cuerpo: { permitido: true } })).status, 403, "un cajero no se da permisos solo");
});

test("editar y borrar una tarea; lo borrado ya no sale hoy", async () => {
    const lista = (await pedir("/tareas", { quien: encargado })).cuerpo.tareas;
    const t = lista.find(x => x.titulo === "Abrir y prender luces");
    assert.equal(t.repeticion, "Todos los días");

    assert.equal((await pedir(`/tareas/${t.id}`, { metodo: "PUT", quien: encargado, cuerpo: { titulo: "Abrir la tienda", repite: "diaria", hora: "08:00" } })).status, 200);
    assert.ok((await pedir("/tareas/hoy")).cuerpo.tareas.some(x => x.titulo === "Abrir la tienda"));

    assert.equal((await pedir(`/tareas/${t.id}`, { metodo: "DELETE", quien: encargado })).status, 200);
    assert.ok(!(await pedir("/tareas/hoy")).cuerpo.tareas.some(x => x.titulo === "Abrir la tienda"));
});

test("avisos: para todos o para una persona; solo los crea quien puede", async () => {
    assert.equal((await pedir("/avisos", { metodo: "POST", quien: encargado, cuerpo: { mensaje: "Mañana abrimos a las 8" } })).status, 201);
    assert.equal((await pedir("/avisos", { metodo: "POST", quien: encargado, cuerpo: { mensaje: "Luis, pasa por el cambio", para: cajero } })).status, 201);
    assert.equal((await pedir("/avisos", { metodo: "POST", quien: cajero, cuerpo: { mensaje: "no" } })).status, 403);
    assert.equal((await pedir("/avisos", { metodo: "POST", quien: encargado, cuerpo: { mensaje: "  " } })).status, 400);

    assert.equal((await pedir("/avisos", { quien: cajero })).cuerpo.avisos.length, 2, "Luis ve el de todos y el suyo");
    const marta = (await pedir("/avisos", { quien: encargado })).cuerpo.avisos;
    assert.equal(marta.length, 1, "Marta solo el de todos");
    assert.equal(marta[0].de, "Marta");
});

test("la lista de personas del equipo sirve para asignar tareas; solo un gestor ve quien puede crear tareas", async () => {
    const lista = (await pedir("/equipo/personas", { quien: encargado })).cuerpo.personas;
    assert.deepEqual(lista.map(p => p.nombre), ["Dueña", "Marta", "Luis"]);
    assert.equal(lista.find(p => p.nombre === "Marta").gestorTareas, true);
    assert.equal(lista.find(p => p.nombre === "Luis").gestorTareas, false);

    const deCajero = (await pedir("/equipo/personas", { quien: cajero })).cuerpo.personas;
    assert.ok(deCajero.every(p => !("gestorTareas" in p)), "un cajero no ve quien tiene permisos");
});

test("pantallas: Mi equipo en la computadora (Inicio, menu, asistente) y tareas en el celular quedan conectadas", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const leer = ruta => fs.readFileSync(path.join(__dirname, "..", "public", ruta), "utf8");
    const html = leer("index.html");

    assert.match(html, /<section id="pantallaMiEquipo"/);
    assert.match(html, /data-shell-module="mi-equipo" onclick="mostrarMiEquipo\(\)"/);
    assert.match(html, /js\/mi-equipo-view\.js/);
    assert.match(leer("js/config-auth.js"), /"pantallaMiEquipo"/);
    assert.match(leer("js/menu-simple.js"), /modulo: "mi-equipo"/);

    const vista = leer("js/mi-equipo-view.js");
    assert.match(vista, /window\.mostrarMiEquipo = /);
    assert.match(vista, /¿Alguien más trabaja contigo\?/);
    assert.match(leer("css/components/inicio-abarrotes.css"), /:not\(#eqTarjetaInicio\)/, "el Inicio de abarrotes no esconde la tarjeta");

    // el asistente de inicio pregunta por el equipo y lo manda a Mi equipo
    const asistente = leer("js/asistente-inicio.js");
    assert.match(asistente, /asistenteTerminar\('agregar_equipo'\)/);
    assert.match(asistente, /mostrarMiEquipo\("personas"\)/);
    assert.match(fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8"), /primerPaso: \["agregar_productos", "primera_venta", "inicio", "agregar_equipo"\]/);

    // celular
    assert.match(leer("dueno.html"), /dueno-tareas\.js/);
    assert.match(leer("dueno-sw.js"), /dueno-tareas\.js/);
    assert.match(leer("dueno.js"), /id: "tareas", titulo: "Tareas y avisos"/);
    assert.match(leer("dueno-gestion.js"), /Encargado \(puede crear tareas\)/);
});
