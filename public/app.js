let carrito = [];
let grafica = null;
let todosProductos = [];

async function iniciarSesion() {

    document.getElementById(
        "login"
    ).style.display = "none";

    document.getElementById(
        "sistema"
    ).style.display = "block";

    await cargarProductos();

    cargarHistorial();

    actualizarDashboard();
}

async function cargarProductos() {

    const respuesta =
        await fetch("/productos");

    todosProductos =
        await respuesta.json();

    mostrarProductos(
        todosProductos
    );

    actualizarDashboard();

    actualizarInventarioBajo();
}

function actualizarDashboard() {

    const total =
        document.getElementById(
            "totalProductos"
        );

    if (total) {

        total.textContent =
            todosProductos.length;
    }

    const bajos =
        todosProductos.filter(
            p =>
                Number(p.stock) <= 5
        );

    const totalBajos =
        document.getElementById(
            "totalBajos"
        );

    if (totalBajos) {

        totalBajos.textContent =
            bajos.length;
    }
}

function actualizarInventarioBajo() {

    const contenedor =
        document.getElementById(
            "inventarioBajo"
        );

    if (!contenedor) return;

    const bajos =
        todosProductos.filter(
            p =>
                Number(p.stock) <= 5
        );

    contenedor.innerHTML = "";

    if (
        bajos.length === 0
    ) {

        contenedor.innerHTML =
            "<p>✅ Sin alertas</p>";

        return;
    }

    bajos.forEach(p => {

        contenedor.innerHTML += `

        <div>
            🔴 ${p.nombre}
            — Stock:
            ${p.stock}
        </div>
        `;
    });
}

function buscarProductos() {

    const texto =
        document.getElementById(
            "busqueda"
        ).value
        .toLowerCase();

    const filtrados =
        todosProductos.filter(
            producto =>

                producto.nombre
                    .toLowerCase()
                    .includes(texto)

                ||

                String(
                    producto.codigo || ""
                ).includes(texto)
        );

    mostrarProductos(
        filtrados
    );
}

function buscarCodigoEnter(event) {

    if (
        event.key !== "Enter"
    ) return;

    event.preventDefault();

    const input =
        document.getElementById(
            "busqueda"
        );

    const codigo =
        input.value.trim();

    // Si está vacío:
    // pasar a dinero
    if (!codigo) {

        document
            .getElementById(
                "dinero"
            )
            ?.focus();

        return;
    }

    const producto =
        todosProductos.find(
            p =>

                String(
                    p.codigo || ""
                ).trim() === codigo

                ||

                String(
                    p.id || ""
                ).trim() === codigo
        );

    if (!producto) {

        alert(
            "Producto no encontrado"
        );

        return;
    }

    agregar(
    producto.id,
    producto.nombre,
    producto.precio
);

// limpiar buscador
input.value = "";

buscarProductos();

// regresar al buscador
setTimeout(() => {

    document
        .getElementById(
            "busqueda"
        )
        ?.focus();

}, 50);

return;
}

function mostrarProductos(productos) {

    const contenedor =
        document.getElementById(
            "productos"
        );

    if (!contenedor) return;

    contenedor.innerHTML = "";

    productos.forEach(producto => {

        contenedor.innerHTML += `

        <div class="producto">

            <h2>
                ${producto.nombre}
            </h2>

            <p>
                Precio: $${producto.precio}
            </p>

            <p>
                Stock: ${producto.stock}
            </p>

            <button onclick="agregar(
                ${producto.id},
                '${producto.nombre}',
                ${producto.precio}
            )">
                Agregar
            </button>

            <button onclick="editarProducto(
                ${producto.id},
                '${producto.nombre}',
                ${producto.precio},
                ${producto.stock},
                '${producto.codigo || ""}'
            )">
                ✏️ Editar
            </button>

            <button onclick="eliminarProducto(
                ${producto.id}
            )">
                🗑 Eliminar
            </button>

        </div>
        `;
    });
}

function agregar(
    id,
    nombre,
    precio
) {

    carrito.push({
        id,
        nombre,
        precio
    });

    actualizarCarrito();
}

