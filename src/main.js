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

// El escáner (con three.js) se carga solo cuando se usa, para que la app arranque más rápido
const cargarEscaner = () => import('./pantallas/escaner.js');

function pantallaInicio() {
  app.innerHTML = `
    <div class="pagina">
      <h1 class="titulo-app"></h1>
      <button class="boton grande" data-ir="#/escaner">📷 Escanear</button>
      <button class="boton secundario" data-ir="#/elementos">📋 Elementos <span class="cuenta"></span></button>
      <button class="boton secundario" data-ir="#/nuevo">➕ Añadir elemento</button>
      <button class="boton secundario" data-ir="#/copia">💾 Copia de seguridad</button>
      <button class="boton secundario" data-ir="#/importar">📊 Importar desde Excel (PC)</button>
      <button class="boton secundario" disabled>⚙️ Ajustes</button>
      <p class="nota">Versión ${__VERSION__}</p>
    </div>`;
  app.querySelector('.titulo-app').textContent = APP_NAME;
  app.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.ir === '#/escaner') pedirPermisoSensor(); // iPhone: el permiso se pide en el mismo toque
    ir(b.dataset.ir);
  }));
  contarElementos().then((n) => { const c = app.querySelector('.cuenta'); if (c) c.textContent = `(${n})`; });
  cargarEscaner(); // ir cargando el escáner en segundo plano
}

async function mostrar() {
  const miTurno = ++turno;
  if (limpiar) { try { limpiar(); } catch {} limpiar = null; }
  document.querySelectorAll('.visor').forEach((v) => v.remove());
  const ruta = location.hash.replace(/^#/, '') || '/';
  const [pantalla, param] = ruta.split('/').filter(Boolean);
  const id = param ? decodeURIComponent(param) : '';
  document.body.classList.toggle('modo-escaner', pantalla === 'escaner' || pantalla === 'huella');
  window.scrollTo(0, 0);

  if (pantalla === 'escaner') {
    const { pantallaEscaner } = await cargarEscaner();
    if (miTurno !== turno) return;
    limpiar = pantallaEscaner(app, {
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      darDeAlta: (i) => ir('#/nuevo/' + enc(i)),
      volver: () => ir('#/'),
    });
  } else if (pantalla === 'detalle' && id) {
    limpiar = pantallaDetalle(app, id, {
      volver,
      editar: (i) => ir('#/editar/' + enc(i)),
      imprimirQR: (i) => ir('#/qr/' + enc(i)),
      huella: (i) => ir('#/huella/' + enc(i)),
      darDeAlta: (i) => ir('#/nuevo/' + enc(i)),
    });
  } else if (pantalla === 'elementos') {
    limpiar = pantallaLista(app, {
      abrirDetalle: (i) => ir('#/detalle/' + enc(i)),
      nuevo: () => ir('#/nuevo'),
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
      alGuardar: (i) => sustituir('#/detalle/' + enc(i)),
      alBorrar: () => sustituir('#/elementos'),
      volver,
    });
  } else {
    pantallaInicio();
  }
}

// Arranque: cargar ajustes y el elemento de ejemplo antes de mostrar la primera pantalla
(async () => {
  await cargarAjustes();
  await crearEjemploSiHaceFalta();
  window.addEventListener('hashchange', mostrar);
  mostrar();
})();
