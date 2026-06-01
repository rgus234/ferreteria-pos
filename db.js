const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

module.exports = pool;
const catalogo = [
    {
        codigo: "7500001",
        nombre: "Pinza electricista 9",
        distribuidor: 118,
        medioMayoreo: 129,
        publico: 149,
        stockMinimo: 3,
        altaRotacion: "si"
    },

    {
        codigo: "7500002",
        nombre: "Martillo uña 16oz",
        distribuidor: 90,
        medioMayoreo: 100,
        publico: 120,
        stockMinimo: 2,
        altaRotacion: "no"
    }
];