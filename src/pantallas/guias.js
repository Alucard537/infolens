// GUÍAS de la máquina activa: listado (usuarios: solo publicadas; administrador: todas, con su estado
// y opciones de gestión) y portada de cada guía antes de empezarla.
import {
  listarGuias, obtenerGuia, obtenerMaquina, obtenerAncla, borrarGuia, duplicarGuia, guardarGuia,
  ESTADOS_GUIA, TIPOS_GUIA, maquinaActivaId,
} from '../maquinas.js';
import { obtenerArchivo } from '../db.js';
import { esAdmin } from '../permisos.js';

export function pantallaGuias(app, maquinaId, { volver, abrir, editar, nueva }) {
  let activo = true;
  const urls = [];
  let filtro = 'todas';
  const pintar = async () => {
    const admin = esAdmin();
    const [maquina, guias] = await Promise.all([obtenerMaquina(maquinaId), listarGuias(maquinaId, { soloPublicadas: !admin })]);
    if (!activo) return;
    app.innerHTML = `
      <div class="pagina">
        <button class="volver">‹ Volver</button>
        <h1>📘 Guías</h1>
        <p class="det-ref"></p>
        ${admin ? '<button class="boton" data-a="nueva">➕ Crear guía</button>' : ''}
        <div class="pestanas">
          <button class="boton-mini" data-f="todas">Todas</button>
          <button class="boton-mini" data-f="localizacion">📍 Localización</button>
          <button class="boton-mini" data-f="mantenimiento">🔧 Mantenimiento</button>
        </div>
        <ul class="lista lista-guias"></ul>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('.volver').addEventListener('click', volver);
    $('.det-ref').textContent = `Máquina: ${maquina ? maquina.nombre : maquinaId}`;
    $('[data-a="nueva"]')?.addEventListener('click', () => nueva(maquinaId));
    app.querySelectorAll('[data-f]').forEach((b) => {
      b.classList.toggle('activo', b.dataset.f === filtro);
      b.addEventListener('click', () => { filtro = b.dataset.f; pintar(); });
    });
    const ul = $('.lista-guias');
    const vis = guias.filter((g) => filtro === 'todas' || g.tipo === filtro);
    if (!vis.length) ul.innerHTML = `<li class="nota">${admin ? 'No hay guías. Crea la primera.' : 'No hay guías publicadas para esta máquina.'}</li>`;
    for (const g of vis) {
      const li = document.createElement('li');
      li.innerHTML = `<div class="fila-elemento fila-guia">
          <span class="mini"><img alt=""></span>
          <span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>
          ${admin ? `<span class="estado-guia estado-${g.estado}">${ESTADOS_GUIA[g.estado]}</span>` : ''}
        </div>
        ${admin ? `<div class="acciones-guia">
          <button class="boton-mini" data-a="editar">✏️ Editar</button>
          <button class="boton-mini" data-a="estado">${g.estado === 'publicada' ? '⏸️ Desactivar' : '📢 Publicar'}</button>
          <button class="boton-mini" data-a="duplicar">📄 Duplicar</button>
          <button class="boton-mini" data-a="borrar">🗑️</button>
        </div>` : ''}`;
      li.querySelector('.fila-nombre').textContent = g.nombre;
      li.querySelector('.fila-ref').textContent = `${TIPOS_GUIA[g.tipo]} · ${(g.pasos || []).length} pasos`;
      const img = li.querySelector('img');
      if (g.portadaId) obtenerArchivo(g.portadaId).then((a) => { if (a && activo) { const u = URL.createObjectURL(a.blob); urls.push(u); img.src = u; } });
      else img.replaceWith(Object.assign(document.createElement('span'), { textContent: g.tipo === 'mantenimiento' ? '🔧' : '📍' }));
      li.querySelector('.fila-guia').addEventListener('click', () => abrir(g.id));
      li.querySelector('[data-a="editar"]')?.addEventListener('click', () => editar(g.id));
      li.querySelector('[data-a="estado"]')?.addEventListener('click', async () => {
        try { await guardarGuia({ ...g, estado: g.estado === 'publicada' ? 'desactivada' : 'publicada' }); pintar(); } catch (e) { alert(e.message); }
      });
      li.querySelector('[data-a="duplicar"]')?.addEventListener('click', async () => { await duplicarGuia(g.id); pintar(); });
      li.querySelector('[data-a="borrar"]')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la guía "${g.nombre}"? No se puede deshacer.`)) return;
        await borrarGuia(g.id); pintar();
      });
      ul.appendChild(li);
    }
  };
  pintar();
  return () => { activo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
}

export function pantallaGuiaPortada(app, id, { volver, empezar, editar }) {
  let activo = true;
  const urls = [];
  (async () => {
    const g = await obtenerGuia(id);
    if (!activo) return;
    const admin = esAdmin();
    // Aislamiento: solo guías de la máquina activa, y publicadas (salvo para el administrador)
    const problema = !g ? 'La guía no existe.'
      : g.maquinaId !== maquinaActivaId() ? 'Esta guía no pertenece a la máquina seleccionada.'
        : g.estado !== 'publicada' && !admin ? 'Esta guía no está disponible.' : null;
    if (problema) {
      app.innerHTML = '<div class="pagina"><button class="volver">‹ Volver</button><p class="error-form"></p></div>';
      app.querySelector('.error-form').textContent = problema;
      app.querySelector('.volver').addEventListener('click', volver);
      return;
    }
    const ancla = await obtenerAncla(g.anclaId);
    app.innerHTML = `
      <div class="pagina">
        <button class="volver">‹ Guías</button>
        <div class="portada-guia" hidden><img alt=""></div>
        <h1></h1>
        <p class="det-ref"></p>
        ${admin && g.estado !== 'publicada' ? `<p class="nota">Estado: <b>${ESTADOS_GUIA[g.estado]}</b> (solo la ve el administrador).</p>` : ''}
        <p class="det-desc"></p>
        <div class="tarjeta-info">
          <div>Pasos: <b>${(g.pasos || []).length}</b></div>
          <div>Ancla QR: <b class="g-ancla"></b></div>
        </div>
        <p class="nota">⚠️ Esta guía es una ayuda: no sustituye al procedimiento técnico autorizado ni a las medidas de seguridad de la máquina.</p>
        <button class="boton grande" data-a="empezar" ${ancla ? '' : 'disabled'}>▶️ Empezar (escanear el ancla)</button>
        ${admin ? '<button class="boton secundario" data-a="editar">✏️ Editar guía</button>' : ''}
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('h1').textContent = g.nombre;
    $('.det-ref').textContent = TIPOS_GUIA[g.tipo];
    $('.det-desc').textContent = g.descripcion || '';
    $('.g-ancla').textContent = ancla ? `${ancla.nombre} (${ancla.id})` : 'sin ancla';
    $('.volver').addEventListener('click', volver);
    $('[data-a="empezar"]').addEventListener('click', () => empezar(g.id));
    $('[data-a="editar"]')?.addEventListener('click', () => editar(g.id));
    if (g.portadaId) {
      const a = await obtenerArchivo(g.portadaId);
      if (a && activo) { const u = URL.createObjectURL(a.blob); urls.push(u); $('.portada-guia img').src = u; $('.portada-guia').hidden = false; }
    }
  })();
  return () => { activo = false; urls.forEach((u) => URL.revokeObjectURL(u)); };
}
