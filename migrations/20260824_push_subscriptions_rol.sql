-- Hasta ahora una suscripcion push tipo='admin' solo sabia a que
-- negocio pertenecia, nunca si quien la activo era el dueño o un
-- empleado -- asi que un aviso de venta/credito (dinero) le llegaba
-- por igual a cualquiera. El dueño pidio explicitamente que el dinero
-- (ventas, abonos, cargos a credito) solo le llegue a el; los pedidos
-- nuevos de Market siguen llegando a todos como hasta ahora.
--
-- rol se llena a partir de la sesion que hizo POST /negocio-actual/
-- push/suscribir (req.negocioAutenticado.rol de rbac.js -- 'employee'
-- o NULL/'owner' para una sesion clasica de dueño). Filas ya
-- existentes (creadas antes de esta migracion) quedan con rol=NULL,
-- que se trata igual que 'owner' para no dejar de avisarle a nadie
-- que ya se habia suscrito.

ALTER TABLE public.push_subscriptions
    ADD COLUMN IF NOT EXISTS rol TEXT CHECK (rol IS NULL OR rol IN ('owner', 'employee'));
