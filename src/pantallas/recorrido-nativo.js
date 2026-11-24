import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { mapaElementos, obtenerArchivo } from '../db.js';
import { listarAnclas, obtenerGuia } from '../maquinas.js';
import { esAdmin } from '../permisos.js';
import { crearModoGuia } from '../ar/modo-guia.js';
import { crearModoAncla } from '../ar/modo-navegacion.js';
import { datosDelVisor, enviarARKit, referenciasDelAncla } from '../ar/visor-nativo.js';
import { modelosColocados } from '../modelos-guia.js';

const DIRECCIONES_DESTINO = {
  izquierda: ['←', 'Mira a la izquierda'], derecha: ['→', 'Mira a la derecha'],
  arriba: ['↑', 'Levanta la cámara'], abajo: ['↓', 'Baja la cámara'],
  giro: ['↶', 'Gira el móvil hacia atrás'], alejar: ['↔', 'Aleja un poco el móvil'],
};

/** La interfaz y los pasos viven en InfoLens. ARKit mantiene la misma sesión entre elementos. */
export function pantallaRecorridoNativo(app, { guiaId, maquinaId, pasoInicial, verLocId, volver, abrirDetalle, abrirImagen, posicionar }) {
  let activo = true;
  let modulo;
  let sesion;
  let destinoId = 0;
  let destinoPendiente = null;
  let mirada = {};
  let ultimoErrorLinterna;
  let avisoLinternaId;
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
      <div class="indicacion-destino" hidden><span aria-hidden="true"></span><div><strong></strong><small></small></div></div>
      <div class="ficha-flotante" aria-hidden="true" hidden><img alt="" hidden><strong></strong></div>
      <div class="nav-panel" hidden></div>
      <div class="pos-panel" hidden></div>
      <div class="controles-arkit">
        <label class="vista-arkit">Recorrido
          <select aria-label="Estilo del recorrido"><option value="flechas">Flechas</option><option value="linea">Línea</option></select>
        </label>
        ${enGuia ? `<button type="button" class="esc-btn linterna-arkit" data-r="linterna" aria-pressed="false" disabled><span aria-hidden="true">🔦</span> Linterna</button>
        <p class="aviso-linterna" role="status" hidden></p>` : ''}
      </div>
    </div>`;
  document.documentElement.classList.add('modo-arkit');
  const $ = (selector) => app.querySelector(selector);
  const escena = $('.recorrido-arkit');
  const estado = $('.esc-estado');
  const rumbo = $('.rumbo-arkit');
  const indicador = $('.indicacion-destino');
  const panelNavegacion = $('.nav-panel');
  const controlVista = $('.vista-arkit');
  const selector = controlVista.querySelector('select');
  const linterna = $('[data-r="linterna"]');
  const avisoLinterna = $('.aviso-linterna');
  const ficha = crearFichaFlotante(escena, $('.ficha-flotante'), panelNavegacion);
  selector.value = ajustes.lidarVista === 'linea' ? 'linea' : 'flechas';
  function enviar(accion, datos = {}) {
    if (sesion) enviarARKit({ accion, sesion, ...datos });
  }

  function enviarDestino() {
    if (!destinoPendiente || destinoPendiente.enviado || !mirada.fiable || mirada.anclaId !== destinoPendiente.anclaId) return;
    destinoPendiente.enviado = true;
    enviar(destinoPendiente.accion, destinoPendiente.datos);
  }

  function pintarIndicador() {
    if (!destinoPendiente?.conIcono || !mirada.fiable || mirada.destinoId !== destinoPendiente.datos.destinoId) {
      indicador.hidden = true;
      return;
    }
    let direccion = DIRECCIONES_DESTINO[mirada.direccionDestino];
    if (mirada.destino) {
      const x = mirada.destino.x * escena.clientWidth;
      const y = mirada.destino.y * escena.clientHeight;
      const tapado = !panelNavegacion.hidden && y >= panelNavegacion.offsetTop &&
        x >= panelNavegacion.offsetLeft && x <= panelNavegacion.offsetLeft + panelNavegacion.offsetWidth;
      direccion = tapado ? DIRECCIONES_DESTINO.abajo : null;
    }
    indicador.hidden = !Array.isArray(direccion);
    if (!indicador.hidden) {
      const [flecha, mensaje] = direccion;
      indicador.querySelector('span').textContent = flecha;
      indicador.querySelector('strong').textContent = destinoPendiente.nombre || 'Elemento';
      indicador.querySelector('small').textContent = mensaje;
    }
  }

  $('[data-r="salir"]').addEventListener('click', volver);
  $('[data-r="buscar"]').addEventListener('click', () => enviar('buscar'));
  $('[data-r="posicionar"]')?.addEventListener('click', posicionar);
  linterna?.addEventListener('click', () => {
    if (linterna.disabled) return;
    linterna.disabled = true;
    ultimoErrorLinterna = undefined;
    avisoLinterna.hidden = true;
    enviar('linterna', { encendida: !mirada.linternaEncendida });
  });
  selector.addEventListener('change', () => {
    ajustes = guardarAjustes({ lidarVista: selector.value });
    enviar('vista', { vista: selector.value });
  });

  const capa = {
    mostrar(loc, { conFlechas = true, conIcono = true, nombre, fotos = [] } = {}) {
      const anclaId = loc.anclaId || modulo?.anclaActivaId;
      if (!anclaId) return;
      const id = ++destinoId;
      ficha.limpiar();
      if (conIcono && nombre) ficha.mostrar(id, nombre, fotos);
      const datos = {
        destinoId: id,
        recorrido: datosDelVisor({
          puntos: [[0, 0, 0], ...(loc.ruta || []), loc.pos],
          anclaId, ladoCm, vista: selector.value,
          flechas: conFlechas, icono: conIcono, posIcono: loc.posIcono,
        }),
      };
      controlVista.hidden = false;
      destinoPendiente = { accion: 'recorrido', anclaId, datos, enviado: false, conIcono, nombre };
      pintarIndicador();
      enviarDestino();
    },
    mostrarElementos(marcas, anclaId) {
      const puntos = marcas.map(({ id, pos }) => ({ id, pos }));
      const datos = { destinoId: ++destinoId, elementos: { anclaId, puntos } };
      destinoPendiente = { accion: 'elementos', datos, anclaId, enviado: false };
      controlVista.hidden = true;
      rumbo.hidden = true;
      ficha.limpiar();
      pintarIndicador();
      enviarDestino();
    },
    ocultar() { destinoPendiente = null; controlVista.hidden = false; ficha.limpiar(); pintarIndicador(); enviar('ocultar'); },
    actualizar() {
      const coincide = destinoPendiente && mirada.destinoId === destinoPendiente.datos.destinoId;
      if (coincide && mirada.errorDestino) return { error: mirada.errorDestino };
      if (!mirada.fiable) return { fiable: false, esperandoAncla: !mirada.anclaId };
      if (!destinoPendiente) return null;
      if (destinoPendiente.accion === 'elementos') return coincide && mirada.elementos
        ? { fiable: true, elementos: mirada.elementos } : { pendiente: true };
      if (!coincide || !mirada.tramo) return { pendiente: true };
      return { ...mirada.tramo, fiable: true, destinoVisible: !!mirada.destino,
        fueraDeCamara: destinoPendiente.conIcono && !mirada.destino };
    },
    actualizarEjes() {},
    reiniciarReferencia() {},
  };

  function recibir(evento) {
    const { sesion: id, estado: datos } = evento.detail || {};
    if (!activo || id !== sesion || !datos) return;
    mirada = datos;
    if (linterna) {
      linterna.disabled = datos.linternaDisponible !== true;
      linterna.setAttribute('aria-pressed', String(datos.linternaEncendida === true));
      linterna.classList.toggle('activo', datos.linternaEncendida === true);
      if (datos.errorLinterna !== ultimoErrorLinterna) {
        ultimoErrorLinterna = datos.errorLinterna;
        clearTimeout(avisoLinternaId);
        avisoLinterna.textContent = ultimoErrorLinterna || '';
        avisoLinterna.hidden = !ultimoErrorLinterna;
        if (ultimoErrorLinterna) avisoLinternaId = setTimeout(() => { avisoLinterna.hidden = true; }, 4000);
      }
    }
    if (destinoPendiente && (!datos.fiable || datos.anclaId !== destinoPendiente.anclaId) && datos.destinoId !== destinoPendiente.datos.destinoId) {
      destinoPendiente.enviado = false;
    }
    enviarDestino();
    estado.textContent = datos.mensaje;
    ficha.proyectar(datos.destinoId, datos.fiable ? datos.destino : null);
    pintarIndicador();
    if (datos.anclaId) seguidos.set(datos.anclaId, { id: datos.anclaId, tipo: 'ancla-activa', visible: datos.fiable });
    else seguidos.clear();
    rumbo.hidden = destinoPendiente?.accion === 'elementos' || !datos.fiable || !Number.isFinite(datos.rumbo);
    if (!rumbo.hidden) rumbo.style.rotate = `${datos.rumbo - 90}deg`;
    modulo?.actualizar(0, null, performance.now());
  }
  window.addEventListener('infolens:arkit', recibir);
  const errorModelos = ({ detail }) => {
    if (!activo || detail?.sesion !== sesion || !avisoLinterna) return;
    clearTimeout(avisoLinternaId);
    avisoLinterna.textContent = detail.mensaje;
    avisoLinterna.hidden = false;
    avisoLinternaId = setTimeout(() => { avisoLinterna.hidden = true; }, 5000);
  };
  window.addEventListener('infolens:modelos-error', errorModelos);
  const observarPanel = new ResizeObserver(() => {
    ficha.proyectar(mirada.destinoId, mirada.fiable ? mirada.destino : null);
    pintarIndicador();
  });
  observarPanel.observe(panelNavegacion);

  Promise.all([listarAnclas(maquinaId), enGuia ? obtenerGuia(guiaId) : null, enGuia ? mapaElementos() : null])
    .then(([anclas, guia, elementos]) => {
      if (!activo) return;
      if (enGuia && (!guia || guia.maquinaId !== maquinaId ||
          (guia.estado !== 'publicada' && !esAdmin()) || !guia.pasos?.length)) {
        estado.textContent = 'La guía no está disponible para esta máquina.';
        return;
      }
      const referencias = (enGuia ? anclas.filter((a) => a.id === guia.anclaId) : anclas)
        .flatMap((a) => referenciasDelAncla(a, ladoCm));
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
        if (destinoPendiente) destinoPendiente.enviado = false;
        sesion = crypto.randomUUID();
        enviar('iniciar', { anclas: referencias, vista: selector.value });
        if (enGuia) {
          const modelos = modelosColocados(guia);
          if (modelos.length) enviar('modelosGuia', { modelos });
        }
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
    observarPanel.disconnect();
    clearTimeout(avisoLinternaId);
    window.removeEventListener('infolens:arkit', recibir);
    window.removeEventListener('infolens:modelos-error', errorModelos);
    modulo?.detener();
    ficha.limpiar();
    enviar('cerrar');
    document.documentElement.classList.remove('modo-arkit');
  };
}

function crearFichaFlotante(raiz, tarjeta, controles) {
  const foto = tarjeta.querySelector('img');
  const rotulo = tarjeta.querySelector('strong');
  let idActual = null;
  let urlFoto = null;
  let punto = null;

  function limpiar() {
    idActual = null;
    punto = null;
    tarjeta.hidden = true;
    foto.hidden = true;
    foto.removeAttribute('src');
    if (urlFoto) URL.revokeObjectURL(urlFoto);
    urlFoto = null;
  }

  function posicionar() {
    if (!punto) { tarjeta.hidden = true; return; }
    tarjeta.hidden = false;
    const W = raiz.clientWidth, H = raiz.clientHeight;
    const x = punto.x * W, y = punto.y * H;
    const ancho = tarjeta.offsetWidth, alto = tarjeta.offsetHeight;
    const barra = raiz.querySelector('.controles-arkit');
    const limiteArriba = barra.offsetTop + barra.offsetHeight + 4;
    const limiteAbajo = (controles.hidden ? H : controles.offsetTop) - alto - 10;
    if (limiteAbajo < limiteArriba) { tarjeta.hidden = true; return; }
    const aDerecha = x + 18 + ancho <= W - 10 || (x - 18 - ancho < 10 && x < W / 2);
    const lateral = aDerecha ? x + 18 : x - 18 - ancho;
    const tx = Math.max(10, Math.min(W - ancho - 10, lateral));
    const ty = Math.max(limiteArriba, Math.min(limiteAbajo, y - alto / 2));
    tarjeta.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
  }

  async function cargarFoto(id, fotos) {
    for (const fid of new Set(fotos)) {
      const archivo = await obtenerArchivo(fid);
      if (id !== idActual) return;
      if (!archivo) continue;
      const url = URL.createObjectURL(archivo.blob);
      try {
        const miniatura = new Image();
        miniatura.src = url;
        await miniatura.decode();
        if (id !== idActual) { URL.revokeObjectURL(url); return; }
        urlFoto = url;
        foto.src = url;
        foto.hidden = false;
        posicionar();
        return;
      } catch {
        URL.revokeObjectURL(url);
      }
    }
  }

  return {
    limpiar,
    mostrar(id, nombre, fotos) {
      idActual = id;
      rotulo.textContent = nombre;
      cargarFoto(id, fotos).catch(() => {});
    },
    proyectar(id, destino) {
      punto = idActual !== null && id === idActual && Number.isFinite(destino?.x) && Number.isFinite(destino?.y) ? destino : null;
      posicionar();
    },
  };
}
