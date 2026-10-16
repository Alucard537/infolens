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
import { hayQuickLook, crearEnlaceAR } from './ar/boton-ar.js';
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
try { registerSW({ immediate: true }); } catch (e) { console.warn('Service worker:', e); }

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
const abrirImagen = async (u, t) => (await import('./ui/visor.js')).abrirImagen(u, t);

// El escáner (con three.js) se carga solo cuando se usa, para que la app arranque más rápido
const cargarEscaner = () => import('./pantallas/escaner.js');

// Pantallas con cámara: botón ESCÁNER / ANCLA / guía en marcha. El permiso del sensor de movimiento
// del iPhone tiene que pedirse en el mismo toque.
const CON_CAMARA = ['escaner', 'ancla', 'guia-ejecutar', 'huella'];
const irConCamara = (ruta) => { pedirPermisoSensor(); ir(ruta); };

async function pantallaInicio() {
  const admin = esAdmin();
  const maquina = await maquinaActiva();
  app.innerHTML = `
    <div class="pagina">
      <h1 class="titulo-app"></h1>
      <button class="usuario ${admin ? 'es-admin' : ''}" data-ir="#/admin">${admin ? '🔑 Administrador' : '👤 Usuario normal'}</button>
      <button class="maquina-activa ${maquina ? '' : 'sin-maquina'}" data-ir="#/maquinas">
        MÁQUINA ACTIVA: <b class="nombre-maquina"></b>
      </button>
      <div class="botones-principales">
        <button class="boton grande" data-ir="#/escaner" data-camara>📷 ESCÁNER</button>
        <button class="boton grande secundario" data-ir="#/maquinas">🏭 MÁQUINAS</button>
        <button class="boton grande" data-ir="#/ancla" data-camara>⚓ ANCLA</button>
        <button class="boton grande secundario" data-ir="#/guias">📘 GUÍAS</button>
      </div>
      <button class="boton secundario" data-ir="#/elementos">📋 Elementos de la máquina <span class="cuenta"></span></button>
      ${admin ? `
      <h2>🔑 Administración</h2>
      <button class="boton secundario" data-ir="#/maquinas">🏭 Gestión de máquinas</button>
      <button class="boton secundario" data-ir="#/anclas">⚓ Gestión de anclas</button>
      <button class="boton secundario" data-ir="#/guias">📘 Gestión de guías</button>
      <button class="boton secundario" data-ir="#/nuevo">➕ Añadir elemento</button>
      <button class="boton secundario" data-ir="#/copia">💾 Copia de seguridad</button>
      <button class="boton secundario" data-ir="#/importar">📊 Importar desde Excel (PC)</button>` : `
      <button class="boton secundario" data-ir="#/copia">📥 Recibir actualización</button>`}
      <button class="boton secundario" data-ir="#/admin">${admin ? '🚪 Salir del modo administrador' : '🔒 Entrar como administrador'}</button>
      <div class="prueba-ar"></div>
      <p class="nota">Versión ${__VERSION__}</p>
    </div>`;
  app.querySelector('.titulo-app').textContent = APP_NAME;
  app.querySelector('.nombre-maquina').textContent = maquina ? `${maquina.nombre} (${maquina.id})` : 'ninguna — toca para elegir';
  app.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => {
    if (b.hasAttribute('data-camara')) irConCamara(b.dataset.ir); else ir(b.dataset.ir);
  }));
  if (maquina) elementosDeMaquina(maquina.id).then((l) => { const c = app.querySelector('.cuenta'); if (c) c.textContent = `(${l.length})`; });
  else contarElementos().then(() => {});
  // Prueba del AR de Apple con LiDAR (modelo de ejemplo): sirve para saber si funciona en este iPhone
  const prueba = app.querySelector('.prueba-ar');
  if (hayQuickLook()) {
    prueba.appendChild(crearEnlaceAR({ url: import.meta.env.BASE_URL + 'ejemplo/prueba-ar.usdz', texto: '🧪 Probar AR con LiDAR (ejemplo)' }).enlace);
    prueba.appendChild(pruebaFlechas());
  } else {
    const p = document.createElement('p');
    p.className = 'nota';
    p.textContent = /iPhone|iPad/.test(navigator.userAgent) && (navigator.standalone || matchMedia('(display-mode: standalone)').matches)
      ? '🧊 El AR con LiDAR no está disponible desde la app instalada: ábrela en Safari para usarlo.'
      : '🧊 El AR con LiDAR solo está disponible en iPhone o iPad.';
    prueba.appendChild(p);
  }
  const diag = document.createElement('button');
  diag.className = 'boton secundario';
  diag.textContent = '🔬 Diagnóstico del AR con LiDAR';
  diag.addEventListener('click', () => ir('#/diagnostico-ar'));
  prueba.appendChild(diag);
  cargarEscaner(); // ir cargando el escáner en segundo plano
}

