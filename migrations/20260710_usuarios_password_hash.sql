-- Prepara la migracion de contrasenas de texto plano a hash (scrypt).
-- Puramente aditiva: no borra ni sobreescribe ninguna contrasena existente.
-- El hasheo real de las filas existentes lo hace el servidor al arrancar
-- (migrarPasswordsUsuariosPlano en server.js), no este archivo.

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE public.usuarios
ALTER COLUMN password DROP NOT NULL;
