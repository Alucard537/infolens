// Punto de entrada: decide qué pantalla mostrar según la dirección (#/...).
import './style.css';
import { APP_NAME } from './config.js';
import { pantallaEscaner } from './pantallas/escaner.js';
import { pantallaDetalle } from './pantallas/detalle.js';

import { registerSW } from 'virtual:pwa-register';

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

const ir = (ruta) => { location.hash = ruta; };
const volver = () => (history.length > 1 ? history.back() : ir('#/'));

function pantallaInicio() {
  app.innerHTML = `
    <div class="pagina">
      <h1 class="titulo-app"></h1>
      <button class="boton grande" data-ir="#/escaner">📷 Escanear</button>
      <button class="boton secundario" disabled>📋 Elementos</button>
      <button class="boton secundario" disabled>➕ Añadir elemento</button>
      <button class="boton secundario" disabled>💾 Copia de seguridad</button>
      <button class="boton secundario" disabled>⚙️ Ajustes</button>
      <p class="nota">Fase 2: app instalable. Los botones grises se activarán en las próximas fases.</p>
    </div>`;
  app.querySelector('.titulo-app').textContent = APP_NAME;
  app.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => ir(b.dataset.ir)));
}

function mostrar() {
  if (limpiar) { limpiar(); limpiar = null; }
  document.querySelectorAll('.visor').forEach((v) => v.remove());
  const ruta = location.hash.replace(/^#/, '') || '/';
  const partes = ruta.split('/').filter(Boolean);
  document.body.classList.toggle('modo-escaner', partes[0] === 'escaner');

  if (partes[0] === 'escaner') {
    limpiar = pantallaEscaner(app, {
      abrirDetalle: (id) => ir('#/detalle/' + encodeURIComponent(id)),
      volver: () => ir('#/'),
    });
  } else if (partes[0] === 'detalle' && partes[1]) {
    pantallaDetalle(app, decodeURIComponent(partes[1]), { volver });
  } else {
    pantallaInicio();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', mostrar);
mostrar();
