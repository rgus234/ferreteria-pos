let carrito = [];
let grafica = null;
let todosProductos = [];

async function iniciarSesion() {
    document.getElementById("login").style.display = "none";
    document.getElementById("sistema").style.display = "block";

    cargarProductos();
    cargarHistorial();
}

async function cargarProductos() {

    const respuesta =
        await fetch("/productos");

    todosProductos =
        await respuesta.json();

    mostrarProductos(
        todosProductos
    );
}

function buscarProductos() {

    const texto =
        document.getElementById(
            "busqueda"
        ).value.toLowerCase();

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

    console.log(
        "ENTER DETECTADO:",
        event.key
    );

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

    if (!codigo) return;

    const producto =
        todosProductos.find(
            p =>

                String(
                    p.codigo || ""
                ).trim() === codigo.trim()

                ||

                String(
                    p.id || ""
                ).trim() === codigo.trim()
        );

    console.log(
        "Buscando:",
        codigo,
        todosProductos
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

    input.value = "";

    buscarProductos();
}

function mostrarProductos(productos) {

    const contenedor =
        document.getElementById(
            "productos"
        );

    contenedor.innerHTML = "";

    productos.forEach(producto => {

        contenedor.innerHTML += `

        <div class="producto">

            <h2>${producto.nombre}</h2>

            <p>Precio: $${producto.precio}</p>

            <p>Stock: ${producto.stock}</p>

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

function agregar(id, nombre, precio) {

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

function actualizarCarrito() {

    const contenedor =
        document.getElementById(
            "carrito"
        );

    contenedor.innerHTML = "";

    let total = 0;

    carrito.forEach((p, i) => {

        total +=
            Number(p.precio);

        contenedor.innerHTML += `

        <div>
            ${p.nombre} - $${p.precio}

            <button onclick="eliminar(${i})">
                X
            </button>
        </div>
        `;
    });

    contenedor.innerHTML += `

    <h3>Total: $${total}</h3>

    <input
        type="number"
        id="dinero"
        placeholder="Dinero recibido"
    >

    <button onclick="cobrar(${total})">
        Cobrar
    </button>
    `;
}

async function cobrar(total) {

    const dinero =
        Number(
            document.getElementById(
                "dinero"
            ).value
        );

    if (dinero < total) {

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

    alert(
        `Venta realizada ✅ Cambio: $${cambio}`
    );

    carrito = [];

    actualizarCarrito();

    cargarProductos();

    cargarHistorial();
}

async function cargarHistorial() {

    const respuesta =
        await fetch("/historial");

    const historial =
        await respuesta.json();

    const contenedor =
        document.getElementById(
            "historial"
        );

    contenedor.innerHTML = "";

    historial.forEach(venta => {

        contenedor.innerHTML += `

        <div>
            🧾 Venta: $${venta.total}
        </div>
        `;
    });
}

function mostrarInicio() {
    cargarProductos();
    cargarHistorial();
}

function mostrarInventario() {
    cargarProductos();
}

function mostrarInventarioBajo() {

    const bajos =
        todosProductos.filter(
            producto =>
                Number(
                    producto.stock
                ) <= 5
        );

    mostrarProductos(
        bajos
    );
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
    ).value = nombre;

    document.getElementById(
        "nuevoPrecio"
    ).value = precio;

    document.getElementById(
        "nuevoStock"
    ).value = stock;

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
window.onload = async () => {

    await iniciarSesion();

    const inputBusqueda =
        document.getElementById(
            "busqueda"
        );

    if (inputBusqueda) {

        inputBusqueda.addEventListener(
            "keydown",
            buscarCodigoEnter
        );
    }
};