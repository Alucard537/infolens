// Punto de entrada: decide qué pantalla mostrar según la dirección (#/...).
import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { APP_NAME } from './config.js';
import { cargarAjustes } from './ajustes.js';
import { contarElementos } from './db.js';
import { crearEjemploSiHaceFalta } from './datos-prueba.js';
import { pantallaDetalle } from './pantallas/detalle.js';
import { pantallaLista } from './pantallas/lista.js';
import { pantallaFormulario } from './pantallas/formulario.js';
import { pantallaCopia } from './pantallas/copia.js';
import { pantallaImportar } from './pantallas/importar.js';
import { pantallaQR, pantallaHojaQR } from './pantallas/qr.js';
import { pantallaHuella } from './pantallas/huella.js';
import { pedirPermisoSensor } from './ar/permiso-sensor.js';
import { esAdmin } from './permisos.js';
import { pantallaAdmin } from './pantallas/admin.js';
import { tieneARKitIntegrado } from './ar/visor-nativo.js';
import { maquinaActiva, maquinaActivaId, establecerMaquinaActiva, migrarDatosAntiguos, elementosDeMaquina } from './maquinas.js';
import { pantallaMaquinas, pantallaMaquinaForm, pantallaMaquina, pantallaAnclas } from './pantallas/maquinas.js';
import { pantallaLocalizacion } from './pantallas/localizacion.js';
import { pantallaGuias, pantallaGuiaPortada } from './pantallas/guias.js';
import { pantallaGuiaEditor } from './pantallas/guia-editor.js';
import { pantallaGuiaLidar } from './pantallas/guia-lidar.js';
import { pantallaArRecorrido } from './pantallas/ar-recorrido.js';
import { pantallaDiagnosticoAR } from './pantallas/diagnostico-ar.js';

document.title = APP_NAME;

// Guardar la app en el móvil para que funcione sin internet (en desarrollo no hace nada)
if (!tieneARKitIntegrado()) {
  try { registerSW({ immediate: true }); } catch (e) { console.warn('Service worker:', e); }
}

// Pedir al navegador que no borre los datos de la app por falta de espacio
try {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((ya) => { if (!ya) navigator.storage.persist(); }).catch(() => {});
  }
} catch {}

const app = document.querySelector('#app');
let limpiar = null; // función para cerrar la pantalla anterior (p. ej. apagar la cámara)
let turno = 0;      // evita que una pantalla lenta en cargar pise a la siguiente

const ir = (ruta) => { location.hash = ruta; };
const sustituir = (ruta) => { location.replace(ruta); }; // sin dejar la pantalla actual en el "atrás"
const volver = () => (history.length > 1 ? history.back() : ir('#/'));
const enc = encodeURIComponent;
const editarGuia = (id, maquina) => ir('#/guia-editar/' + enc(id) + (maquina ? '?maquina=' + enc(maquina) : ''));
const abrirImagen = async (u, t) => (await import('./ui/visor.js')).abrirImagen(u, t);

// El escáner (con three.js) se carga solo cuando se usa, para que la app arranque más rápido
const cargarEscaner = () => import('./pantallas/escaner.js');

// Pantallas con cámara: botón ESCÁNER / ANCLA / guía en marcha. El permiso del sensor de movimiento
// del iPhone tiene que pedirse en el mismo toque.
const CON_CAMARA = ['escaner', 'ancla', 'guia-ejecutar', 'huella'];
const usaARKit = (pantalla, posicionar) => tieneARKitIntegrado() &&
  (pantalla === 'guia-ejecutar' || (pantalla === 'ancla' && !posicionar));
const irConCamara = (ruta) => {
  if (!usaARKit(ruta.split(/[/?]/)[1], ruta.includes('posicionar=1'))) pedirPermisoSensor();
  ir(ruta);
};

