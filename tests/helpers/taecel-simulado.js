// Taecel de mentira para las pruebas: habla como el servicio web de la documentacion (POST form-urlencoded a /api/<metodo>) y se porta segun
// la "matriz de prueba" de Taecel. NO es Taecel: sirve para probar nuestro codigo sin dinero ni claves.
//
//   referencia 5555555505 -> exitosa            5555555515 -> falla, codigo 1 (telefono no valido)
//   referencia 5555555510 -> exitosa, pero statusTXN no responde las dos primeras veces ("en proceso")
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
    { ID: "200", Nombre: "SKY", BolsaID: "2", Tipo: "1", Comision: { ComisionCliente: "2.0000" }, montos: [], prefijo: "SKY" }
];
const PRODUCTOS = [];
CARRIERS.forEach(c => c.montos.forEach(monto => PRODUCTOS.push({ Bolsa: "Tiempo Aire", BolsaID: "1", Carrier: c.Nombre, CarrierID: c.ID, Codigo: `${c.prefijo}${String(monto).padStart(3, "0")}`, Monto: monto.toFixed(2), Vigencia: "7 DIAS", Descripcion: "Saldo de Regalo // Vigencia Total: 7 Días", Nombre: "" })));
PRODUCTOS.push({ Bolsa: "Pago de Servicios", BolsaID: "2", Carrier: "SKY", CarrierID: "200", Codigo: "SKY000", Monto: "95.00", Vigencia: "", Descripcion: "", Nombre: "" });

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
                if (!/^\d{10}$/.test(p.referencia || "")) return error(405, "Los parametros son incorrectos");

                const transID = String(++contador);
                transacciones.set(transID, { referencia: p.referencia, producto, consultas: 0, fecha: "2026-11-06 12:00:00" });
                return responder({ success: true, error: 0, message: "Consulta Exitosa", data: { transID, fecha: "2026-11-06 12:00:00" }, extra: null });
            }

            if (metodo === "statusTXN") {
                const t = transacciones.get(p.transID);
                if (!t) return error(8888, "Ocurrió un error en su solicitud");

                t.consultas += 1;
                const detalle = (status, comision) => ({ TransID: p.transID, Fecha: t.fecha, Carrier: t.producto.Carrier, Telefono: t.referencia, Folio: "378809", Status: status, Monto: `$${Number(t.producto.Monto).toFixed(2)}`, Cargo: "$0.00", Abono: "$0.00", Via: "WS", Bolsa: "Tiempo Aire", Comision: `$${comision.toFixed(2)}`, "Saldo Final": `$${(saldo - Number(t.producto.Monto) + comision).toFixed(2)}` });
                const falla = (codigo, mensaje) => responder({ success: false, error: codigo, message: mensaje, data: detalle("Fallida", 0), extra: null });

                if (t.referencia === "5555555999") return error(8888, "Ocurrió un error en su solicitud");
                if (t.referencia === "5555555510" && t.consultas <= 2) return error(8888, "Ocurrió un error en su solicitud");
                if (t.referencia === "5555555515") return falla(1, "Teléfono no válido");
                if (t.referencia === "5555555520") return falla(2, "Destino no disponible");
                if (t.referencia === "5555555530") return falla(3, "Sin respuesta del carrier");

                if (!t.cobrada) { t.cobrada = true; saldo = Math.round((saldo - Number(t.producto.Monto) + Number(t.producto.Monto) * 0.04) * 100) / 100; }

                return responder({ success: true, error: 0, message: "Recarga Exitosa", data: detalle("Exitosa", Math.round(Number(t.producto.Monto) * 4) / 100), extra: null });
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
