-- El Centro de seguridad (panel unificado de sesiones y equipos, solo Pro) ya
-- existe y esta protegido por plan desde 5554057, pero el catalogo seguia
-- marcandolo "en_desarrollo". Solo corrige la etiqueta: no cambia que plan lo
-- incluye. El Dashboard ejecutivo SI sigue en desarrollo (no hay codigo).
UPDATE public.catalogo_funciones
SET estado = 'activo'
WHERE clave = 'centro_seguridad.panel_unificado' AND estado <> 'activo';
