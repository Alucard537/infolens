// Pantallas de máquinas:
//  - MÁQUINAS: elegir la máquina activa (todos) y, el administrador, crear / gestionar.
//  - Gestión de una máquina (administrador): datos, elementos asociados, anclas y guías.
//  - Formulario de máquina (administrador).
import {
  listarMaquinas, obtenerMaquina, guardarMaquina, borrarMaquina, dependenciasMaquina, maquinaActivaId,
  establecerMaquinaActiva, elementosDeMaquina, elementosSinMaquina, asignarElemento, desvincularElemento,
  listarAnclas, guardarAncla, borrarAncla, dependenciasAncla, siguienteIdAncla, listarGuias, localizacionesDeElemento,
} from '../maquinas.js';
import { listarElementos } from '../db.js';
import { esAdmin } from '../permisos.js';
import { leerAjustes } from '../ajustes.js';
import { guardarOCompartir } from '../ui/descargar.js';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- MÁQUINAS (elegir)
export function pantallaMaquinas(app, { volver, gestionar, nueva, alElegir, aviso }) {
  let activo = true;
  app.innerHTML = '<div class="pagina"><p class="nota">Cargando…</p></div>';
  (async () => {
    const maquinas = await listarMaquinas();
    if (!activo) return;
    const actual = maquinaActivaId();
    const admin = esAdmin();
    app.innerHTML = `
      <div class="pagina">
        <button class="volver">‹ Inicio</button>
        <h1>Máquinas</h1>
        ${aviso ? `<p class="error-form">${esc(aviso)}</p>` : ''}
        <p class="nota">Elige la máquina con la que vas a trabajar. El escáner, las anclas y las guías solo usarán sus datos.</p>
        ${admin ? '<button class="boton" data-accion="nueva">➕ Nueva máquina</button>' : ''}
        <ul class="lista lista-maquinas"></ul>
        ${!maquinas.length ? `<p class="nota">${admin ? 'Todavía no hay máquinas. Crea la primera.' : 'Todavía no hay máquinas. Pide al administrador que te envíe una actualización.'}</p>` : ''}
      </div>`;
    app.querySelector('.volver').addEventListener('click', volver);
    app.querySelector('[data-accion="nueva"]')?.addEventListener('click', nueva);
    const ul = app.querySelector('.lista-maquinas');
    for (const m of maquinas) {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="fila-elemento fila-maquina ${m.id === actual ? 'activa' : ''}">
          <span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>
          <span class="acciones-fila">
            <button class="boton-mini" data-a="elegir">${m.id === actual ? '✅ Activa' : 'Seleccionar'}</button>
            ${admin ? '<button class="boton-mini" data-a="gestionar">⚙️ Gestionar</button>' : ''}
          </span>
        </div>`;
      li.querySelector('.fila-nombre').textContent = m.nombre;
      li.querySelector('.fila-ref').textContent = `${m.id}${m.modelo ? ' · ' + m.modelo : ''}`;
      li.querySelector('[data-a="elegir"]').addEventListener('click', () => { establecerMaquinaActiva(m.id); alElegir(m.id); });
      li.querySelector('[data-a="gestionar"]')?.addEventListener('click', () => gestionar(m.id));
      ul.appendChild(li);
    }
  })();
  return () => { activo = false; };
}

// ---------------------------------------------------------------- formulario de máquina
export function pantallaMaquinaForm(app, id, { volver, alGuardar, alBorrar }) {
  const esNueva = !id;
  let activo = true;
  app.innerHTML = `
    <div class="pagina formulario">
      <button class="volver">‹ Volver</button>
      <h1>${esNueva ? 'Nueva máquina' : 'Editar máquina'}</h1>
      <form novalidate>
        <label>Identificador único (no se puede cambiar después)
          <input name="id" required autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Por ejemplo CL8">
        </label>
        <label>Nombre *<input name="nombre" required autocomplete="off" placeholder="Por ejemplo CL8 línea 2"></label>
        <label>Modelo<input name="modelo" autocomplete="off"></label>
        <label>Descripción<textarea name="descripcion" rows="3"></textarea></label>
        <p class="error-form" hidden></p>
        <button class="boton grande" type="submit">💾 Guardar</button>
        ${esNueva ? '' : '<button type="button" class="boton peligro" data-accion="borrar">🗑️ Eliminar máquina</button>'}
      </form>
    </div>`;
  const form = app.querySelector('form');
  const err = (m) => { const e = form.querySelector('.error-form'); e.hidden = !m; e.textContent = m || ''; };
  app.querySelector('.volver').addEventListener('click', volver);
  if (!esNueva) {
    obtenerMaquina(id).then((m) => {
      if (!m || !activo) return;
      form.elements.id.value = m.id; form.elements.id.readOnly = true;
      form.elements.nombre.value = m.nombre; form.elements.modelo.value = m.modelo || '';
      form.elements.descripcion.value = m.descripcion || '';
    });
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err('');
    try {
      const f = form.elements;
      const m = await guardarMaquina({ id: f.id.value, nombre: f.nombre.value, modelo: f.modelo.value, descripcion: f.descripcion.value }, esNueva);
      alGuardar(m.id);
    } catch (ex) { err(ex.message); }
  });
  app.querySelector('[data-accion="borrar"]')?.addEventListener('click', async () => {
    const d = await dependenciasMaquina(id);
    const texto = `¿Eliminar la máquina ${id}?\n\n`
      + `• ${d.elementos} elementos quedarán SIN máquina (no se borran).\n`
      + `• Se borrarán ${d.anclas} anclas, ${d.localizaciones} localizaciones y ${d.guias} guías.\n\nNo se puede deshacer.`;
    if (!confirm(texto)) return;
    await borrarMaquina(id);
    alBorrar();
  });
  return () => { activo = false; };
}

// ---------------------------------------------------------------- gestión de una máquina
export function pantallaMaquina(app, id, { volver, editarMaquina, editarElemento, nuevoElemento, localizaciones, guias, alCambiar }) {
  let activo = true;
  const pintar = async () => {
    const [m, elementos, anclas, listaGuias] = await Promise.all([obtenerMaquina(id), elementosDeMaquina(id), listarAnclas(id), listarGuias(id)]);
    if (!activo) return;
    if (!m) { app.innerHTML = '<div class="pagina"><button class="volver">‹ Volver</button><p>La máquina no existe.</p></div>'; app.querySelector('.volver').addEventListener('click', volver); return; }
    const nLoc = new Map(await Promise.all(elementos.map(async (e) => [e.id, (await localizacionesDeElemento(e.id)).length])));
    const activa = maquinaActivaId() === id;
    app.innerHTML = `
      <div class="pagina">
        <button class="volver">‹ Máquinas</button>
        <h1></h1>
        <p class="det-ref"></p>
        <div class="botones-archivo">
          <button class="boton secundario" data-a="editar">✏️ Editar datos</button>
          <button class="boton ${activa ? 'secundario' : ''}" data-a="activar" ${activa ? 'disabled' : ''}>${activa ? '✅ Es la máquina activa' : 'Seleccionar como activa'}</button>
        </div>

        <h2>🧩 Elementos asociados (${elementos.length})</h2>
        <div class="botones-archivo">
          <button class="boton" data-a="crear">➕ Crear elemento aquí</button>
          <button class="boton secundario" data-a="anadir">📎 Añadir existentes</button>
        </div>
        <div class="anadir-existentes" hidden></div>
        <ul class="lista lista-elementos-maquina"></ul>

        <div class="seccion-anclas"></div>

        <h2>📘 Guías (${listaGuias.length})</h2>
        <button class="boton secundario" data-a="guias">Gestionar las guías de esta máquina</button>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('h1').textContent = m.nombre;
    $('.det-ref').textContent = `${m.id}${m.modelo ? ' · ' + m.modelo : ''}${m.descripcion ? ' — ' + m.descripcion : ''}`;
    $('.volver').addEventListener('click', volver);
    $('[data-a="editar"]').addEventListener('click', () => editarMaquina(id));
    $('[data-a="activar"]').addEventListener('click', () => { establecerMaquinaActiva(id); alCambiar && alCambiar(); pintar(); });
    $('[data-a="crear"]').addEventListener('click', () => nuevoElemento(id));
    $('[data-a="guias"]').addEventListener('click', () => guias(id));

    // Elementos asociados
    const ul = $('.lista-elementos-maquina');
    if (!elementos.length) ul.innerHTML = '<li class="nota">Ningún elemento todavía.</li>';
    for (const e of elementos) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="fila-elemento fila-maquina">
          <span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>
          <span class="acciones-fila">
            <button class="boton-mini" data-a="ed">✏️</button>
            <button class="boton-mini" data-a="loc">🧭 ${nLoc.get(e.id) || 0}</button>
            <button class="boton-mini" data-a="des">🔗 Quitar</button>
          </span></div>`;
      li.querySelector('.fila-nombre').textContent = e.nombre;
      li.querySelector('.fila-ref').textContent = `${e.referencia} · ${e.id}`;
      li.querySelector('[data-a="ed"]').addEventListener('click', () => editarElemento(e.id));
      li.querySelector('[data-a="loc"]').addEventListener('click', () => localizaciones(e.id));
      li.querySelector('[data-a="des"]').addEventListener('click', async () => {
        if (!confirm(`¿Quitar "${e.nombre}" de la máquina ${id}?\n\nEl elemento NO se borra; se borran sus localizaciones en esta máquina.`)) return;
        await desvincularElemento(e.id);
        pintar();
      });
      ul.appendChild(li);
    }

    // Añadir elementos existentes (los que no tienen máquina; los de otra, con aviso)
    $('[data-a="anadir"]').addEventListener('click', async () => {
      const cont = $('.anadir-existentes');
      if (!cont.hidden) { cont.hidden = true; return; }
      const [sin, todos] = await Promise.all([elementosSinMaquina(), listarElementos()]);
      const otros = todos.filter((e) => e.maquinaId && e.maquinaId !== id);
      cont.hidden = false;
      cont.innerHTML = '<input class="buscador" type="search" placeholder="🔍 Buscar"><ul class="lista lista-marcar"></ul><button class="boton" data-a="asociar">📎 Asociar seleccionados</button>';
      const elegidos = new Set();
      const lista = cont.querySelector('ul');
      const pintarLista = () => {
        const q = cont.querySelector('input').value.toLowerCase();
        lista.innerHTML = '';
        for (const e of [...sin, ...otros]) {
          if (q && !`${e.nombre} ${e.referencia} ${e.id}`.toLowerCase().includes(q)) continue;
          const li = document.createElement('li');
          li.innerHTML = '<label class="fila-elemento fila-marcar"><input type="checkbox"><span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span></label>';
          li.querySelector('.fila-nombre').textContent = e.nombre;
          li.querySelector('.fila-ref').textContent = `${e.referencia} · ${e.id} · ${e.maquinaId ? '⚠️ ahora en ' + e.maquinaId : 'sin máquina'}`;
          const cb = li.querySelector('input');
          cb.checked = elegidos.has(e.id);
          cb.addEventListener('change', () => (cb.checked ? elegidos.add(e.id) : elegidos.delete(e.id)));
          lista.appendChild(li);
        }
        if (!lista.children.length) lista.innerHTML = '<li class="nota">No hay elementos disponibles.</li>';
      };
      cont.querySelector('input').addEventListener('input', pintarLista);
      pintarLista();
      cont.querySelector('[data-a="asociar"]').addEventListener('click', async () => {
        const mover = [...elegidos].filter((x) => otros.some((o) => o.id === x));
        if (mover.length && !confirm(`${mover.length} elementos están en otra máquina. Se moverán a ${id} y perderán sus localizaciones anteriores. ¿Continuar?`)) return;
        for (const x of elegidos) await asignarElemento(x, id);
        pintar();
      });
    });

    // Anclas
    montarAnclas($('.seccion-anclas'), m);
  };
  pintar();
  return () => { activo = false; };
}

// ---------------------------------------------------------------- sección de anclas (reutilizable)
/** Lista de anclas de una máquina con crear, editar, imprimir su QR y borrar. */
export async function montarAnclas(cont, m, { alCambiar } = {}) {
  const anclas = await listarAnclas(m.id);
  cont.innerHTML = `
    <h2>⚓ Anclas QR (${anclas.length})</h2>
    <p class="nota">Cada ancla es un QR fijo en la máquina que sirve de referencia (0, 0, 0) para localizar componentes
      y para las guías. Créala aquí, imprime su QR, pégalo en la máquina y después posiciona los componentes con el botón 📍 de ANCLA.</p>
    <button class="boton" data-a="nueva-ancla">➕ Nueva ancla</button>
    <form class="form-ancla bloque-archivo formulario" hidden novalidate></form>
    <ul class="lista lista-anclas"></ul>`;
  const $ = (q) => cont.querySelector(q);
  const repintar = () => { montarAnclas(cont, m, { alCambiar }); alCambiar && alCambiar(); };
  const ula = $('.lista-anclas');
  if (!anclas.length) ula.innerHTML = '<li class="nota">Esta máquina todavía no tiene anclas.</li>';
  for (const a of anclas) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="fila-elemento fila-maquina">
        <span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>
        <span class="acciones-fila">
          <button class="boton-mini" data-a="qr">🖨️ Marcador</button>
          <button class="boton-mini" data-a="ed">✏️</button>
          <button class="boton-mini" data-a="del">🗑️</button>
        </span></div>`;
    li.querySelector('.fila-nombre').textContent = `⚓ ${a.nombre}`;
    li.querySelector('.fila-ref').textContent = `QR: ${a.id} · ${a.gravedad ? 'orientación del QR guardada' : 'orientación sin medir (se mide al posicionar)'}`;
    li.querySelector('[data-a="qr"]').addEventListener('click', async () => {
      // Marcador de ancla: el QR en el centro de un dibujo que el AR de Apple (LiDAR) reconoce bien
      const { generarPdfMarcador } = await import('../qr-pdf.js');
      const pdf = generarPdfMarcador([{ id: a.id, nombre: a.nombre, referencia: `Máquina ${m.id}` }], leerAjustes().qrCm);
      guardarOCompartir(pdf, `ANCLA-${a.id}.pdf`, 'application/pdf');
    });
    li.querySelector('[data-a="ed"]').addEventListener('click', () => formularioAncla(a));
    li.querySelector('[data-a="del"]').addEventListener('click', async () => {
      const d = await dependenciasAncla(a.id);
      if (!confirm(`¿Borrar el ancla ${a.id}?\n\nSe borrarán ${d.localizaciones} localizaciones y ${d.guias} guías quedarán sin ancla (en borrador).`)) return;
      await borrarAncla(a.id);
      repintar();
    });
    ula.appendChild(li);
  }
  $('[data-a="nueva-ancla"]').addEventListener('click', () => formularioAncla(null));

  async function formularioAncla(a) {
    const fo = $('.form-ancla');
    fo.hidden = false;
    fo.innerHTML = `
      <div class="titulo-archivo">${a ? 'Editar ancla' : 'Nueva ancla'}</div>
      <label>Identificador (es lo que lleva su QR)<input name="id" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <label>Nombre<input name="nombre" autocomplete="off" placeholder="Por ejemplo Frontal izquierdo"></label>
      <label>Descripción<input name="descripcion" autocomplete="off"></label>
      <p class="error-form" hidden></p>
      <div class="botones-archivo"><button class="boton" type="submit">💾 Guardar ancla</button><button class="boton secundario" type="button" data-a="cancelar">Cancelar</button></div>`;
    fo.elements.id.value = a ? a.id : await siguienteIdAncla(m.id);
    fo.elements.id.readOnly = !!a;
    fo.elements.nombre.value = a ? a.nombre : '';
    fo.elements.descripcion.value = a ? a.descripcion || '' : '';
    fo.querySelector('[data-a="cancelar"]').addEventListener('click', () => { fo.hidden = true; });
    fo.onsubmit = async (ev) => {
      ev.preventDefault();
      const er = fo.querySelector('.error-form');
      try {
        await guardarAncla({ id: fo.elements.id.value, maquinaId: m.id, nombre: fo.elements.nombre.value, descripcion: fo.elements.descripcion.value }, !a);
        repintar();
      } catch (ex) { er.hidden = false; er.textContent = ex.message; }
    };
    fo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fo.elements.nombre.focus();
  }
}

// ---------------------------------------------------------------- Gestión de anclas (máquina activa)
export function pantallaAnclas(app, maquinaId, { volver, cambiarMaquina }) {
  let activo = true;
  (async () => {
    const m = await obtenerMaquina(maquinaId);
    if (!activo) return;
    app.innerHTML = `
      <div class="pagina formulario">
        <button class="volver">‹ Volver</button>
        <h1>⚓ Gestión de anclas</h1>
        <p class="det-ref"></p>
        <button class="boton-mini" data-a="otra">🏭 Cambiar de máquina</button>
        <div class="seccion-anclas"></div>
      </div>`;
    app.querySelector('.volver').addEventListener('click', volver);
    app.querySelector('[data-a="otra"]').addEventListener('click', cambiarMaquina);
    if (!m) { app.querySelector('.det-ref').textContent = 'No hay máquina activa.'; return; }
    app.querySelector('.det-ref').textContent = `Máquina: ${m.nombre} (${m.id})`;
    montarAnclas(app.querySelector('.seccion-anclas'), m);
  })();
  return () => { activo = false; };
}
