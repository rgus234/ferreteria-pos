let carrito = [];
let grafica = null;
let todosProductos = [];

async function iniciarSesion() {

    document.getElementById("login")
        .style.display = "none";

    document.getElementById("sistema")
        .style.display = "block";

    cargarProductos();
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

            <button
            onclick="agregar(
                ${producto.id},
                '${producto.nombre}',
                ${producto.precio}
            )">

            Agregar

            </button>

            <button
            onclick="editarProducto(
                ${producto.id},
                '${producto.nombre}',
                ${producto.precio},
                ${producto.stock},
                '${producto.codigo || ""}'
            )">

            ✏️ Editar

            </button>

            <button
            onclick="eliminarProducto(
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

    carrito.splice(index, 1);

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

            ${p.nombre}
            - $${p.precio}

            <button
            onclick="eliminar(${i})">

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
    placeholder="Dinero recibido">

    <button
    onclick="cobrar(${total})">

    Cobrar

    </button>

    <p id="cambio"></p>
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

    await fetch("/ventas", {

        method: "POST",

        headers: {
            "Content-Type":
                "application/json"
        },

        body: JSON.stringify({

            total,
            productos: carrito
        })
    });

    document.getElementById(
        "cambio"
    ).innerHTML =

        `Cambio: $${cambio}`;

    carrito = [];

    actualizarCarrito();

    cargarProductos();
}



async function editarProducto(
    id,
    nombreActual,
    precioActual,
    stockActual,
    codigoActual
) {

    const nombre =
        prompt(
            "Nombre:",
            nombreActual
        );

    if (!nombre) return;

    const precio =
        prompt(
            "Precio:",
            precioActual
        );

    const stock =
        prompt(
            "Stock:",
            stockActual
        );

    const codigo =
        prompt(
            "Código:",
            codigoActual
        );

    await fetch(

        `/editar-producto/${id}`,

        {
            method: "PUT",

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

    cargarProductos();
}



async function eliminarProducto(id) {

    const confirmar =
        confirm(
            "¿Eliminar producto?"
        );

    if (!confirmar) return;

    await fetch(

        `/eliminar-producto/${id}`,

        {
            method: "DELETE"
        }
    );

    cargarProductos();
}



function mostrarInicio() {

    cargarProductos();

    document.getElementById("productos")
        .style.display = "block";

    document.getElementById("carrito")
        .style.display = "block";
}



function mostrarInventario() {

    cargarProductos();
}



function mostrarInventarioBajo() {

    const bajos =
        todosProductos.filter(
            producto =>
                Number(producto.stock) <= 5
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



window.onload = () => {

    iniciarSesion();
};