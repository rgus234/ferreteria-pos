const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { net } = require("electron");

const EXTENSIONES_CACHEABLES = /\.(js|css|html|png|jpe?g|svg|webp|ico|gif|woff2?|ttf)$/i;

function esRecursoDeAppShell(url, hostsPermitidos) {
  let analizada;
  try {
    analizada = new URL(url);
  } catch {
    return false;
  }

  if (!hostsPermitidos.has(analizada.hostname)) return false;
  if (analizada.pathname === "/") return true;
  return EXTENSIONES_CACHEABLES.test(analizada.pathname);
}

function claveCache(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

/**
 * Intercepta las peticiones https de la sesion para guardar en disco una
 * copia de los archivos que arman la interfaz (HTML/JS/CSS/imagenes) cada
 * vez que cargan bien, y poder servir esa copia si la red falla -- sin
 * esto la app no podia ni arrancar sin internet, sin importar que tan
 * reciente fuera la ultima vez que si conecto. Nunca compite con una
 * carga en vivo: solo se usa cuando net.fetch() truena.
 *
 * bypassCustomProtocolHandlers:true es obligatorio en las dos llamadas a
 * net.fetch() de aqui abajo -- sin el, un net.fetch("https://...") hecho
 * DENTRO de un protocol.handle("https", ...) se vuelve a interceptar a si
 * mismo por el mismo handler (documentado en electron.d.ts). Eso crea
 * recursion infinita en cada carga: se confirmo en vivo generando ~64,000
 * llamadas en 8 segundos para una sola navegacion, la promesa de
 * mainWindow.loadURL() nunca se resuelve, y tras el timeout de 20s la app
 * cae a "Sin conexion a internet" -- CON internet funcionando. Bug real,
 * presente desde que se agrego esta cache (commit 780e8f9), nunca antes
 * detectado porque en las pruebas manuales previas la app ya tenia cache
 * local de una corrida anterior y ese camino no se ejercito con la misma
 * severidad senal a senal.
 */
function activarCacheDeAppShell(sesion, cacheDir, hostsPermitidos) {
  sesion.protocol.handle("https", async request => {
    if (request.method !== "GET" || !esRecursoDeAppShell(request.url, hostsPermitidos)) {
      return net.fetch(request, { bypassCustomProtocolHandlers: true });
    }

    const clave = claveCache(request.url);
    const rutaCuerpo = path.join(cacheDir, `${clave}.body`);
    const rutaMeta = path.join(cacheDir, `${clave}.json`);

    try {
      const respuesta = await net.fetch(request, { bypassCustomProtocolHandlers: true });

      if (respuesta.ok) {
        const buffer = Buffer.from(await respuesta.clone().arrayBuffer());
        fs.mkdir(cacheDir, { recursive: true })
          .then(() => Promise.all([
            fs.writeFile(rutaCuerpo, buffer),
            fs.writeFile(rutaMeta, JSON.stringify({
              contentType: respuesta.headers.get("content-type") || "application/octet-stream"
            }))
          ]))
          .catch(() => {});
      }

      return respuesta;
    } catch (error) {
      try {
        const [buffer, metaRaw] = await Promise.all([
          fs.readFile(rutaCuerpo),
          fs.readFile(rutaMeta, "utf8")
        ]);
        const meta = JSON.parse(metaRaw);

        return new Response(buffer, {
          status: 200,
          headers: { "content-type": meta.contentType }
        });
      } catch {
        throw error;
      }
    }
  });
}

module.exports = { activarCacheDeAppShell, esRecursoDeAppShell, claveCache };