function eliminar(index) {

    carrito.splice(
        index,
        1
    );

    actualizarCarrito();
}

function limpiarCarrito() {

    carrito = [];

    actualizarCarrito();
}

function calcularCambio(total) {

    const dinero =
        Number(
            document.getElementById(
                "dinero"
            )?.value || 0
        );

    const cambio =
        dinero - total;

    const texto =
        document.getElementById(
            "cambioTexto"
        );

    if (!texto) return;

    texto.textContent =

        cambio >= 0

        ? `Cambio: $${cambio}`

        : "Dinero insuficiente";
}

function actualizarCarrito() {

    const contenedor =
        document.getElementById(
            "carrito"
        );

    if (!contenedor) return;

    contenedor.innerHTML = "";

    let total = 0;

    carrito.forEach(
        (p, i) => {

            total +=
                Number(
                    p.precio
                );

            contenedor.innerHTML += `

            <div class="item-carrito">

                <span>
                    ${p.nombre}
                </span>

                <span>
                    $${p.precio}
                </span>

                <button onclick="eliminar(${i})">
                    X
                </button>

            </div>
            `;
        }
    );

    contenedor.innerHTML += `

    <div class="caja">

        <h3>
            💰 Subtotal:
            $${total}
        </h3>

       <input
    type="number"
    id="dinero"
    placeholder="Dinero recibido"
    oninput="calcularCambio(${total})"
    onkeydown="cobrarConEnter(event, ${total})"
>
        <h3 id="cambioTexto">
            Cambio: $0
        </h3>

        <button onclick="cobrar(${total})">
            ✅ Cobrar
        </button>

        <button onclick="limpiarCarrito()">
            🗑 Limpiar
        </button>

    </div>
    `;
}

async function cobrar(total) {

    const dinero =
        Number(
            document.getElementById(
                "dinero"
            ).value
        );

    if (
        dinero < total
    ) {

        alert(
            "Dinero insuficiente"
        );

        return;
    }

    const cambio =
        dinero - total;

    await fetch(
        "/ventas",
        {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({
                total,
                productos: carrito
            })
        }
    );

    const cambioTexto =
    document.getElementById(
        "cambioTexto"
    );

if (cambioTexto) {

    cambioTexto.textContent =
        `✅ Venta realizada | Cambio: $${cambio}`;
}
const fecha =
    new Date()
        .toLocaleString(
            "es-MX"
        );

let ticket = `

<div style="
    width:300px;
    font-family:monospace;
    padding:20px;
    color:black;
">

    <div style="
        text-align:center;
        margin-bottom:12px;
    ">

        <h2 style="
            margin:0;
            font-size:22px;
        ">
            🔨 FERRETERÍA
        </h2>

        <h2 style="
            margin:0;
            font-size:22px;
        ">
            OLÍMPICO
        </h2>

        <div>
            Río Grande, Zac.
        </div>

        <div>
            ${fecha}
        </div>

    </div>

    <hr>

`;

carrito.forEach(p => {

    ticket += `

    <div style="
        display:flex;
        justify-content:space-between;
        margin:6px 0;
    ">

        <span>
            ${p.nombre}
        </span>

        <span>
            $${p.precio}
        </span>

    </div>
    `;
});

ticket += `

    <hr>

    <div style="
        display:flex;
        justify-content:space-between;
        font-weight:bold;
    ">
        <span>TOTAL</span>
        <span>$${total}</span>
    </div>

    <div style="
        display:flex;
        justify-content:space-between;
    ">
        <span>RECIBIDO</span>
        <span>$${dinero}</span>
    </div>

    <div style="
        display:flex;
        justify-content:space-between;
    ">
        <span>CAMBIO</span>
        <span>$${cambio}</span>
    </div>

    <hr>

    <div style="
        text-align:center;
        margin-top:12px;
        font-size:14px;
    ">

        Gracias por su compra 🔨

    </div>

</div>
`;
const ventana =
    window.open(
        "",
        "_blank",
        "width=420,height=700"
    );
ventana.document.write(`

<html>

<head>

<title>
Ticket
</title>

</head>

<body>

${ticket}

<script>
window.print();
</script>

</body>

</html>

`);

    carrito = [];

    actualizarCarrito();

    cargarProductos();

    cargarHistorial();
}

