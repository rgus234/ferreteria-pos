// Taecel de mentira para las pruebas: habla como el servicio web de la documentacion (POST form-urlencoded a /api/<metodo>) y se porta segun
// la "matriz de prueba" de Taecel. NO es Taecel: sirve para probar nuestro codigo sin dinero ni claves.
//
//   referencia 5555555505 -> exitosa            5555555515 -> falla, codigo 1 (telefono no valido)
//   referencia 5555555510 -> exitosa, pero statusTXN no responde las dos primeras veces ("en proceso")
//   referencia 5555555998 -> statusTXN siempre "En proceso"; getSales (ventas del dia) la muestra Exitosa
//   referencia 5555555999 -> statusTXN siempre falla y getSales la muestra En proceso (se queda pendiente)
//   referencia 5555555520 -> falla, codigo 2    5555555530 -> falla, codigo 3    5555555999 -> nunca da resultado final (pendiente)
//   cualquier otra        -> exitosa
const http = require("node:http");

const KEY = "KEY-DE-PRUEBA-0000000000000000000";
const NIP = "NIP-DE-PRUEBA";

// Misma forma que getProducts de Taecel: carriers y productos con Bolsa, CarrierID, Codigo, Monto, Vigencia, Descripcion. Montos reales de Telcel, Movistar y AT&T.
const CARRIERS = [
    { ID: "1", Nombre: "Telcel", BolsaID: "1", Tipo: "0", Comision: { ComisionCliente: "4.0000" }, montos: [10, 20, 30, 50, 80, 100, 150, 200, 300, 500], prefijo: "TEL" },
    { ID: "2", Nombre: "Movistar", BolsaID: "1", Tipo: "0", Comision: { ComisionCliente: "4.0000" }, montos: [10, 20, 30, 50, 60, 80, 100, 120, 150, 200, 300, 500], prefijo: "MOV" },
    { ID: "5", Nombre: "AT&T (Iusacell - Nextel)", BolsaID: "1", Tipo: "0", Comision: { ComisionCliente: "4.0000" }, montos: [10, 20, 30, 50, 70, 100, 120, 150, 200, 300], prefijo: "ATT" },
    { ID: "200", Nombre: "SKY", Logotipo: "https://cdn.taecel.com/sky.png", BolsaID: "2", Categoria: "Servicios", Tipo: "1", Comision: { ComisionCliente: "0.0000", CargoTrans: "5.0000" }, Campos: [{ Nombre: "Numero de Cuenta", Campo: "referencia", Min: "12", Max: "12", Formato: "1" }], montos: [], prefijo: "SKY" },
    { ID: "211", Nombre: "Google Play", Logotipo: "", BolsaID: "2", Categoria: "GiftCards", Tipo: "0", Comision: { ComisionCliente: "0.0000", CargoTrans: "0.0000" }, Campos: [{ Nombre: "NUMERO CELULAR", Campo: "referencia", Min: "10", Max: "10", Formato: "1" }], montos: [], prefijo: "GPL" }
];
const PRODUCTOS = [];
CARRIERS.forEach(c => c.montos.forEach(monto => PRODUCTOS.push({ Bolsa: "Tiempo Aire", BolsaID: "1", Carrier: c.Nombre, CarrierID: c.ID, Codigo: `${c.prefijo}${String(monto).padStart(3, "0")}`, Monto: monto.toFixed(2), Vigencia: "7 DIAS", Descripcion: "Saldo de Regalo // Vigencia Total: 7 Días", Nombre: "" })));
PRODUCTOS.push({ Bolsa: "Pago de Servicios", BolsaID: "2", Carrier: "SKY", CarrierID: "200", Codigo: "SKY000", Monto: "0.00", Vigencia: "", Descripcion: "", Nombre: "" });
PRODUCTOS.push({ Bolsa: "Pago de Servicios", BolsaID: "2", Carrier: "Google Play", CarrierID: "211", Codigo: "GPLAY50", Monto: "50.00", Vigencia: "", Descripcion: "", Nombre: "" });
PRODUCTOS.push({ Bolsa: "Pago de Servicios", BolsaID: "2", Carrier: "Google Play", CarrierID: "211", Codigo: "GOO01", Monto: "100.00", Vigencia: "", Descripcion: "", Nombre: "" });