async function pantallaInicio() {
  const admin = esAdmin();
  const maquina = await maquinaActiva();
  const modulos = [
    ['maquinas', 'Máquinas', 'maquina'], ['guias', 'Guías', 'guia'],
    ['escaner', 'Escáner', 'escaner'], ['elementos', 'Elementos', 'elementos'],
  ];
  const gestiones = [
    ['maquinas', 'Gestión de máquinas', 'maquina'], ['anclas', 'Gestión de anclas', 'ancla'],
    ['guias', 'Gestión de guías', 'guia'], ['nuevo', 'Añadir elemento', 'nuevo'],
    ['copia', 'Copia de seguridad', 'copia'], ['importar', 'Importar desde Excel (PC)', 'importar'],
    ['diagnostico-ar', 'Diagnóstico del AR con LiDAR', 'diagnostico'],
  ];
  const icono = (tipo) => `<span class="icono-inicio icono-${tipo}" aria-hidden="true"></span>`;
  const flecha = icono('ir');
  app.innerHTML = `
    <div class="pagina inicio ${admin ? 'inicio-admin' : ''}">
      <header class="inicio-cabecera">
        <div class="inicio-marca">
          <span class="inicio-logo">${icono('escaner')}</span>
          <h1 class="titulo-app"></h1>
        </div>
        <button class="usuario ${admin ? 'es-admin' : ''}" data-ir="#/admin">
          ${icono('perfil')}${admin ? 'Administrador' : 'Usuario normal'}
        </button>
      </header>
      <div class="inicio-modulos">
        <section class="maquina-activa ${maquina ? '' : 'sin-maquina'}" aria-labelledby="rotulo-maquina-activa">
          <span class="maquina-estado" id="rotulo-maquina-activa">Máquina activa</span>
          <div class="nombre-maquina">
            <strong class="maquina-nombre"></strong>
            <span class="maquina-codigo" ${maquina ? '' : 'hidden'}></span>
          </div>
        </section>
        <nav class="botones-principales" aria-label="Módulos de InfoLens">
          ${modulos.map(([ruta, titulo, simbolo]) => `
            <button class="boton inicio-acceso ${ruta === 'escaner' ? 'acceso-escaner' : ''}" data-ir="#/${ruta}" ${ruta === 'escaner' ? 'data-camara' : ''}>
              <span class="acceso-dibujo">${icono(simbolo)}</span>
              <span class="acceso-titulo">${titulo}${ruta === 'elementos' ? '<span class="cuenta"></span>' : ''}</span>
              ${flecha}
            </button>`).join('')}
        </nav>
      </div>
      ${admin ? `
      <section class="inicio-administracion" aria-labelledby="titulo-administracion">
        <h2 id="titulo-administracion">Administración</h2>
        <div class="inicio-gestiones">
          ${gestiones.map(([ruta, titulo, simbolo]) => `
            <button class="boton inicio-gestion" data-ir="#/${ruta}">
              <span class="gestion-dibujo">${icono(simbolo)}</span>
              <span class="gestion-titulo">${titulo}</span>
              ${flecha}
            </button>`).join('')}
        </div>
        <p class="nota inicio-version">Versión ${__VERSION__}</p>
      </section>` : ''}
    </div>`;
  app.querySelector('.titulo-app').textContent = APP_NAME;
  app.querySelector('.maquina-nombre').textContent = maquina ? maquina.nombre : 'Elige una en Máquinas';
  if (maquina) app.querySelector('.maquina-codigo').textContent = maquina.id;
  app.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => {
    if (b.hasAttribute('data-camara')) irConCamara(b.dataset.ir); else ir(b.dataset.ir);
  }));
  if (maquina) elementosDeMaquina(maquina.id).then((l) => { const c = app.querySelector('.cuenta'); if (c) c.textContent = l.length; });
  else contarElementos().then(() => {});
  cargarEscaner(); // ir cargando el escáner en segundo plano
}

