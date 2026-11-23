import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { mapaElementos } from '../db.js';
import { listarAnclas, obtenerGuia } from '../maquinas.js';
import { esAdmin } from '../permisos.js';
import { crearModoGuia } from '../ar/modo-guia.js';
import { crearModoAncla } from '../ar/modo-navegacion.js';
import { datosDelVisor, enviarARKit, modulosQR } from '../ar/visor-nativo.js';

/** La interfaz y los pasos viven en InfoLens. ARKit mantiene la misma sesión entre elementos. */
export function pantallaRecorridoNativo(app, { guiaId, maquinaId, pasoInicial, verLocId, volver, abrirDetalle, abrirImagen, posicionar }) {
  let activo = true;
  let modulo;
  let sesion;
  let mirada = {};
  const seguidos = new Map();
  const enGuia = !!guiaId;
  let ajustes = leerAjustes();
  const ladoCm = ajustes.qrCm || 10;

  app.innerHTML = `
    <div class="escaner recorrido-arkit">
      <div class="esc-barra">
        <button class="esc-btn" data-r="salir" aria-label="Volver">‹</button>
        <div class="esc-estado" role="status">Iniciando cámara…</div>
        <button class="esc-btn" data-r="buscar" aria-label="Volver a detectar QR">⌖</button>
        ${!enGuia && esAdmin() ? '<button class="esc-btn" data-r="posicionar" aria-label="Medir posición de componentes">📍</button>' : ''}
      </div>
      <span class="rumbo-arkit" aria-hidden="true" hidden>➤</span>
      <div class="nav-panel" hidden></div>
      <div class="pos-panel" hidden></div>
      <label class="vista-arkit">Recorrido
        <select aria-label="Estilo del recorrido"><option value="flechas">Flechas</option><option value="linea">Línea</option></select>
      </label>
    </div>`;
  document.documentElement.classList.add('modo-arkit');
  const $ = (selector) => app.querySelector(selector);
  const estado = $('.esc-estado');
  const rumbo = $('.rumbo-arkit');
  const selector = $('.vista-arkit select');
  selector.value = ajustes.lidarVista === 'linea' ? 'linea' : 'flechas';
  function enviar(accion, datos = {}) {
    if (sesion) enviarARKit({ accion, sesion, ...datos });
  }

  $('[data-r="salir"]').addEventListener('click', volver);
  $('[data-r="buscar"]').addEventListener('click', () => enviar('buscar'));
  $('[data-r="posicionar"]')?.addEventListener('click', posicionar);
  selector.addEventListener('change', () => {
    ajustes = guardarAjustes({ lidarVista: selector.value });
    enviar('vista', { vista: selector.value });
  });

  const capa = {
    mostrar(loc, { conFlechas = true, conIcono = true } = {}) {
      if (!mirada.anclaId) return;
      enviar('recorrido', {
        recorrido: datosDelVisor({
          puntos: [[0, 0, 0], ...(loc.ruta || []), loc.pos],
          anclaId: mirada.anclaId, ladoCm, vista: selector.value,
          flechas: conFlechas, icono: conIcono, posIcono: loc.posIcono,
        }),
      });
    },
    ocultar() { enviar('ocultar'); },
    actualizar() {
      if (!mirada.fiable) return { fiable: false, esperandoAncla: !mirada.anclaId };
      return mirada.tramo ? { ...mirada.tramo, fiable: true } : null;
    },
    actualizarEjes() {},
    reiniciarReferencia() {},
  };

  function recibir(evento) {
    const { sesion: id, estado: datos } = evento.detail || {};
    if (!activo || id !== sesion || !datos) return;
    mirada = datos;
    estado.textContent = datos.mensaje;
    if (datos.anclaId) seguidos.set(datos.anclaId, { id: datos.anclaId, tipo: 'ancla-activa', visible: datos.fiable });
    rumbo.hidden = !datos.fiable || !Number.isFinite(datos.rumbo);
    if (!rumbo.hidden) rumbo.style.rotate = `${datos.rumbo - 90}deg`;
    modulo?.actualizar(0, null, performance.now());
  }
  window.addEventListener('infolens:arkit', recibir);

  Promise.all([listarAnclas(maquinaId), enGuia ? obtenerGuia(guiaId) : null, enGuia ? mapaElementos() : null])
    .then(([anclas, guia, elementos]) => {
      if (!activo) return;
      if (enGuia && (!guia || guia.maquinaId !== maquinaId ||
          (guia.estado !== 'publicada' && !esAdmin()) || !guia.pasos?.length)) {
        estado.textContent = 'La guía no está disponible para esta máquina.';
        return;
      }
      const referencias = (enGuia ? anclas.filter((a) => a.id === guia.anclaId) : anclas)
        .map((a) => ({ id: a.id, ladoCm, patron: modulosQR('INFOLENS:' + a.id) }));
      if (!referencias.length || referencias.length > 100) {
        estado.textContent = !referencias.length
          ? 'Esta máquina no tiene el QR de anclaje necesario.'
          : 'Selecciona una guía para usar el QR de su ancla.';
        return;
      }
      function iniciarCamara() {
        enviar('cerrar');
        seguidos.clear();
        mirada = {};
        sesion = crypto.randomUUID();
        enviar('iniciar', { anclas: referencias, vista: selector.value });
      }

      const comun = { capa, panel: $('.nav-panel'), seguidos, abrirDetalle, maquinaId };
      if (enGuia) {
        const ancla = anclas.find((a) => a.id === guia.anclaId);
        modulo = crearModoGuia({
          ...comun, guia: { ...guia, anclaNombre: ancla.nombre,
            elementos: new Map([...elementos].filter(([, el]) => el.maquinaId === maquinaId)) },
          pasoInicial, abrirImagen, alSalir: volver,
        });
      } else {
        modulo = crearModoAncla({
          ...comun, panelPos: $('.pos-panel'), esAdmin, verLocId,
          avisar: (mensaje) => { estado.textContent = mensaje; }, alCambiarAncla: iniciarCamara,
        });
      }
      iniciarCamara();
    }).catch((error) => {
      if (activo) estado.textContent = 'No se pudo preparar el recorrido.';
      console.warn('Recorrido ARKit:', error);
    });

  return () => {
    activo = false;
    window.removeEventListener('infolens:arkit', recibir);
    modulo?.detener();
    enviar('cerrar');
    document.documentElement.classList.remove('modo-arkit');
  };
}