function iniciar() {
    const transacciones = new Map();
    const llamadas = [];
    let contador = 260500000000;
    let saldo = 5000;

    const servidor = http.createServer((req, res) => {
        let cuerpo = "";
        req.on("data", trozo => { cuerpo += trozo; });
        req.on("end", () => {
            const metodo = req.url.replace(/^\/api\//, "");
            const p = Object.fromEntries(new URLSearchParams(cuerpo));
            llamadas.push({ metodo, parametros: { ...p } });
            const responder = objeto => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(objeto)); };
            const error = (codigo, mensaje) => responder({ success: false, error: codigo, message: mensaje, data: [], extra: null });

            if (p.key !== KEY || p.nip !== NIP) return error(403, "Usted no tiene permisos suficientes");

            if (metodo === "getBalance") return responder({ success: true, error: 0, message: "Consulta Exitosa", data: [{ ID: "1", Bolsa: "Tiempo Aire", Saldo: saldo.toLocaleString("en-US", { minimumFractionDigits: 2 }) }, { ID: "2", Bolsa: "Pago de Servicios", Saldo: "590.00" }], extra: null });

            if (metodo === "getProducts") return responder({ success: true, error: 0, message: "Consulta Exitosa", data: { bolsas: [{ ID: "1", Nombre: "Tiempo Aire" }, { ID: "2", Nombre: "Pago de Servicios" }], carriers: CARRIERS.map(({ montos, prefijo, ...c }) => c), productos: PRODUCTOS }, extra: null });

            if (metodo === "requestTXN") {
                const producto = PRODUCTOS.find(x => x.Codigo === p.producto);

                if (!producto) return error(3133, "El producto solicitado no existe");
                const esServicio = producto.BolsaID === "2";
                if (!(esServicio ? /^\d{4,30}$/ : /^\d{10}$/).test(p.referencia || "")) return error(405, "Los parametros son incorrectos");
                if (esServicio && producto.Carrier === "SKY" && !(Number(p.monto) > 0)) return error(405, "Los parametros son incorrectos");

                const transID = String(++contador);
                transacciones.set(transID, { referencia: p.referencia, producto, monto: Number(p.monto) > 0 ? Number(p.monto) : Number(producto.Monto), consultas: 0, fecha: "2026-11-06 12:00:00" });
                return responder({ success: true, error: 0, message: "Consulta Exitosa", data: { transID, fecha: "2026-11-06 12:00:00" }, extra: null });
            }

            if (metodo === "statusTXN") {
                const t = transacciones.get(p.transID);
                if (!t) return error(8888, "Ocurrió un error en su solicitud");

                t.consultas += 1;
                const servicio = t.producto.BolsaID === "2";
                const detalle = (status, comision) => ({ TransID: p.transID, Fecha: t.fecha, Carrier: t.producto.Carrier, Telefono: t.referencia, Folio: "378809", Status: status, Monto: `${t.monto.toFixed(2)}`, Cargo: servicio && t.producto.Carrier === "SKY" ? "$5.00" : "$0.00", Abono: "$0.00", Via: "WS", Bolsa: servicio ? "Pago de Servicios" : "Tiempo Aire", Comision: `${comision.toFixed(2)}`, pin: servicio && t.producto.Carrier === "Google Play" && status === "Exitosa" ? "TEST-AAAAA-BBBBB-CCCCC" : "", "Saldo Final": `${(saldo - t.monto + comision).toFixed(2)}` });
                const falla = (codigo, mensaje) => responder({ success: false, error: codigo, message: mensaje, data: detalle("Fallida", 0), extra: null });

                if (t.referencia === "5555555999") return error(8888, "Ocurrió un error en su solicitud");
                if (t.referencia === "5555555998") return responder({ success: true, error: "0", message: "Error inesperado", data: detalle("En proceso", 0), extra: null });
                if (t.referencia === "5555555510" && t.consultas <= 2) return error(8888, "Ocurrió un error en su solicitud");
                if (t.referencia === "5555555515") return falla(1, "Teléfono no válido");
                if (t.referencia === "5555555520") return falla(2, "Destino no disponible");
                if (t.referencia === "5555555530") return falla(3, "Sin respuesta del carrier");

                if (!t.cobrada) { t.cobrada = true; saldo = Math.round((saldo - t.monto + t.monto * 0.04) * 100) / 100; }

                return responder({ success: true, error: 0, message: "Recarga Exitosa", data: detalle("Exitosa", Math.round(t.monto * 4) / 100), extra: null });
            }

            if (metodo === "getSales") {
                const ventas = [...transacciones.entries()].map(([transID, t]) => {
                    const status = t.referencia === "5555555999" ? "En proceso" : t.referencia === "5555555515" || t.referencia === "5555555520" || t.referencia === "5555555530" ? "Fracasada " : "Exitosa";
                    return { TransID: transID, Fecha: t.fecha, Carrier: t.producto.Carrier, Telefono: t.referencia, Folio: status === "Exitosa" ? "555111" : "", Status: status, Monto: `${t.monto.toFixed(2)}`, Bolsa: "Tiempo Aire", Comision: `${(t.monto * 0.04).toFixed(2)}`, "Saldo Final": "$4,000.00" };
                });
                return responder({ success: true, error: 0, message: "Consulta Exitosa", data: ventas, extra: null });
            }

            return error(8888, "Ocurrió un error en su solicitud");
        });
    });

    return new Promise(resolver => servidor.listen(0, "127.0.0.1", () => resolver({
        url: `http://127.0.0.1:${servidor.address().port}`,
        key: KEY,
        nip: NIP,
        llamadas,
        cerrar: () => new Promise(r => servidor.close(r))
    })));
}

module.exports = { iniciar, KEY, NIP, PRODUCTOS };
