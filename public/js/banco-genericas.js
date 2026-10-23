/* Banco de fotos genericas (fruta, verdura y otros productos sin codigo de barras).
   Al escribir el nombre en "Agregar producto" ("platano", "tomates saladette"...) sugiere la foto de estudio
   de public/banco-genericas. Solo sugiere cuando el nombre EMPIEZA con un alias del concepto, para que
   "salsa de tomate" no reciba la foto de un tomate. Usarla guarda la foto por codigo, igual que subir una a mano. */

let bancoGenericasIndice = null;
let bancoGenericasActual = null;

function bgNormalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
}

const BG_EXCLUIR = /\b(sabor|jugo|salsa|pure|lata|enlatad[oa]s?|polvo|refresco|galleta|dulce|mermelada|aceite|crema|sopa|shampoo|jabon)\b/;

// Concepto cuyo alias (el mas largo) abre el nombre escrito; null si ninguno.
function bancoGenericasBuscar(nombre, indice) {
    const n = bgNormalizar(nombre);
    if (n.length < 3 || BG_EXCLUIR.test(n)) return null;

    let mejor = null, largo = 0;

    for (const concepto of (indice?.conceptos || [])) {
        for (const alias of concepto.alias) {
            const a = bgNormalizar(alias);
            if ((n === a || n.startsWith(a + " ")) && a.length > largo) { mejor = concepto; largo = a.length; }
        }
    }

    return mejor;
}

async function bancoGenericasCargarIndice() {
    if (bancoGenericasIndice) return bancoGenericasIndice;

    try {
        const respuesta = await fetch("/banco-genericas/indice.json");
        bancoGenericasIndice = respuesta.ok ? await respuesta.json() : { conceptos: [] };
    } catch (error) {
        bancoGenericasIndice = { conceptos: [] };
    }

    return bancoGenericasIndice;
}

function bancoGenericasQuitarTarjeta() {
    document.getElementById("tarjetaBancoGenericas")?.remove();
    bancoGenericasActual = null;
}

async function bancoGenericasSugerir() {
    const campo = document.getElementById("nuevoNombre");
    if (!campo) return;

    // Si ya hay foto del negocio, del Banco por codigo o del catalogo del proveedor, esas mandan.
    const yaHayFoto = Boolean(document.querySelector("#productoFormImagenPreview img")) || document.getElementById("tarjetaBancoImagenesNexo");
    const concepto = yaHayFoto ? null : bancoGenericasBuscar(campo.value, await bancoGenericasCargarIndice());

    if (!concepto) { bancoGenericasQuitarTarjeta(); return; }
    if (bancoGenericasActual?.slug === concepto.slug && document.getElementById("tarjetaBancoGenericas")) return;

    bancoGenericasActual = concepto;
    // Junto a la foto, donde ya aparece la tarjeta del Banco de Nexo; si no existe ese campo, bajo el nombre.
    const destino = document.getElementById("nuevaImagenProducto")?.closest(".campo-ficha") || campo.closest(".campo-ficha") || campo.parentElement;
    let tarjeta = document.getElementById("tarjetaBancoGenericas");

    if (!tarjeta) {
        tarjeta = document.createElement("div");
        tarjeta.id = "tarjetaBancoGenericas";
        tarjeta.className = "tarjeta-banco-imagenes";
        destino.insertAdjacentElement("afterend", tarjeta);
    }

    tarjeta.innerHTML = `
    <span class="tarjeta-banco-imagenes-kicker">Foto sugerida</span>
    <div class="tarjeta-banco-imagenes-cuerpo">
        <img src="/banco-genericas/${encodeURIComponent(concepto.archivo)}" alt="Foto de ${escaparPOS(concepto.nombre)}">
        <div class="tarjeta-banco-imagenes-datos"><span>${escaparPOS(concepto.nombre)}</span><span>${escaparPOS(concepto.categoria)}</span></div>
    </div>
    <div class="tarjeta-banco-imagenes-acciones"><button type="button" class="tarjeta-banco-imagenes-usar" onclick="usarFotoGenerica()">Usar esta foto</button></div>`;
}

async function usarFotoGenerica() {
    const concepto = bancoGenericasActual;
    if (!concepto) return;

    const codigo = normalizarCodigo(document.getElementById("nuevoCodigo")?.value || document.getElementById("nuevoCodigoInterno")?.value || "");

    if (!codigo) {
        await alertaPOS("Este producto todavia no tiene codigo. Escribe primero el codigo de barras o el codigo interno.", "Falta codigo", "alerta");
        return;
    }

    try {
        const blob = await (await fetch(`/banco-genericas/${encodeURIComponent(concepto.archivo)}`)).blob();
        const imagenBase64 = await redimensionarImagenCanvas(new File([blob], concepto.archivo, { type: blob.type }), 320);

        const respuesta = await fetch(`/fotos-producto/${codigo}/principal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagenBase64 })
        });

        const datos = await respuesta.json();
        if (!datos.ok) throw new Error(datos.error || "No se pudo guardar la foto");

        codigoImagenExistenteActual = codigo;
        marcarImagenProductoEncontrada(true);
        mostrarImagenPreviewProducto(imagenBase64);
        bancoGenericasQuitarTarjeta();
    } catch (error) {
        await alertaPOS(error.message || "No se pudo guardar la foto.", "Error", "alerta");
    }
}

if (typeof document !== "undefined") document.addEventListener("input", evento => {
    if (evento.target?.id === "nuevoNombre") {
        clearTimeout(bancoGenericasSugerir.espera);
        bancoGenericasSugerir.espera = setTimeout(bancoGenericasSugerir, 350);
    }
});

if (typeof module !== "undefined") module.exports = { bancoGenericasBuscar, bgNormalizar };
