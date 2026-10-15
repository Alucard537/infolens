// Pantallas de QR: uno solo (desde el detalle) y hoja con varios (desde la lista).
import { obtenerElemento, listarElementos } from '../db.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { guardarOCompartir } from '../ui/descargar.js';

const cargarQR = () => import('../qr-pdf.js'); // jsPDF solo se carga al usarlo
const simplificar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function controlTamano(alCambiar) {
  const div = document.createElement('div');
  div.className = 'control-tamano';
  div.innerHTML = `
    <label>Tamaño del QR impreso (cm, zona negra)
      <input type="number" min="2" max="16" step="0.5" inputmode="decimal" value="${leerAjustes().qrCm}">
    </label>
    <p class="nota">⚠️ Imprime todos los QR al mismo tamaño: el escáner usa esta medida para colocar la "i" en 3D.
      Si la cambias, se cambia también en el escáner.</p>`;
  div.querySelector('input').addEventListener('change', (e) => {
    const n = parseFloat(String(e.target.value).replace(',', '.'));
    if (n >= 2 && n <= 16) { guardarAjustes({ qrCm: n }); alCambiar(n); } else e.target.value = leerAjustes().qrCm;
  });
  return div;
}

// ---------- QR de un elemento ----------
export function pantallaQR(app, id, { volver }) {
  let activo = true;
  let pdf = null;
  app.innerHTML = '<div class="pagina"><p class="nota">Cargando…</p></div>';

  (async () => {
    const [el, qr] = await Promise.all([obtenerElemento(id), cargarQR()]);
    if (!activo) return;
    if (!el) { app.innerHTML = '<div class="pagina"><p>Elemento no encontrado.</p></div>'; return; }
    app.innerHTML = `
      <div class="pagina">
        <button class="volver">‹ Volver</button>
        <h1>Código QR</h1>
        <div class="tarjeta-qr">
          <canvas class="qr-canvas"></canvas>
          <div class="qr-nombre"></div>
          <div class="qr-ref"></div>
          <div class="qr-texto"></div>
        </div>
        <div class="hueco-tamano"></div>
        <button class="boton grande" data-accion="pdf">🖨️ PDF para imprimir</button>
        <p class="nota">En el iPhone se abre el menú Compartir: elige <b>Imprimir</b> o <b>Guardar en Archivos</b>.
          En el PC se descarga el PDF. Imprime siempre al <b>100 % / tamaño real</b>.</p>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('.volver').addEventListener('click', volver);
    $('.qr-nombre').textContent = el.nombre;
    $('.qr-ref').textContent = el.referencia;
    $('.qr-texto').textContent = `Contenido del QR: ${qr.textoQR(el.id)}`;
    await qr.qrEnCanvas($('.qr-canvas'), el.id);

    const preparar = () => {
      try { pdf = qr.generarPdfQR([el], leerAjustes().qrCm); } catch (e) { pdf = null; alert(e.message); }
    };
    $('.hueco-tamano').appendChild(controlTamano(preparar));
    preparar();
    $('[data-accion="pdf"]').addEventListener('click', () => {
      if (pdf) guardarOCompartir(pdf, `QR-${el.id}.pdf`, 'application/pdf');
    });
  })();

  return () => { activo = false; };
}

// ---------- hoja con varios QR ----------
export function pantallaHojaQR(app, { volver }) {
  let activo = true;
  let elementos = [];
  const elegidos = new Set();
  let pdf = null;

  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Volver</button>
      <h1>Hoja de QR</h1>
      <p class="nota">Marca los elementos cuyos QR quieres imprimir. Se colocan tantos por hoja A4 como quepan.</p>
      <div class="hueco-tamano"></div>
      <p class="nota por-hoja"></p>
      <input class="buscador" type="search" placeholder="🔍 Buscar por nombre, referencia o ID"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <div class="botones-archivo">
        <button class="boton secundario" data-accion="todos">☑️ Marcar los visibles</button>
        <button class="boton secundario" data-accion="ninguno">⬜ Quitar todos</button>
      </div>
      <ul class="lista lista-marcar"></ul>
      <div class="barra-inferior">
        <button class="boton grande" data-accion="crear" disabled>🖨️ Crear PDF</button>
        <button class="boton grande" data-accion="guardar" hidden>💾 Guardar / imprimir PDF</button>
      </div>
    </div>`;
  const $ = (s) => app.querySelector(s);
  $('.volver').addEventListener('click', volver);

  let qrMod = null;
  cargarQR().then((m) => { qrMod = m; actualizarPorHoja(); });
  const actualizarPorHoja = () => {
    if (!qrMod) return;
    const n = qrMod.qrPorHoja(leerAjustes().qrCm);
    $('.por-hoja').textContent = n ? `Con este tamaño caben ${n} QR por hoja A4.` : 'Con este tamaño no cabe en A4.';
  };
  $('.hueco-tamano').appendChild(controlTamano(() => { actualizarPorHoja(); invalidar(); }));

  const visibles = () => {
    const q = simplificar($('.buscador').value.trim());
    return q ? elementos.filter((e) => simplificar(`${e.nombre} ${e.referencia} ${e.id}`).includes(q)) : elementos;
  };
  function invalidar() {
    pdf = null;
    $('[data-accion="guardar"]').hidden = true;
    const b = $('[data-accion="crear"]');
    b.hidden = false;
    b.disabled = elegidos.size === 0;
    b.textContent = `🖨️ Crear PDF (${elegidos.size} QR)`;
  }
  function pintar() {
    const ul = $('.lista');
    ul.innerHTML = '';
    for (const e of visibles()) {
      const li = document.createElement('li');
      li.innerHTML = `<label class="fila-elemento fila-marcar">
          <input type="checkbox">
          <span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>
        </label>`;
      li.querySelector('.fila-nombre').textContent = e.nombre;
      li.querySelector('.fila-ref').textContent = `${e.referencia} · ${e.id}`;
      const cb = li.querySelector('input');
      cb.checked = elegidos.has(e.id);
      cb.addEventListener('change', () => { cb.checked ? elegidos.add(e.id) : elegidos.delete(e.id); invalidar(); });
      ul.appendChild(li);
    }
  }
  $('.buscador').addEventListener('input', pintar);
  $('[data-accion="todos"]').addEventListener('click', () => { visibles().forEach((e) => elegidos.add(e.id)); pintar(); invalidar(); });
  $('[data-accion="ninguno"]').addEventListener('click', () => { elegidos.clear(); pintar(); invalidar(); });

  $('[data-accion="crear"]').addEventListener('click', async () => {
    const b = $('[data-accion="crear"]');
    b.disabled = true; b.textContent = 'Creando PDF…';
    try {
      const m = qrMod || (await cargarQR());
      const lista = elementos.filter((e) => elegidos.has(e.id));
      await new Promise((r) => setTimeout(r, 30)); // dejar que se vea "Creando…"
      pdf = m.generarPdfQR(lista, leerAjustes().qrCm);
      b.hidden = true;
      $('[data-accion="guardar"]').hidden = false;
    } catch (e) {
      alert(e.message);
      invalidar();
    }
  });
  $('[data-accion="guardar"]').addEventListener('click', () => {
    if (pdf) guardarOCompartir(pdf, `QR-hoja-${elegidos.size}.pdf`, 'application/pdf');
  });

  listarElementos().then((l) => { if (!activo) return; elementos = l; pintar(); invalidar(); });
  return () => { activo = false; };
}
