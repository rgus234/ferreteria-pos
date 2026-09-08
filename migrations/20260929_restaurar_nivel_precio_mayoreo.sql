-- Restaura el nivel de precio que el POS usaba ANTES de que existiera
-- este ajuste.
--
-- QUE PASO
--
-- 20260925_nivel_precio_por_defecto.sql creo la columna con
-- DEFAULT 'publico'. Parecia inofensivo: es el nivel "normal" de una
-- tienda al mostrador. No lo era.
--
-- El POS nunca habia arrancado en publico. Arrancaba en medio mayoreo, y
-- estaba escrito a mano en seis lugares de pos-sales.js:
--
--     nivelPrecioActual = "mayoreo";
--
-- Al cambiar esas seis lineas por nivelPrecioPorDefectoDelNegocio(), que
-- cae en "publico" cuando nadie configuro nada, TODOS los negocios
-- pasaron de cobrar medio mayoreo a cobrar publico. Sin que nadie tocara
-- un ajuste, el mismo dia del despliegue.
--
-- Lo reporto el dueno de Ferreteria Olimpico usandolo: un Plasti Acero
-- que el vende en $105 se cobro en $115, y una barra LED de $140 salio
-- en $155. No cobro de menos: cobro de mas, a sus clientes.
--
-- Los 13 negocios estaban en 'publico' sin haberlo elegido, asi que se
-- pasan todos a 'mayoreo': es donde estaban de verdad. No es una
-- decision comercial nueva, es deshacer una que nadie tomo.
--
-- El DEFAULT tambien cambia. Un negocio nuevo debe estrenar el mismo
-- comportamiento que tenia el producto, no uno distinto por accidente.
-- Quien quiera publico lo elige en Configuracion, que para eso esta.

ALTER TABLE public.negocios
    ALTER COLUMN nivel_precio_por_defecto SET DEFAULT 'mayoreo';

-- Todos los que hay estan en 'publico' sin haberlo elegido: la columna
-- nacio hace tres dias y nadie ha abierto ese ajuste todavia. Si en el
-- futuro alguien elige 'publico' a proposito, esta migracion ya corrio y
-- no lo va a pisar.
UPDATE public.negocios
   SET nivel_precio_por_defecto = 'mayoreo'
 WHERE nivel_precio_por_defecto = 'publico';