async function mostrar() {
  const miTurno = ++turno;
  if (limpiar) { try { limpiar(); } catch {} limpiar = null; }
  document.querySelectorAll('.visor').forEach((v) => v.remove());
  const completa = location.hash.replace(/^#/, '') || '/';
  const [ruta, consulta = ''] = completa.split('?');
  const params = new URLSearchParams(consulta);
  const [pantalla, param] = ruta.split('/').filter(Boolean);
  const id = param ? decodeURIComponent(param) : '';
  document.body.classList.toggle('modo-escaner', CON_CAMARA.includes(pantalla));
  window.scrollTo(0, 0);

  // Pantallas solo para el administrador: si no lo es, se le pide la contraseña
  const SOLO_ADMIN = ['nuevo', 'editar', 'importar', 'hoja', 'qr', 'huella', 'maquina', 'maquina-nueva', 'maquina-editar',
    'localizacion', 'guia-editar', 'guia-nueva', 'ancla', 'anclas', 'diagnostico-ar'];
  if (SOLO_ADMIN.includes(pantalla) && !esAdmin()) {
    location.replace('#/admin?ir=' + encodeURIComponent(location.hash));
    return;
  }
  // Pantallas que necesitan una máquina activa (si no la hay, se pide elegirla antes)
  const CON_MAQUINA = ['escaner', 'ancla', 'guias', 'guia', 'guia-ejecutar', 'guia-lidar', 'elementos', 'anclas'];
  const administraGuias = pantalla === 'guias' && esAdmin() && params.has('maquina');
  if (CON_MAQUINA.includes(pantalla) && !administraGuias && !(await maquinaActiva())) {
    if (miTurno !== turno) return;
    location.replace('#/maquinas?falta=1&ir=' + encodeURIComponent(location.hash));
    return;
  }
  if (miTurno !== turno) return;

  if (pantalla === 'diagnostico-ar') {
    limpiar = pantallaDiagnosticoAR(app, { volver: () => ir('#/') });
  } else if (pantalla === 'ar') {
    limpiar = pantallaArRecorrido(app, params.get('d'), { volver: () => ir('#/') });
  } else if (pantalla === 'admin') {
    pantallaAdmin(app, {
      volver: () => ir('#/'),
      recibirActualizacion: () => ir('#/copia'),
      destino: params.get('ir'),
      alEntrar: (d) => sustituir(d || '#/'),
      alSalir: () => sustituir('#/'),
    });
  } else if (usaARKit(pantalla, params.get('posicionar') === '1')) {
    const { pantallaRecorridoNativo } = await import('./pantallas/recorrido-nativo.js');
    if (miTurno !== turno) return;
    limpiar = pantallaRecorridoNativo(app, {
      guiaId: pantalla === 'guia-ejecutar' ? id : null,
      maquinaId: maquinaActivaId(),
      pasoInicial: parseInt(params.get('paso') || '0', 10) || 0,
      verLocId: params.get('ver'),
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      abrirImagen,
      volver: () => ir(pantalla === 'guia-ejecutar' ? '#/guia/' + enc(id) : '#/'),
      posicionar: () => irConCamara('#/ancla?posicionar=1'),
    });
  } else if (pantalla === 'escaner' || pantalla === 'ancla' || pantalla === 'guia-ejecutar') {
    const { pantallaEscaner } = await cargarEscaner();
    if (miTurno !== turno) return;
    limpiar = pantallaEscaner(app, {
      modo: pantalla === 'escaner' ? 'escaner' : pantalla === 'ancla' ? 'ancla' : 'guia',
      guiaId: pantalla === 'guia-ejecutar' ? id : null,
      pasoInicial: parseInt(params.get('paso') || '0', 10) || 0,
      posicionarEnInicio: params.get('posicionar') === '1',
      verLocId: params.get('ver'),
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      darDeAlta: (i) => ir('#/nuevo/' + enc(i) + '?maquina=' + enc(maquinaActivaId() || '')),
      abrirImagen,
      volver: () => (pantalla === 'guia-ejecutar' ? ir('#/guia/' + enc(id)) : ir('#/')),
    });
  } else if (pantalla === 'maquinas') {
    const destino = params.get('ir');
    limpiar = pantallaMaquinas(app, {
      volver: () => ir('#/'),
      aviso: params.get('falta') ? 'Primero elige con qué máquina vas a trabajar.' : '',
      gestionar: (m) => ir('#/maquina/' + enc(m)),
      nueva: () => ir('#/maquina-nueva'),
      // Al cambiar de máquina se cierra todo lo de la anterior (las pantallas AR se crean de nuevo)
      alElegir: () => sustituir(destino || '#/'),
    });
  } else if (pantalla === 'maquina-nueva' || (pantalla === 'maquina-editar' && id)) {
    limpiar = pantallaMaquinaForm(app, pantalla === 'maquina-editar' ? id : null, {
      volver,
      alGuardar: (m) => { if (!maquinaActivaId()) establecerMaquinaActiva(m); sustituir('#/maquina/' + enc(m)); },
      alBorrar: () => sustituir('#/maquinas'),
    });
  } else if (pantalla === 'maquina' && id) {
    limpiar = pantallaMaquina(app, id, {
      volver: () => ir('#/maquinas'),
      editarMaquina: (m) => ir('#/maquina-editar/' + enc(m)),
      editarElemento: (e) => ir('#/editar/' + enc(e)),
      nuevoElemento: (m) => ir('#/nuevo?maquina=' + enc(m)),
      localizaciones: (e) => ir('#/localizacion/' + enc(e)),
      guias: (m) => ir('#/guias?maquina=' + enc(m)),
      editarGuia,
    });
  } else if (pantalla === 'anclas') {
    limpiar = pantallaAnclas(app, maquinaActivaId(), { volver, cambiarMaquina: () => ir('#/maquinas?ir=' + enc('#/anclas')) });
  } else if (pantalla === 'localizacion' && id) {
    limpiar = pantallaLocalizacion(app, id, {
      volver,
      // Previsualizar: abre ANCLA con ese recorrido (en la máquina del elemento)
      previsualizar: (loc) => { establecerMaquinaActiva(loc.maquinaId); irConCamara('#/ancla?ver=' + enc(loc.id)); },
      posicionarConCamara: () => irConCamara('#/ancla?posicionar=1'),
    });
  } else if (pantalla === 'guias') {
    // El administrador puede gestionar las guías de cualquier máquina; el usuario, solo las de la activa
    const maq = (esAdmin() && params.get('maquina')) || maquinaActivaId();
    limpiar = pantallaGuias(app, maq, {
      // Volver a un sitio fijo (no "atrás"): si se vino desde la gestión de una máquina, a ella; si no, al inicio
      volver: () => ir(params.get('maquina') ? '#/maquina/' + enc(params.get('maquina')) : '#/'),
      abrir: (g) => ir('#/guia/' + enc(g)),
      editar: editarGuia,
      nueva: (m) => ir('#/guia-nueva?maquina=' + enc(m)),
    });
  } else if (pantalla === 'guia' && id) {
    limpiar = pantallaGuiaPortada(app, id, {
      volver: () => ir('#/guias'),
      empezar: (g) => irConCamara('#/guia-ejecutar/' + enc(g)),
      verPasos: (g) => ir('#/guia-lidar/' + enc(g)),
      editar: editarGuia,
    });
  } else if (pantalla === 'guia-lidar' && id) {
    limpiar = pantallaGuiaLidar(app, id, {
      pasoInicial: parseInt(params.get('paso') || '0', 10) || 0,
      volver: () => ir('#/guias'),
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      abrirImagen,
      editar: editarGuia,
      conCamara: (g, paso) => irConCamara('#/guia-ejecutar/' + enc(g) + '?paso=' + paso),
    });
  } else if (pantalla === 'guia-nueva' || (pantalla === 'guia-editar' && id)) {
    const maquina = params.get('maquina');
    const consultaMaquina = maquina ? '?maquina=' + enc(maquina) : '';
    limpiar = pantallaGuiaEditor(app, {
      id: pantalla === 'guia-editar' ? id : null,
      maquinaId: maquina || maquinaActivaId(),
      volver: () => ir('#/guias' + consultaMaquina),
      // Actualizar la dirección sin recargar el editor
      alGuardar: (g) => history.replaceState(null, '', '#/guia-editar/' + enc(g) + consultaMaquina),
      probar: (g) => {
        // La guía se prueba en su máquina
        import('./maquinas.js').then(async ({ obtenerGuia }) => {
          const guia = await obtenerGuia(g);
          if (guia) establecerMaquinaActiva(guia.maquinaId);
          ir('#/guia/' + enc(g));
        });
      },
    });
  } else if (pantalla === 'detalle' && id) {
    limpiar = pantallaDetalle(app, id, {
      volver,
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      editar: (i) => ir('#/editar/' + enc(i)),
      imprimirQR: (i) => ir('#/qr/' + enc(i)),
      huella: (i) => ir('#/huella/' + enc(i)),
      localizaciones: (i) => ir('#/localizacion/' + enc(i)),
      darDeAlta: (i) => ir('#/nuevo/' + enc(i) + '?maquina=' + enc(maquinaActivaId() || '')),
    });
  } else if (pantalla === 'elementos') {
    limpiar = pantallaLista(app, {
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      nuevo: () => ir('#/nuevo?maquina=' + enc(maquinaActivaId() || '')),
      hojaQR: () => ir('#/hoja'),
      volver: () => ir('#/'),
    });
  } else if (pantalla === 'huella' && id) {
    limpiar = pantallaHuella(app, id, { volver });
  } else if (pantalla === 'qr' && id) {
    limpiar = pantallaQR(app, id, { volver });
  } else if (pantalla === 'hoja') {
    limpiar = pantallaHojaQR(app, { volver });
  } else if (pantalla === 'copia') {
    limpiar = pantallaCopia(app, { volver: () => ir('#/'), irImportarExcel: () => ir('#/importar') });
  } else if (pantalla === 'importar') {
    limpiar = pantallaImportar(app, { volver, irCopia: () => ir('#/copia') });
  } else if (pantalla === 'nuevo' || (pantalla === 'editar' && id)) {
    limpiar = pantallaFormulario(app, {
      id: pantalla === 'editar' ? id : null,
      idSugerido: pantalla === 'nuevo' ? id : null,
      maquinaSugerida: params.get('maquina') || maquinaActivaId(),
      alGuardar: (i) => sustituir('#/detalle/' + enc(i)),
      alBorrar: () => sustituir('#/elementos'),
      volver,
    });
  } else {
    await pantallaInicio();
  }
}

// Arranque: cargar ajustes, el ejemplo y pasar los datos antiguos al sistema de máquinas
(async () => {
  await cargarAjustes();
  await crearEjemploSiHaceFalta();
  try { await migrarDatosAntiguos(); } catch (e) { console.warn('Migración:', e); }
  window.addEventListener('hashchange', mostrar);
  mostrar();
})();
