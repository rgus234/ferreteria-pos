const crypto = require("crypto");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

function hashPassword(passwordPlano) {
    const salt = crypto.randomBytes(16);

    const derivada = crypto.scryptSync(
        String(passwordPlano),
        salt,
        KEYLEN,
        { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
    );

    return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derivada.toString("hex")}`;
}

function verificarPassword(passwordPlano, hashAlmacenado) {
    if (!hashAlmacenado) return false;

    const partes = String(hashAlmacenado).split(":");

    if (partes.length !== 6 || partes[0] !== "scrypt") return false;

    const [, n, r, p, saltHex, hashHex] = partes;

    let derivada;

    try {
        derivada = crypto.scryptSync(
            String(passwordPlano),
            Buffer.from(saltHex, "hex"),
            hashHex.length / 2,
            { N: Number(n), r: Number(r), p: Number(p) }
        );
    } catch (error) {
        return false;
    }

    const esperado = Buffer.from(hashHex, "hex");

    return derivada.length === esperado.length && crypto.timingSafeEqual(derivada, esperado);
}

module.exports = { hashPassword, verificarPassword };
