// Lista de elementos con buscador (por nombre, referencia o ID) y miniaturas.
import { listarElementos, obtenerArchivo } from '../db.js';

// Quita acentos y pasa a minúsculas para buscar sin importar cómo se escriba
const simplificar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function pantallaLista(app, { abrirDetalle, nuevo, volver }) {
  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>Elementos <span class="contador"></span></h1>
      <input class="buscador" type="search" placeholder="🔍 Buscar por nombre, referencia o ID"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button class="boton" data-accion="nuevo">➕ Añadir elemento</button>
      <ul class="lista"></ul>
      <p class="nota vacio" hidden></p>
    </div>`;
  const $ = (s) => app.querySelector(s);
  $('.volver').addEventListener('click', volver);
  $('[data-accion="nuevo"]').addEventListener('click', () => nuevo());

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
      li.querySelector('.fila-ref').textContent = `${e.referencia} · ${e.id}`;
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
  listarElementos().then((l) => { elementos = l; if (activo) pintar(); });

  return () => {
    activo = false;
    observador.disconnect();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