// PRUEBA: dos objetos (rojo = salida, azul = llegada) unidos por flechas, en el AR de Apple con LiDAR.
// 1) Archivo fijo (130 adelante + 150 derecha), igual que el ejemplo que funciona.
// 2) El mismo, generado en el móvil con las medidas que se escriban.
function pruebaFlechas() {
  const div = document.createElement('div');
  div.className = 'bloque-lidar-guia';
  div.innerHTML = `
    <p class="nota lidar-recomendado">🧪 Prueba: dos objetos unidos por flechas</p>
    <p class="nota">🟥 Rojo = salida (ponlo donde está el QR del ancla). 🟦 Azul = llegada. En el AR de Apple
      se mueven JUNTOS: coloca el rojo en la salida y gira con dos dedos hasta que las flechas apunten hacia ADELANTE.</p>
    <div class="fijo"></div>
    <div class="titulo-archivo">Con tus medidas (cm)</div>
    <div class="tramos-prueba"></div>
    <div class="botones-archivo"><button class="boton secundario" data-p="generar">⚙️ Generar con estas medidas</button></div>
    <div class="generado"></div>`;
  div.querySelector('.fijo').appendChild(crearEnlaceAR({
    url: import.meta.env.BASE_URL + 'ejemplo/prueba-flechas.usdz', texto: '🧪 Fijo: 130 adelante → 150 derecha',
  }).enlace);
  const filas = document.createElement('ol');
  div.querySelector('.tramos-prueba').appendChild(filas);
  const lista = [{ dir: 'adelante', cm: '130' }, { dir: 'derecha', cm: '150' }];
  const pintar = () => import('./ui/tramos.js').then(({ pintarListaTramos }) => pintarListaTramos(filas, lista));
  pintar();
  const mas = document.createElement('button');
  mas.className = 'boton-mini'; mas.textContent = '➕ Añadir tramo';
  mas.addEventListener('click', () => { lista.push({ dir: 'adelante', cm: '' }); pintar(); });
  div.querySelector('.tramos-prueba').appendChild(mas);
  const salida = div.querySelector('.generado');
  div.querySelector('[data-p="generar"]').addEventListener('click', async () => {
    salida.innerHTML = '<p class="nota">⏳ Generando…</p>';
    try {
      const [{ usdzPruebaFlechas }, { direccionWeb }, { deSimple }] = await Promise.all([
        import('./ar/prueba-flechas.js'), import('./ar/quicklook.js'), import('./coordenadas.js'),
      ]);
      const tramos = lista.filter((t) => String(t.cm ?? '').trim() !== '').map(deSimple);
      if (!tramos.length) throw new Error('Escribe al menos un tramo.');
      if (tramos.some((t) => Object.values(t).some((v) => !Number.isFinite(v)))) throw new Error('Algún valor no es un número.');
      const bytes = await usdzPruebaFlechas(tramos);
      const url = await direccionWeb('prueba-flechas', new Blob([bytes], { type: 'model/vnd.usdz+zip' }));
      salida.innerHTML = '';
      salida.appendChild(crearEnlaceAR({ url, texto: '🧪 Abrir mis medidas en AR con LiDAR' }).enlace);
      const n = document.createElement('p');
      n.className = 'nota';
      n.textContent = '✅ Listo. Toca el botón verde.';
      salida.appendChild(n);
    } catch (e) {
      salida.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error-form';
      p.textContent = '❌ ' + e.message;
      salida.appendChild(p);
    }
  });
  return div;
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
    'localizacion', 'guia-editar', 'guia-nueva', 'anclas'];
  if (SOLO_ADMIN.includes(pantalla) && !esAdmin()) {
    location.replace('#/admin?ir=' + encodeURIComponent(location.hash));
    return;
  }
  // Pantallas que necesitan una máquina activa (si no la hay, se pide elegirla antes)
  const CON_MAQUINA = ['escaner', 'ancla', 'guias', 'guia', 'guia-ejecutar', 'guia-lidar', 'elementos', 'anclas'];
  if (CON_MAQUINA.includes(pantalla) && !(await maquinaActiva())) {
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
      destino: params.get('ir'),
      alEntrar: (d) => sustituir(d || '#/'),
      alSalir: () => sustituir('#/'),
    });
  } else if (pantalla === 'escaner' || pantalla === 'ancla' || pantalla === 'guia-ejecutar') {
    const { pantallaEscaner } = await cargarEscaner();
    if (miTurno !== turno) return;
    limpiar = pantallaEscaner(app, {
      modo: pantalla === 'escaner' ? 'escaner' : pantalla === 'ancla' ? 'ancla' : 'guia',
      guiaId: pantalla === 'guia-ejecutar' ? id : null,
      verLocId: params.get('ver'),
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      darDeAlta: (i) => ir('#/nuevo/' + enc(i) + '?maquina=' + enc(maquinaActivaId() || '')),
      abrirImagen,
      volver: () => (pantalla === 'guia-ejecutar' ? ir('#/guias') : ir('#/')),
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
    });
  } else if (pantalla === 'anclas') {
    limpiar = pantallaAnclas(app, maquinaActivaId(), { volver, cambiarMaquina: () => ir('#/maquinas?ir=' + enc('#/anclas')) });
  } else if (pantalla === 'localizacion' && id) {
    limpiar = pantallaLocalizacion(app, id, {
      volver,
      // Previsualizar: abre ANCLA con ese recorrido (en la máquina del elemento)
      previsualizar: (loc) => { establecerMaquinaActiva(loc.maquinaId); irConCamara('#/ancla?ver=' + enc(loc.id)); },
      posicionarConCamara: () => irConCamara('#/ancla'),
    });
  } else if (pantalla === 'guias') {
    // El administrador puede gestionar las guías de cualquier máquina; el usuario, solo las de la activa
    const maq = (esAdmin() && params.get('maquina')) || maquinaActivaId();
    limpiar = pantallaGuias(app, maq, {
      // Volver a un sitio fijo (no "atrás"): si se vino desde la gestión de una máquina, a ella; si no, al inicio
      volver: () => ir(params.get('maquina') ? '#/maquina/' + enc(params.get('maquina')) : '#/'),
      abrir: (g) => irConCamara('#/guia-ejecutar/' + enc(g)),
      editar: (g) => ir('#/guia-editar/' + enc(g)),
      nueva: (m) => ir('#/guia-nueva?maquina=' + enc(m)),
    });
  } else if (pantalla === 'guia' && id) {
    limpiar = pantallaGuiaPortada(app, id, {
      volver: () => ir('#/guias'),
      empezar: (g) => irConCamara('#/guia-ejecutar/' + enc(g)),
      conLidar: (g) => ir('#/guia-lidar/' + enc(g)),
      editar: (g) => ir('#/guia-editar/' + enc(g)),
    });
  } else if (pantalla === 'guia-lidar' && id) {
    limpiar = pantallaGuiaLidar(app, id, {
      pasoInicial: parseInt(params.get('paso') || '0', 10) || 0,
      volver: () => ir('#/guias'),
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      abrirImagen,
      editar: (g) => ir('#/guia-editar/' + enc(g)),
      conCamara: (g) => irConCamara('#/guia-ejecutar/' + enc(g)),
    });
  } else if (pantalla === 'guia-nueva' || (pantalla === 'guia-editar' && id)) {
    limpiar = pantallaGuiaEditor(app, {
      id: pantalla === 'guia-editar' ? id : null,
      maquinaId: params.get('maquina') || maquinaActivaId(),
      volver: () => ir('#/guias' + (params.get('maquina') ? '?maquina=' + enc(params.get('maquina')) : '')),
      // Actualizar la dirección sin recargar el editor
      alGuardar: (g) => history.replaceState(null, '', '#/guia-editar/' + enc(g)),
      probar: (g) => {
        // La guía se prueba en su máquina
        import('./maquinas.js').then(async ({ obtenerGuia }) => {
          const guia = await obtenerGuia(g);
          if (guia) establecerMaquinaActiva(guia.maquinaId);
          irConCamara('#/guia-ejecutar/' + enc(g));
        });
      },
    });
  } else if (pantalla === 'detalle' && id) {
    limpiar = pantallaDetalle(app, id, {
      volver,
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
