// Lista de elementos con buscador (por nombre, referencia o ID) y miniaturas.
import { listarElementos, obtenerArchivo } from '../db.js';
import { esAdmin } from '../permisos.js';
import { maquinaActivaId } from '../maquinas.js';

// Quita acentos y pasa a minúsculas para buscar sin importar cómo se escriba
const simplificar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function pantallaLista(app, { abrirDetalle, nuevo, hojaQR, volver }) {
  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>Elementos <span class="contador"></span></h1>
      <p class="nota filtro-maquina"></p>
      ${esAdmin() ? '<select class="selector-maquina"><option value="activa">Solo la máquina activa</option><option value="todas">Todas las máquinas</option><option value="sin">Sin máquina</option></select>' : ''}
      <input class="buscador" type="search" placeholder="🔍 Buscar por nombre, referencia o ID"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      ${esAdmin() ? `<div class="botones-archivo">
        <button class="boton" data-accion="nuevo">➕ Añadir</button>
        <button class="boton secundario" data-accion="hoja">🖨️ Hoja de QR</button>
      </div>` : ''}
      <ul class="lista"></ul>
      <p class="nota vacio" hidden></p>
    </div>`;
  const $ = (s) => app.querySelector(s);
  $('.volver').addEventListener('click', volver);
  $('[data-accion="nuevo"]')?.addEventListener('click', () => nuevo());
  $('[data-accion="hoja"]')?.addEventListener('click', () => hojaQR());

  const urls = new Map();      // miniaturaId -> blob: URL (se liberan al salir)
  let elementos = [];
  let activo = true;

  // Las miniaturas se cargan solo cuando se ven en pantalla (va rápido con 500 elementos)
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      observador.unobserve(e.target);
      const img = e.target;
      const id = img.dataset.mini;
      if (urls.has(id)) { img.src = urls.get(id); continue; }
      obtenerArchivo(id).then((a) => {
        if (!a || !activo) return;
        const u = URL.createObjectURL(a.blob);
        urls.set(id, u);
        img.src = u;
      });
    }
  }, { rootMargin: '300px' });

  function pintar() {
    const q = simplificar($('.buscador').value.trim());
    const filtrados = q
      ? elementos.filter((e) => simplificar(`${e.nombre} ${e.referencia} ${e.id}`).includes(q))
      : elementos;
    const ul = $('.lista');
    ul.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const e of filtrados) {
      const li = document.createElement('li');
      li.innerHTML = `
        <button class="fila-elemento">
          <span class="mini">${e.miniaturaId ? '<img alt="">' : (e.tipo === 'COMPUESTO' ? '🧩' : 'ℹ️')}</span>
          <span class="fila-textos">
            <span class="fila-nombre"></span>
            <span class="fila-ref"></span>
          </span>
        </button>`;
      li.querySelector('.fila-nombre').textContent = e.nombre;
      li.querySelector('.fila-ref').textContent = `${e.referencia} · ${e.id}${esAdmin() && e.maquinaId !== maq ? ' · ' + (e.maquinaId || 'sin máquina') : ''}`;
      li.querySelector('button').addEventListener('click', () => abrirDetalle(e.id));
      const img = li.querySelector('img');
      if (img) { img.dataset.mini = e.miniaturaId; observador.observe(img); }
      frag.appendChild(li);
    }
    ul.appendChild(frag);
    const vacio = $('.vacio');
    vacio.hidden = filtrados.length > 0;
    vacio.textContent = elementos.length === 0
      ? 'Todavía no hay elementos. Pulsa "Añadir elemento" para crear el primero.'
      : 'Ningún elemento coincide con la búsqueda.';
    $('.contador').textContent = `(${elementos.length})`;
  }

  $('.buscador').addEventListener('input', pintar);
  // Regla de aislamiento: el usuario solo ve los elementos de la máquina activa.
  // El administrador puede ver también todos o los que no tienen máquina.
  const maq = maquinaActivaId();
  let todos = [];
  const aplicarFiltro = () => {
    const modo = $('.selector-maquina') ? $('.selector-maquina').value : 'activa';
    elementos = modo === 'todas' ? todos : modo === 'sin' ? todos.filter((e) => !e.maquinaId) : todos.filter((e) => e.maquinaId === maq);
    $('.filtro-maquina').textContent = modo === 'activa' ? `Máquina activa: ${maq}` : modo === 'todas' ? 'Todas las máquinas' : 'Elementos sin máquina';
    pintar();
  };
  $('.selector-maquina')?.addEventListener('change', aplicarFiltro);
  listarElementos().then((l) => { todos = l; if (activo) aplicarFiltro(); });

  return () => {
    activo = false;
    observador.disconnect();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
