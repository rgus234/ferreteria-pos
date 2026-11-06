/* Bascula digital y venta por importe en la computadora.

   Lo que hace: lee el peso de una bascula por puerto serie / USB (Web Serial) y lo entrega a la ventana de peso, que muestra una barra
   que va de rojo a verde conforme se acerca a la meta ("quiero $50" -> 0.278 kg). Tambien da las cuentas de "vender por importe".
   Sin bascula no cambia nada: el peso se sigue tecleando. Solo funciona con la funcion nueva "bascula" encendida.

   Cada modelo de bascula manda el peso con su propio formato (velocidad, texto). El lector entiende los mas comunes
   ("ST,GS,+000.278kg", "  0.278 kg", "W 0.278kg") y la velocidad se elige en la ventana. */

(function (raiz) {
    const TOLERANCIA = 0.03; // 3 %: dentro de esto se cobra lo que pidio el cliente
    const BANDA_CASI = 0.8; // desde aqui deja de ser "falta" y pasa a "casi"
    const BANDA_LISTO = 0.97;
    const MS_ESTABLE = 400;
    const VELOCIDADES = [9600, 4800, 2400, 19200, 1200];

    const redondear = (valor, decimales) => { const f = 10 ** decimales; return Math.round((Number(valor) + Number.EPSILON) * f) / f; };

    // "0.278 kg" -> gramos escritos como en pantalla: menos de 1 kg se ve en gramos, de ahi en adelante en kilos.
    function formatoPeso(kg) {
        const valor = Math.abs(Number(kg) || 0);
        return valor < 1 ? `${Math.round(valor * 1000)} g` : `${redondear(valor, 3)} kg`;
    }

    // Una linea de texto de la bascula -> { kg, estable } o null si no trae un peso.
    function parsearLinea(texto) {
        const linea = String(texto ?? "").trim();
        const encontrado = linea.match(/([+-]?\d+(?:[.,]\d+)?)\s*(kg|g|gr|lb|oz)?/i);

        if (!encontrado) return null;

        let valor = Number(encontrado[1].replace(",", "."));
        if (!Number.isFinite(valor)) return null;

        const unidad = String(encontrado[2] || "kg").toLowerCase();
        if (unidad === "g" || unidad === "gr") valor /= 1000;
        else if (unidad === "lb") valor *= 0.45359237;
        else if (unidad === "oz") valor *= 0.0283495231;

        const inestable = /(^|[^a-z])(us|un|unstable)([^a-z]|$)/i.test(linea);
        const estable = /^\s*st\b/i.test(linea) || /(^|[^a-z])stable([^a-z]|$)/i.test(linea) ? true : (inestable ? false : null);

        return { kg: Math.max(0, redondear(valor, 3)), estable };
    }

    // Cuanto de la unidad del producto cabe en el importe pedido ($50 de jamon a $180 el kilo -> 0.278 kg). Al gramo.
    function metaDesdeImporte(importe, precioUnidad) {
        const dinero = Number(importe);
        const precio = Number(precioUnidad);

        if (!(dinero > 0) || !(precio > 0)) return null;

        return redondear(dinero / precio, 3);
    }

    // Color y texto de la barra. kg contra meta (los dos en kilos). `estable` solo importa para marcar "Listo".
    function estadoBarra(pesoKg, metaKg, estable = true) {
        const peso = Number(pesoKg) || 0;
        const meta = Number(metaKg) || 0;

        if (!(meta > 0)) return { color: "gris", porcentaje: 0, texto: "", listo: false };
        if (!(peso > 0)) return { color: "rojo", porcentaje: 0, texto: "Pon el producto en la báscula", listo: false };

        const razon = peso / meta;
        const porcentaje = Math.min(100, Math.round(razon * 100));

        if (razon < BANDA_CASI) return { color: "rojo", porcentaje, texto: `Faltan ${formatoPeso(meta - peso)}`, listo: false };
        if (razon < BANDA_LISTO) return { color: "ambar", porcentaje, texto: `Casi, faltan ${formatoPeso(meta - peso)}`, listo: false };
        if (razon <= 1 + TOLERANCIA) return estable
            ? { color: "verde", porcentaje, texto: "Listo", listo: true }
            : { color: "verde", porcentaje, texto: "Estabilizando…", listo: false };

        return { color: "azul", porcentaje: 100, texto: `Te pasaste ${formatoPeso(peso - meta)}`, listo: false };
    }

    // Lo que se agrega al carrito en modo importe. Sin bascula: la meta. Con bascula: la meta si el peso esta dentro del 3 %,
    // y lo que realmente pesó si se alejo mas (se cobra lo justo para los dos lados).
    function cantidadImporte(metaKg, pesoKg, hayBascula) {
        const meta = Number(metaKg);

        if (!(meta > 0)) return null;
        if (!hayBascula || !(Number(pesoKg) > 0)) return meta;

        return Math.abs(Number(pesoKg) - meta) / meta <= TOLERANCIA ? meta : redondear(pesoKg, 3);
    }

    // ---------------------------------------------------------------- conexion

    let puerto = null;
    let lector = null;
    let pesoKg = 0;
    let estable = false;
    let ultimoCambio = 0;
    let temporizadorEstable = null;
    let simulada = false;
    const escuchas = new Set();

    const avisar = () => escuchas.forEach(funcion => { try { funcion({ kg: pesoKg, estable, conectada: api.conectada() }); } catch (error) { /* una pantalla que ya no existe no debe tumbar a las demas */ } });

    function actualizar(kg, marcaEstable) {
        const cambio = Math.abs(kg - pesoKg) >= 0.002;

        if (cambio) ultimoCambio = Date.now();

        pesoKg = kg;
        estable = marcaEstable === true || (marcaEstable !== false && Date.now() - ultimoCambio >= MS_ESTABLE);

        clearTimeout(temporizadorEstable);
        if (!estable && marcaEstable !== false) temporizadorEstable = setTimeout(() => { estable = true; avisar(); }, MS_ESTABLE + 20);

        avisar();
    }

    async function leerBucle(lectorActual) {
        const decodificador = new TextDecoder();
        let resto = "";

        try {
            while (puerto && lectorActual === lector) {
                const { value, done } = await lectorActual.read();
                if (done) break;

                resto += decodificador.decode(value, { stream: true });
                const lineas = resto.split(/[\r\n]+/);
                resto = lineas.pop() || "";
                if (resto.length > 200) resto = "";

                lineas.forEach(linea => {
                    const dato = parsearLinea(linea);
                    if (dato) actualizar(dato.kg, dato.estable);
                });
            }
        } catch (error) { /* se desconecto el cable */ }

        if (lectorActual === lector) await api.desconectar();
    }

    async function abrir(puertoElegido) {
        const velocidad = Number(localStorage.getItem("nexo_bascula_baudios")) || 9600;

        await puertoElegido.open({ baudRate: velocidad });
        puerto = puertoElegido;
        lector = puerto.readable.getReader();
        leerBucle(lector);
        avisar();
    }

    const api = {
        TOLERANCIA, VELOCIDADES, formatoPeso, parsearLinea, metaDesdeImporte, estadoBarra, cantidadImporte,

        disponible: () => Boolean(raiz.navigator && raiz.navigator.serial),
        conectada: () => Boolean(puerto) || simulada,
        pesoKg: () => pesoKg,
        estable: () => estable,

        velocidad: () => { try { return Number(localStorage.getItem("nexo_bascula_baudios")) || 9600; } catch (error) { return 9600; } },
        guardarVelocidad: valor => { try { localStorage.setItem("nexo_bascula_baudios", String(Number(valor) || 9600)); } catch (error) { /* sin almacenamiento */ } },

        suscribir(funcion) { escuchas.add(funcion); return () => escuchas.delete(funcion); },

        async conectar() {
            if (!api.disponible()) throw new Error("Este navegador no puede leer básculas. Usa la aplicación de escritorio de Nexo.");
            if (puerto) return;
            await abrir(await raiz.navigator.serial.requestPort());
        },

        // Al abrir la pantalla: si ya se dio permiso antes a una bascula, se reconecta sola.
        async reconectar() {
            if (puerto || !api.disponible()) return false;

            try {
                const puertos = await raiz.navigator.serial.getPorts();
                if (!puertos.length) return false;
                await abrir(puertos[0]);
                return true;
            } catch (error) { return false; }
        },

        async desconectar() {
            const lectorActual = lector;
            const puertoActual = puerto;

            lector = null;
            puerto = null;
            simulada = false;
            pesoKg = 0;
            estable = false;
            clearTimeout(temporizadorEstable);

            try { if (lectorActual) { await lectorActual.cancel(); lectorActual.releaseLock(); } } catch (error) { /* ya estaba cerrado */ }
            try { if (puertoActual) await puertoActual.close(); } catch (error) { /* ya estaba cerrado */ }

            avisar();
        },

        // Para pruebas y demostraciones: finge una bascula (kg). simular(null) la quita.
        simular(kg, marcaEstable) {
            if (kg === null || kg === undefined) { simulada = false; pesoKg = 0; estable = false; avisar(); return; }
            simulada = true;
            actualizar(Math.max(0, Number(kg) || 0), marcaEstable);
        }
    };

    raiz.nexoBascula = api;

    if (typeof module !== "undefined" && module.exports) module.exports = api;

    if (raiz.document) {
        raiz.document.addEventListener("DOMContentLoaded", () => {
            if (typeof raiz.funcionBeta === "function" && raiz.funcionBeta("bascula")) api.reconectar();
            raiz.document.addEventListener("nexo-funciones-beta", evento => { if (evento.detail && evento.detail.bascula) api.reconectar(); });
        });
    }
})(typeof window !== "undefined" ? window : globalThis);
