-- Reanudabilidad de la sincronizacion de catalogos.
--
-- El problema: una carga completa de TRUPER son ~4 horas leyendo 7.932
-- unidades, y todo se aplicaba en UNA transaccion al final. Si el proceso
-- moria a las 3h50m -- un apagon, un corte de internet -- se perdia todo.
-- Con lotes, cada modulo se confirma por su cuenta y lo ya hecho queda.
--
-- El invariante que no se puede romper: la firma de una unidad ("esto ya
-- se leyo") se graba en la MISMA transaccion que los productos que salieron
-- de ella. Si no se guardan los precios, no se guarda la firma -- porque
-- una firma sin precios hace que nadie vuelva a leer ese modulo hasta que
-- el fabricante cambie la imagen, y ese precio se pierde para siempre.

ALTER TABLE public.catalogo_fabricante_sincronizaciones
    -- Sin latido no hay forma de distinguir "corrida de 4 horas que va
    -- bien" de "proceso muerto": cerrarCorridasHuerfanas() miraba
    -- iniciada_en y a los 30 minutos daba por muerta una corrida VIVA.
    ADD COLUMN IF NOT EXISTS latido_en TIMESTAMPTZ,
    -- Una confirmacion de regeneracion masiva es del operador sobre un
    -- evento de la fuente, no de un proceso: si la corrida que la traia
    -- murio, la siguiente la hereda. La de baja masiva NUNCA se hereda:
    -- es la unica proteccion dura contra descontinuar media tienda.
    ADD COLUMN IF NOT EXISTS confirmo_regeneracion BOOLEAN NOT NULL DEFAULT false;

-- Antes de crear el indice hay que dejar una sola corrida viva por
-- fabricante: las anteriores son de procesos que ya no existen.
UPDATE public.catalogo_fabricante_sincronizaciones s
   SET estado = 'error',
       detalle = 'cerrada por la migracion de reanudabilidad',
       terminada_en = NOW()
 WHERE estado = 'en_curso'
   AND id < (SELECT MAX(id) FROM public.catalogo_fabricante_sincronizaciones x
              WHERE x.fabricante = s.fabricante AND x.estado = 'en_curso');

-- Un solo dueno por fabricante, garantizado por Postgres. La variable
-- `corridaEnCurso` de catalogo-fabricante-server.js vive en memoria de un
-- proceso y no protege contra scripts/bootstrap-truper.js corriendo
-- aparte. Se prefirio esto a un advisory lock: no retiene una conexion
-- del pool durante 4 horas y no depende de como este configurado pgbouncer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cat_fab_sinc_una_viva
    ON public.catalogo_fabricante_sincronizaciones (fabricante) WHERE estado = 'en_curso';
