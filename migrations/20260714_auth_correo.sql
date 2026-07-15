-- Autenticacion real por correo a nivel negocio (dueno), separada del
-- PIN local del cajero. correo pasa a ser el identificador de la
-- cuenta: se agrega password_hash (mismo formato scrypt de
-- password-utils.js, ya usado en public.usuarios) y un indicador de
-- verificacion. El indice unico evita que dos negocios compartan el
-- mismo correo -- LOWER() porque el login normaliza a minusculas.

ALTER TABLE public.negocios
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS correo_verificado BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_negocios_correo_unico
    ON public.negocios (LOWER(correo))
    WHERE correo IS NOT NULL;

-- Verificacion de correo: sirve tanto para el registro inicial como
-- para cuando el dueno cambia de correo despues (se vuelve a
-- verificar el nuevo). Guarda el correo junto al token porque puede
-- no coincidir todavia con negocios.correo (verificacion pendiente).
CREATE TABLE IF NOT EXISTS public.verificaciones_correo (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    correo TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expira_at TIMESTAMPTZ NOT NULL,
    usado_at TIMESTAMPTZ,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verificaciones_correo_negocio ON public.verificaciones_correo(negocio_id);

-- Recuperacion de contrasena (codigo de 6 digitos) y tambien el
-- mecanismo de "activa tu cuenta" para negocios que ya existian antes
-- de este sistema (mismo flujo, un correo distinto).
CREATE TABLE IF NOT EXISTS public.restablecimientos_password (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    intentos INTEGER NOT NULL DEFAULT 0,
    expira_at TIMESTAMPTZ NOT NULL,
    usado_at TIMESTAMPTZ,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restablecimientos_password_negocio ON public.restablecimientos_password(negocio_id);

-- Sesiones de cuenta: token opaco (no JWT) guardado hasheado, para
-- poder listar "dispositivos con sesion iniciada" y revocar una por
-- una o todas juntas -- eso no se puede hacer con un JWT sin estado.
CREATE TABLE IF NOT EXISTS public.sesiones_cuenta (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    dispositivo TEXT,
    ip TEXT,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_uso_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revocado_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sesiones_cuenta_negocio ON public.sesiones_cuenta(negocio_id);

-- Bitacora real de intentos de login (a diferencia del limitador en
-- memoria, esta persiste y sobrevive un reinicio del servidor).
-- negocio_id puede ser NULL cuando el correo intentado no existe.
CREATE TABLE IF NOT EXISTS public.intentos_login (
    id SERIAL PRIMARY KEY,
    negocio_id INTEGER REFERENCES public.negocios(id) ON DELETE SET NULL,
    correo_intentado TEXT,
    ip TEXT,
    exito BOOLEAN NOT NULL,
    creado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intentos_login_negocio ON public.intentos_login(negocio_id);
