// Editor de guías (administrador): datos de la guía y sus pasos.
// Cada paso puede combinar: texto, fotos, vídeos, un componente de la máquina (reutiliza sus
// coordenadas guardadas para el ancla de la guía), flechas 3D, icono 3D, advertencia de seguridad,
// comprobaciones y confirmación. Solo se pueden elegir anclas y componentes de la máquina de la guía.
import {
  obtenerGuia, guardarGuia, obtenerMaquina, listarAnclas, elementosDeMaquina, localizacionesDeAncla, guardarAncla, siguienteIdAncla,
  pasoVacio, ESTADOS_GUIA, TIPOS_GUIA,
} from '../maquinas.js';
import { guardarArchivo, borrarArchivos, obtenerArchivo } from '../db.js';
import { prepararFoto } from '../imagenes.js';

const cm = (m) => String(Math.round(m * 1000) / 10).replace('.', ',');
// Lee un número aunque se escriba "X=-130", "-130 cm" o con coma decimal ("1,5")
const num = (t) => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(String(t ?? '').replace(/\s+/g, ''));
  return m ? parseFloat(m[0].replace(',', '.')) : NaN;
};
const MB = 1024 * 1024;

export function pantallaGuiaEditor(app, { id, maquinaId: maquinaNueva, volver, alGuardar, probar }) {
  let activo = true;
  let g = null;                 // guía que se edita (copia)
  let anclas = [], elementos = [], locs = new Map();
  const archivosNuevos = new Set(); // subidos en esta edición (se borran si no se guarda)
  let guardado = false;
  const urls = new Map();
  const abiertos = new Set();

  const urlDe = async (fid) => {
    if (urls.has(fid)) return urls.get(fid);
    const a = await obtenerArchivo(fid);
    const u = a ? URL.createObjectURL(a.blob) : '';
    urls.set(fid, u);
    return u;
  };

  async function cargarLocs() {
    locs = new Map();
    if (g.anclaId) for (const l of await localizacionesDeAncla(g.maquinaId, g.anclaId)) locs.set(l.elementoId, l);
  }

  (async () => {
    g = id ? await obtenerGuia(id) : null;
    if (id && !g) { app.innerHTML = '<div class="pagina"><p>La guía no existe.</p></div>'; return; }
    g = g ? JSON.parse(JSON.stringify(g)) : {
      id: null, maquinaId: maquinaNueva, nombre: '', tipo: 'localizacion', descripcion: '', anclaId: null,
      portadaId: null, estado: 'borrador', pasos: [],
    };
    const maquina = await obtenerMaquina(g.maquinaId);
    if (!maquina) { app.innerHTML = '<div class="pagina"><p>La máquina de la guía no existe.</p></div>'; return; }
    [anclas, elementos] = await Promise.all([listarAnclas(g.maquinaId), elementosDeMaquina(g.maquinaId)]);
    if (!g.anclaId && anclas.length === 1) g.anclaId = anclas[0].id;
    await cargarLocs();
    if (!activo) return;
    pintar(maquina);
  })();

  async function subir(archivo, esFoto) {
    let blob = archivo, nombre = archivo.name || 'archivo';
    if (esFoto) { blob = (await prepararFoto(archivo)).imagen; nombre = nombre.replace(/\.[^.]+$/, '') + '.jpg'; }
    else if (archivo.size > 200 * MB) throw new Error('El vídeo pesa más de 200 MB: recórtalo o redúcelo antes.');
    const fid = await guardarArchivo(blob, nombre);
    archivosNuevos.add(fid);
    return fid;
  }

  function pintar(maquina) {
    app.innerHTML = `
      <div class="pagina formulario editor-guia">
        <button class="volver">‹ Volver</button>
        <h1>${g.id ? 'Editar guía' : 'Crear guía'}</h1>
        <p class="det-ref">Máquina: ${maquina.nombre} (${maquina.id})</p>
        <label>Nombre de la guía *<input name="nombre" autocomplete="off"></label>
        <fieldset class="tipo">
          <legend>Tipo</legend>
          <label class="opcion"><input type="radio" name="tipo" value="localizacion"> 📍 Localización</label>
          <label class="opcion"><input type="radio" name="tipo" value="mantenimiento"> 🔧 Mantenimiento</label>
        </fieldset>
        <label>Descripción<textarea name="descripcion" rows="3"></textarea></label>
        <label>Ancla QR que usará la guía<select name="ancla"><option value="">— Elige un ancla —</option></select></label>
        <button type="button" class="boton-mini" data-a="crear-ancla">➕ Crear ancla nueva</button>
        <div class="bloque-archivo form-ancla-guia" hidden>
          <div class="titulo-archivo">⚓ Nueva ancla de ${maquina.nombre}</div>
          <label>Identificador (lo que llevará su QR)<input name="anclaNuevaId" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
          <label>Nombre<input name="anclaNuevaNombre" autocomplete="off" placeholder="Por ejemplo Frontal izquierdo"></label>
          <p class="error-form error-ancla" hidden></p>
          <div class="botones-archivo">
            <button type="button" class="boton" data-a="guardar-ancla">💾 Crear y usar en la guía</button>
            <button type="button" class="boton secundario" data-a="cancelar-ancla">Cancelar</button>
          </div>
          <p class="nota">Después imprime su QR en ⚓ Gestión de anclas y pégalo en la máquina.</p>
        </div>
        ${!anclas.length ? '<p class="nota aviso-sin-anclas">Esta máquina aún no tiene anclas: crea una con el botón de arriba.</p>' : ''}
        <div class="bloque-archivo">
          <div class="titulo-archivo">🖼️ Imagen de portada</div>
          <img class="vista-foto portada" alt="" hidden>
          <label class="boton secundario">Elegir imagen<input type="file" accept="image/*" class="entrada-oculta" data-e="portada"></label>
          <button type="button" class="quitar" data-a="sin-portada" hidden>Quitar portada</button>
        </div>
        <label>Estado
          <select name="estado">${Object.entries(ESTADOS_GUIA).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </label>
        <small class="ayuda">Borrador: solo la ve el administrador · Publicada: la ven los usuarios · Desactivada: se conserva pero no se usa.</small>

        <h2>Pasos (<span class="n-pasos"></span>)</h2>
        <div class="pasos"></div>
        <div class="botones-archivo">
          <button type="button" class="boton" data-a="paso">➕ Añadir paso</button>
          <button type="button" class="boton secundario" data-a="todos">📍 Un paso por cada componente localizado</button>
        </div>
        <p class="error-form" hidden></p>
        <p class="ok-form" hidden></p>
        <button type="button" class="boton grande" data-a="guardar">💾 Guardar guía</button>
        <button type="button" class="boton secundario" data-a="probar">▶️ Guardar y probar</button>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('.volver').addEventListener('click', volver);
    const campo = (n) => app.querySelector(`[name="${n}"]`);
    campo('nombre').value = g.nombre;
    app.querySelector(`[name="tipo"][value="${g.tipo}"]`).checked = true;
    campo('descripcion').value = g.descripcion || '';
    for (const a of anclas) {
      const o = document.createElement('option');
      o.value = a.id; o.textContent = `${a.nombre} (${a.id})`;
      campo('ancla').appendChild(o);
    }
    campo('ancla').value = g.anclaId || '';
    campo('estado').value = g.estado;
    campo('nombre').addEventListener('input', (e) => { g.nombre = e.target.value; });
    campo('descripcion').addEventListener('input', (e) => { g.descripcion = e.target.value; });
    app.querySelectorAll('[name="tipo"]').forEach((r) => r.addEventListener('change', () => { g.tipo = r.value; }));
    campo('estado').addEventListener('change', (e) => { g.estado = e.target.value; });
    campo('ancla').addEventListener('change', async (e) => { g.anclaId = e.target.value || null; await cargarLocs(); pintarPasos(); });
    // Crear un ancla nueva sin salir del editor
    const formAncla = $('.form-ancla-guia');
    $('[data-a="crear-ancla"]').addEventListener('click', async () => {
      formAncla.hidden = false;
      campo('anclaNuevaId').value = await siguienteIdAncla(g.maquinaId);
      campo('anclaNuevaNombre').focus();
    });
    $('[data-a="cancelar-ancla"]').addEventListener('click', () => { formAncla.hidden = true; });
    $('[data-a="guardar-ancla"]').addEventListener('click', async () => {
      const er = $('.error-ancla');
      er.hidden = true;
      try {
        const a = await guardarAncla({ id: campo('anclaNuevaId').value, maquinaId: g.maquinaId, nombre: campo('anclaNuevaNombre').value }, true);
        anclas = await listarAnclas(g.maquinaId);
        const sel = campo('ancla');
        sel.innerHTML = '<option value="">— Elige un ancla —</option>';
        for (const x of anclas) { const o = document.createElement('option'); o.value = x.id; o.textContent = `${x.nombre} (${x.id})`; sel.appendChild(o); }
        sel.value = a.id;
        g.anclaId = a.id;
        formAncla.hidden = true;
        $('.aviso-sin-anclas')?.remove();
        await cargarLocs();
        pintarPasos();
      } catch (ex) { er.hidden = false; er.textContent = ex.message; }
    });

    // Portada
    const portada = $('.portada');
    const verPortada = async () => {
      portada.hidden = !g.portadaId;
      $('[data-a="sin-portada"]').hidden = !g.portadaId;
      if (g.portadaId) portada.src = await urlDe(g.portadaId);
    };
    verPortada();
    app.querySelector('[data-e="portada"]').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { g.portadaId = await subir(f, true); verPortada(); } catch (ex) { mensaje(ex.message); }
    });
    $('[data-a="sin-portada"]').addEventListener('click', () => { g.portadaId = null; verPortada(); });

    $('[data-a="paso"]').addEventListener('click', () => { const p = pasoVacio(); g.pasos.push(p); abiertos.add(p.id); pintarPasos(); });
    $('[data-a="todos"]').addEventListener('click', () => {
      if (!g.anclaId) { mensaje('Elige primero el ancla de la guía.'); return; }
      const ya = new Set(g.pasos.map((p) => p.elementoId));
      const nuevos = [...locs.values()].filter((l) => !ya.has(l.elementoId));
      if (!nuevos.length) { mensaje('No hay componentes localizados nuevos para esta ancla.'); return; }
      for (const l of nuevos) g.pasos.push({ ...pasoVacio(), titulo: `Localizar: ${l.elemento.nombre}`, elementoId: l.elementoId });
      pintarPasos();
    });
    $('[data-a="guardar"]').addEventListener('click', () => guardar(false));
    $('[data-a="probar"]').addEventListener('click', () => guardar(true));
    pintarPasos();
  }

  function mensaje(err, ok) {
    const e = app.querySelector('.editor-guia > .error-form'), o = app.querySelector('.editor-guia > .ok-form');
    e.hidden = !err; e.textContent = err || '';
    o.hidden = !ok; o.textContent = ok || '';
    if (err) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function pintarPasos() {
    const cont = app.querySelector('.pasos');
    app.querySelector('.n-pasos').textContent = g.pasos.length;
    cont.innerHTML = '';
    g.pasos.forEach((p, i) => cont.appendChild(tarjetaPaso(p, i)));
  }

  function tarjetaPaso(p, i) {
    const d = document.createElement('details');
    d.className = 'paso-editor bloque-archivo';
    d.open = abiertos.has(p.id);
    d.addEventListener('toggle', () => (d.open ? abiertos.add(p.id) : abiertos.delete(p.id)));
    const el = elementos.find((e) => e.id === p.elementoId);
    d.innerHTML = `
      <summary><b>Paso ${i + 1}</b> · <span class="resumen-paso"></span></summary>
      <div class="acciones-paso">
        <button type="button" class="boton-mini" data-m="sube">↑</button>
        <button type="button" class="boton-mini" data-m="baja">↓</button>
        <button type="button" class="boton-mini" data-m="dup">📄 Duplicar</button>
        <button type="button" class="boton-mini" data-m="quita">🗑️</button>
      </div>
      <label>Título<input data-c="titulo" autocomplete="off"></label>
      <label>Instrucciones / descripción<textarea data-c="texto" rows="4"></textarea></label>
      <div class="titulo-archivo">🖼️ Fotos y esquemas</div>
      <div class="guia-medios medios-fotos"></div>
      <label class="boton-mini">➕ Añadir fotos<input type="file" accept="image/*" multiple class="entrada-oculta" data-e="fotos"></label>
      <div class="titulo-archivo">🎬 Vídeos</div>
      <div class="medios-videos"></div>
      <label class="boton-mini">➕ Añadir vídeo<input type="file" accept="video/*" class="entrada-oculta" data-e="video"></label>
      <label>Componente de la máquina (opcional)<select data-c="elementoId"><option value="">— Ninguno —</option></select></label>
      <p class="nota estado-loc"></p>
      <label class="fila check"><input type="checkbox" data-c="flechas"> Mostrar flechas 3D hasta el componente</label>
      <label class="fila check"><input type="checkbox" data-c="icono"> Mostrar icono 3D sobre el componente</label>
      <div class="titulo-archivo">↪️ Puntos intermedios propios para este paso (opcional)</div>
      <p class="nota">Sin puntos aquí se usan los del componente. Cada punto en <b>cm</b> desde el centro del QR del ancla:
        X derecha (−izquierda), Y arriba (−abajo), Z hacia ti (−hacia la máquina).</p>
      <ol class="puntos"></ol>
      <div class="acciones-paso">
        <button type="button" class="boton-mini" data-m="punto">➕ Añadir punto</button>
        <button type="button" class="boton-mini" data-m="copiar-ruta">↪️ Copiar los puntos del componente</button>
      </div>
      <div class="titulo-archivo">📍 Posición final propia (opcional, cm)</div>
      <p class="nota">Para llevar a un punto concreto, o si el componente no está localizado respecto al ancla de la guía.
        Vacío = la posición guardada del componente; y si no la tiene, el <b>último punto intermedio</b>.</p>
      <div class="punto-fila destino-fila">
        <label class="eje">X<input inputmode="decimal" data-d="0"></label>
        <label class="eje">Y<input inputmode="decimal" data-d="1"></label>
        <label class="eje">Z<input inputmode="decimal" data-d="2"></label>
      </div>
      <label>⚠️ Advertencia de seguridad (si se rellena, hay que aceptarla para continuar)
        <textarea data-c="advertencia" rows="2"></textarea></label>
      <label>☑️ Comprobaciones (una por línea; hay que marcarlas todas para continuar)
        <textarea data-c="comprobaciones" rows="3"></textarea></label>
      <label class="fila check"><input type="checkbox" data-c="confirmar"> Pedir confirmación ("Marcar como completado") antes de avanzar</label>`;
    const q = (s) => d.querySelector(s);
    const resumen = () => { q('.resumen-paso').textContent = p.titulo || (el ? el.nombre : 'sin título'); };
    resumen();
    q('[data-c="titulo"]').value = p.titulo || '';
    q('[data-c="texto"]').value = p.texto || '';
    q('[data-c="advertencia"]').value = p.advertencia || '';
    q('[data-c="comprobaciones"]').value = (p.comprobaciones || []).join('\n');
    q('[data-c="flechas"]').checked = !!p.flechas;
    q('[data-c="icono"]').checked = !!p.icono;
    q('[data-c="confirmar"]').checked = !!p.confirmar;
    // Puntos intermedios: se editan como texto (cm) en p._puntos y se pasan a metros al guardar
    if (!p._puntos) p._puntos = (p.rutaPropia || []).map((pt) => pt.map(cm));
    const pintarPuntos = () => {
      const ol = q('.puntos');
      ol.innerHTML = '';
      p._puntos.forEach((pt, k) => {
        const li = document.createElement('li');
        li.className = 'punto-fila';
        li.innerHTML = '<label class="eje">X<input inputmode="decimal" data-k="0"></label><label class="eje">Y<input inputmode="decimal" data-k="1"></label><label class="eje">Z<input inputmode="decimal" data-k="2"></label>'
          + '<button type="button" class="boton-mini" data-p="sube">↑</button><button type="button" class="boton-mini" data-p="baja">↓</button><button type="button" class="boton-mini" data-p="quita">✕</button>';
        li.querySelectorAll('input').forEach((inp) => {
          inp.value = pt[+inp.dataset.k] ?? '';
          inp.addEventListener('input', () => { pt[+inp.dataset.k] = inp.value; });
        });
        li.addEventListener('click', (ev) => {
          const a = ev.target.dataset.p;
          if (a === 'sube' && k > 0) [p._puntos[k - 1], p._puntos[k]] = [p._puntos[k], p._puntos[k - 1]];
          else if (a === 'baja' && k < p._puntos.length - 1) [p._puntos[k + 1], p._puntos[k]] = [p._puntos[k], p._puntos[k + 1]];
          else if (a === 'quita') p._puntos.splice(k, 1);
          else return;
          pintarPuntos();
    if (!p._destino) p._destino = p.destinoPropio ? p.destinoPropio.map(cm) : ['', '', ''];
    d.querySelectorAll('[data-d]').forEach((inp) => {
      inp.value = p._destino[+inp.dataset.d] ?? '';
      inp.addEventListener('input', () => { p._destino[+inp.dataset.d] = inp.value; estadoLoc(); });
    });
        });
        ol.appendChild(li);
      });
    };
    pintarPuntos();
    const sel = q('[data-c="elementoId"]');
    for (const e of elementos) {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = `${e.nombre} · ${e.referencia} (${e.id})${locs.has(e.id) ? '' : ' — sin localizar'}`;
      sel.appendChild(o);
    }
    sel.value = p.elementoId || '';
    const estadoLoc = () => {
      const t = q('.estado-loc');
      if (!p.elementoId) { t.textContent = ''; return; }
      const conDestino = p._destino && p._destino.some((v) => String(v ?? '').trim() !== '');
      const conPuntos = p._puntos && p._puntos.some((pt) => pt.some((v) => String(v ?? '').trim() !== ''));
      t.textContent = !g.anclaId ? 'Elige el ancla de la guía para usar las coordenadas del componente.'
        : locs.has(p.elementoId) ? '✅ Tiene coordenadas respecto al ancla de la guía: se reutilizan.'
          : conDestino ? '📍 No está localizado: se usará la "Posición final propia" de este paso.'
            : conPuntos ? '📍 No está localizado: las flechas llegarán al último punto intermedio de este paso.'
              : '⚠️ No está localizado respecto al ancla de la guía: pon su "Posición final propia" abajo o configúrala en Localizaciones.';
      if (p.flechas === false) t.textContent += ' ⚠️ "Mostrar flechas 3D" está DESACTIVADO: márcalo para que se vea el camino.';
    };
    estadoLoc();
    d.addEventListener('input', (e) => {
      const c = e.target.dataset.c;
      if (!c) return;
      if (c === 'titulo' || c === 'texto' || c === 'advertencia') p[c] = e.target.value;
      if (c === 'comprobaciones') p.comprobaciones = e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (c === 'flechas' || c === 'icono' || c === 'confirmar') p[c] = e.target.checked;
      if (c === 'titulo') resumen();
    });
    sel.addEventListener('change', () => { p.elementoId = sel.value || null; estadoLoc(); });
    d.addEventListener('click', (e) => {
      const m = e.target.dataset.m;
      if (!m) return;
      const k = g.pasos.indexOf(p);
      if (m === 'sube' && k > 0) [g.pasos[k - 1], g.pasos[k]] = [g.pasos[k], g.pasos[k - 1]];
      else if (m === 'baja' && k < g.pasos.length - 1) [g.pasos[k + 1], g.pasos[k]] = [g.pasos[k], g.pasos[k + 1]];
      else if (m === 'dup') { const c = { ...JSON.parse(JSON.stringify(p)), id: pasoVacio().id, imagenes: [], videos: [] }; g.pasos.splice(k + 1, 0, c); }
      else if (m === 'quita') { if (!confirm(`¿Quitar el paso ${k + 1}?`)) return; g.pasos.splice(k, 1); }
      else if (m === 'punto') { p._puntos.push(['', '', '']); pintarPuntos(); return; }
      else if (m === 'copiar-ruta') {
        const l = locs.get(p.elementoId);
        if (!l) { alert('El componente no tiene localización respecto al ancla de la guía.'); return; }
        if (!(l.ruta || []).length) { alert('El componente no tiene puntos intermedios guardados.'); return; }
        p._puntos = l.ruta.map((pt) => pt.map(cm));
        pintarPuntos();
        return;
      } else return;
      pintarPasos();
    });
    // Fotos y vídeos
    const pintarMedios = async () => {
      const f = q('.medios-fotos');
      f.innerHTML = '';
      for (const fid of p.imagenes || []) {
        const b = document.createElement('div');
        b.className = 'guia-foto';
        b.innerHTML = '<img alt=""><button type="button" class="boton-mini quitar-medio">✕</button>';
        b.querySelector('img').src = await urlDe(fid);
        b.querySelector('button').addEventListener('click', () => { p.imagenes = p.imagenes.filter((x) => x !== fid); pintarMedios(); });
        f.appendChild(b);
      }
      const v = q('.medios-videos');
      v.innerHTML = '';
      for (const fid of p.videos || []) {
        const b = document.createElement('div');
        b.className = 'video-editor';
        b.innerHTML = '<video controls playsinline preload="metadata"></video><button type="button" class="boton-mini">✕ Quitar vídeo</button>';
        b.querySelector('video').src = await urlDe(fid);
        b.querySelector('button').addEventListener('click', () => { p.videos = p.videos.filter((x) => x !== fid); pintarMedios(); });
        v.appendChild(b);
      }
    };
    pintarMedios();
    d.addEventListener('change', async (e) => {
      // Casillas (Safari no siempre avisa con "input" en las casillas de verificación)
      if (e.target.type === 'checkbox' && e.target.dataset.c) { p[e.target.dataset.c] = e.target.checked; estadoLoc(); return; }
      const t = e.target.dataset.e;
      if (!t) return;
      const lista = [...e.target.files]; e.target.value = '';
      try {
        for (const f of lista) {
          const fid = await subir(f, t === 'fotos');
          if (t === 'fotos') (p.imagenes ||= []).push(fid); else (p.videos ||= []).push(fid);
        }
        pintarMedios();
      } catch (ex) { mensaje(ex.message); }
    });
    return d;
  }

  async function guardar(yProbar) {
    mensaje('');
    try {
      // Pasar los puntos intermedios escritos (cm) a metros
      for (const [i, p] of g.pasos.entries()) {
        if (!p._puntos) continue;
        const llenos = p._puntos.filter((pt) => pt.some((v) => String(v ?? '').trim() !== ''));
        p.rutaPropia = llenos.length ? llenos.map((pt, k) => {
          const v = pt.map(num);
          if (v.some((n) => !Number.isFinite(n))) throw new Error(`Paso ${i + 1}, punto ${k + 1}: rellena X, Y y Z con números (en cm).`);
          return v.map((n) => n / 100);
        }) : null;
      }
      for (const [i, p] of g.pasos.entries()) {
        if (!p._destino) continue;
        if (!p._destino.some((v) => String(v ?? '').trim() !== '')) { p.destinoPropio = null; continue; }
        const v = p._destino.map(num);
        if (v.some((n) => !Number.isFinite(n))) throw new Error(`Paso ${i + 1}: la posición final propia necesita X, Y y Z (en cm).`);
        p.destinoPropio = v.map((n) => n / 100);
      }
      const datos = { ...g, pasos: g.pasos.map(({ _puntos, _destino, elemento, sinLocalizacion, ...resto }) => resto) };
      const r = await guardarGuia(datos);
      g.id = r.id;
      guardado = true;
      archivosNuevos.clear();
      mensaje('', `✅ Guía guardada (${ESTADOS_GUIA[r.estado]}).`);
      alGuardar && alGuardar(r.id);
      if (yProbar) probar(r.id);
    } catch (ex) { mensaje(ex.message); }
  }

  return () => {
    activo = false;
    // Archivos subidos en esta edición que no llegaron a guardarse
    if (!guardado || archivosNuevos.size) borrarArchivos([...archivosNuevos]);
    urls.forEach((u) => u && URL.revokeObjectURL(u));
  };
}
