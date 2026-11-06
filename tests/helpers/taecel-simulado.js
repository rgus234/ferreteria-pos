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

const PRODUCTOS = [];
[["TEL", "Telcel"], ["MOV", "Movistar"], ["ATT", "AT&T"]].forEach(([prefijo, carrier]) => [10, 20, 30, 50, 100, 150, 200, 300, 500].forEach(monto => PRODUCTOS.push({ codigo: `${prefijo}${String(monto).padStart(3, "0")}`, nombre: `${carrier} $${monto}`, carrier, monto })));

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

            if (metodo === "getProducts") return responder({ success: true, error: 0, message: "Consulta Exitosa", data: { bolsas: [], carriers: [], productos: PRODUCTOS }, extra: null });

            if (metodo === "requestTXN") {
                const producto = PRODUCTOS.find(x => x.codigo === p.producto);

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
                const detalle = (status, comision) => ({ TransID: p.transID, Fecha: t.fecha, Carrier: t.producto.carrier, Telefono: t.referencia, Folio: "378809", Status: status, Monto: `$${t.producto.monto.toFixed(2)}`, Cargo: "$0.00", Abono: "$0.00", Via: "WS", Bolsa: "Tiempo Aire", Comision: `$${comision.toFixed(2)}`, "Saldo Final": `$${(saldo - t.producto.monto + comision).toFixed(2)}` });
                const falla = (codigo, mensaje) => responder({ success: false, error: codigo, message: mensaje, data: detalle("Fallida", 0), extra: null });

                if (t.referencia === "5555555999") return error(8888, "Ocurrió un error en su solicitud");
                if (t.referencia === "5555555510" && t.consultas <= 2) return error(8888, "Ocurrió un error en su solicitud");
                if (t.referencia === "5555555515") return falla(1, "Teléfono no válido");
                if (t.referencia === "5555555520") return falla(2, "Destino no disponible");
                if (t.referencia === "5555555530") return falla(3, "Sin respuesta del carrier");

                if (!t.cobrada) { t.cobrada = true; saldo = Math.round((saldo - t.producto.monto + t.producto.monto * 0.04) * 100) / 100; }

                return responder({ success: true, error: 0, message: "Recarga Exitosa", data: detalle("Exitosa", Math.round(t.producto.monto * 4) / 100), extra: null });
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