async function cargarHistorial() {

    const respuesta =
        await fetch(
            "/historial"
        );

    const historial =
        await respuesta.json();

    const contenedor =
        document.getElementById(
            "historial"
        );

    const ultimas =
        document.getElementById(
            "ultimasVentas"
        );

    const conteo =
        document.getElementById(
            "conteoVentas"
        );

    if (conteo) {

        conteo.textContent =
            historial.length;
    }

    if (contenedor) {

        contenedor.innerHTML = "";
    }

    if (ultimas) {

        ultimas.innerHTML = "";
    }

    historial.forEach(
        venta => {

            if (contenedor) {

                contenedor.innerHTML += `

                <div>
                    🧾 Venta:
                    $${venta.total}
                </div>
                `;
            }

            if (ultimas) {

                ultimas.innerHTML += `

                <div>
                    🧾 Venta registrada
                </div>
                `;
            }
        }
    );
}

function mostrarInicio() {

    document.getElementById(
        "pantallaInicio"
    ).style.display =
        "block";

    document.getElementById(
        "pantallaPuntoVenta"
    ).style.display =
        "none";
}

function mostrarPuntoVenta() {

    document.getElementById(
        "pantallaInicio"
    ).style.display =
        "none";

    document.getElementById(
        "pantallaPuntoVenta"
    ).style.display =
        "block";
}

function mostrarInventario() {

    mostrarPuntoVenta();

    cargarProductos();
}

function mostrarInventarioBajo() {

    mostrarInicio();
}

function mostrarGraficas() {

    alert(
        "📊 Reportes próximamente"
    );
}

function cambiarModo() {

    document.body.classList.toggle(
        "oscuro"
    );
}

async function agregarProductoNuevo() {

    const nombre =
        document.getElementById(
            "nuevoNombre"
        ).value;

    const precio =
        document.getElementById(
            "nuevoPrecio"
        ).value;

    const stock =
        document.getElementById(
            "nuevoStock"
        ).value;

    const codigo =
        document.getElementById(
            "nuevoCodigo"
        ).value;

    if (
        !nombre ||
        !precio ||
        !stock
    ) {

        alert(
            "Completa los campos"
        );

        return;
    }

    await fetch(
        "/agregar-producto",
        {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({
                nombre,
                precio,
                stock,
                codigo
            })
        }
    );

    document.getElementById(
        "nuevoNombre"
    ).value = "";

    document.getElementById(
        "nuevoPrecio"
    ).value = "";

    document.getElementById(
        "nuevoStock"
    ).value = "";

    document.getElementById(
        "nuevoCodigo"
    ).value = "";

    cargarProductos();

    alert(
        "Producto agregado ✅"
    );
}

function editarProducto(
    id,
    nombre,
    precio,
    stock,
    codigo
) {

    document.getElementById(
        "nuevoNombre"
    ).value =
        nombre;

    document.getElementById(
        "nuevoPrecio"
    ).value =
        precio;

    document.getElementById(
        "nuevoStock"
    ).value =
        stock;

    document.getElementById(
        "nuevoCodigo"
    ).value =
        codigo || "";

    eliminarProducto(id);
}

async function eliminarProducto(id) {

    await fetch(
        `/eliminar-producto/${id}`,
        {
            method: "DELETE"
        }
    );

    cargarProductos();
}

window.onload =
    async () => {

        await iniciarSesion();

        const input =
            document.getElementById(
                "busqueda"
            );

        if (input) {

            input.addEventListener(
                "keydown",
                buscarCodigoEnter
            );
        }

}

function cobrarConEnter(
    event,
    total
) {
    if (
        event.key === "Enter"
    ) {

        event.preventDefault();

        cobrar(total);

        setTimeout(() => {

            document
                .getElementById(
                    "busqueda"
                )
                ?.focus();

        }, 400);
    }
}