/* Recordatorios de caja -- avisa si nadie ha abierto turno al entrar
   al sistema, y avisa antes de irse si ya paso la hora de cierre
   habitual del negocio y el turno sigue abierto. Reusa el mismo
   endpoint que ya usa la pantalla de Caja (/caja/turno-activo) y el
   toast no bloqueante ya existente (mostrarToastPOS). Un aviso por
   dia por equipo -- no se repite cada vez que se recarga la pagina. */

const CAJA_RECORDATORIO_APERTURA_KEY = "cajaRecordatorioAperturaFecha";
const CAJA_RECORDATORIO_CIERRE_KEY = "cajaRecordatorioCierreFecha";
const CAJA_RECORDATORIO_INTERVALO_MS = 5 * 60 * 1000;

let cajaRecordatorioCierreIniciado = false;

function fechaHoyPOS() {
 return new Date().toISOString().slice(0, 10);
}

async function hayTurnoAbiertoCajaPOS() {
 try {
  const respuesta = await fetch("/caja/turno-activo");
  const datos = await respuesta.json();
  return Boolean(datos?.turno);
 } catch (error) {
  return null;
 }
}

async function revisarAperturaCajaPOS() {
 if (localStorage.getItem(CAJA_RECORDATORIO_APERTURA_KEY) === fechaHoyPOS()) return;

 const hayTurno = await hayTurnoAbiertoCajaPOS();
 if (hayTurno !== false) return;

 localStorage.setItem(CAJA_RECORDATORIO_APERTURA_KEY, fechaHoyPOS());

 mostrarToastPOS("Todavia no has abierto la caja hoy.", {
  titulo: "Caja cerrada",
  tipo: "alerta",
  accion: {
   texto: "Abrir caja ahora",
   onClick: () => {
    if (typeof mostrarCajaPOS === "function") mostrarCajaPOS();
   }
  }
 });
}

async function revisarCierreCajaPOS() {
 const horaCierre = estadoLicenciaNexoPOS?.horaCierre;
 if (!horaCierre) return;

 if (localStorage.getItem(CAJA_RECORDATORIO_CIERRE_KEY) === fechaHoyPOS()) return;

 const ahora = new Date();
 const [horas, minutos] = horaCierre.split(":").map(Number);
 const limite = new Date(ahora);
 limite.setHours(horas, minutos, 0, 0);

 if (ahora < limite) return;

 const hayTurno = await hayTurnoAbiertoCajaPOS();
 if (!hayTurno) return;

 localStorage.setItem(CAJA_RECORDATORIO_CIERRE_KEY, fechaHoyPOS());

 mostrarToastPOS("Ya paso tu hora de cierre habitual y la caja sigue abierta.", {
  titulo: "No olvides cerrar la caja",
  tipo: "alerta",
  autoDismiss: false,
  accion: {
   texto: "Cerrar caja ahora",
   onClick: async () => {
    if (typeof mostrarCajaPOS === "function") await mostrarCajaPOS();
    if (typeof abrirModalCerrarTurnoCaja === "function") abrirModalCerrarTurnoCaja();
   }
  }
 });
}

function iniciarRecordatorioCierreCajaPOS() {
 if (cajaRecordatorioCierreIniciado) return;
 cajaRecordatorioCierreIniciado = true;

 revisarCierreCajaPOS();
 setInterval(revisarCierreCajaPOS, CAJA_RECORDATORIO_INTERVALO_MS);
}
