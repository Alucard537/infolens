// Editor de guías (administrador): datos de la guía y sus pasos.
// Cada paso puede combinar: texto, fotos, vídeos, un componente de la máquina (reutiliza sus
// coordenadas guardadas para el ancla de la guía), flechas 3D, icono 3D, advertencia de seguridad,
// comprobaciones y confirmación. Solo se pueden elegir anclas y componentes de la máquina de la guía.
import {
  obtenerGuia, guardarGuia, obtenerMaquina, listarAnclas, elementosDeMaquina, localizacionesDeAncla, guardarAncla, siguienteIdAncla,
  pasoVacio, ESTADOS_GUIA, TIPOS_GUIA, obtenerAncla, guardarConfiguracionAncla, guardarMedicionSubancla, archivosDeGuia,
} from '../maquinas.js';
import { guardarArchivo, borrarArchivos, obtenerArchivo } from '../db.js';
import { prepararFoto } from '../imagenes.js';
import { puntosDeTramos, tramosDePuntos, describir, deG, deSimple, simplesDeTramos } from '../coordenadas.js';
import { destinoDelPaso } from '../ar/guia-recorrido.js';
import { pintarListaTramos } from '../ui/tramos.js';
import { leerAjustes } from '../ajustes.js';
import { datosDelVisor, enviarARKit, referenciasDelAncla, tieneARKitIntegrado } from '../ar/visor-nativo.js';
import { CARAS_MAQUINA, ORIENTACIONES_QR, giroSubanclaValido, subanclasDe } from '../subanclas.js';
import { montarSubanclas } from './subanclas.js';
import { montarModelosGuia } from './modelos-guia.js';

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
  let escrituraAncla = null;
  let calibracionPendiente = null;
  let editorModelos;
  const archivosNuevos = new Set(); // subidos en esta edición (se borran si no se guarda)
  let guardando = false;
  const ampliacionesEnCarga = new Set();
  const urls = new Map();
  const abiertos = new Set();

  function recibirMedicion(evento) {
    const { solicitud, medicion } = evento.detail || {};
    if (!calibracionPendiente || calibracionPendiente.solicitud !== solicitud) return;
    const { resolver } = calibracionPendiente;
    calibracionPendiente = null;
    resolver(medicion);
  }
  window.addEventListener('infolens:calibracion', recibirMedicion);

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
    else if (archivo.size > 200 * MB) throw new Error('El archivo pesa más de 200 MB. Elige uno más pequeño.');
    const fid = await guardarArchivo(blob, nombre);
    archivosNuevos.add(fid);
    return fid;
  }

  function pintar(maquina) {
    const opcionesCara = `<option value="">Sin indicar (se toma como frontal)</option>
      ${Object.entries(CARAS_MAQUINA).map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('')}`;
    const opcionesOrientacion = `<option value="">Automática</option>
      ${Object.entries(ORIENTACIONES_QR).map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('')}`;
    const instruccionesQR = 'En vertical, pon «▲ ADELANTE» hacia arriba. En horizontal, apunta la flecha hacia dentro de la máquina.';
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
        <div class="cara-ancla-guia" hidden>
          <label>Cara del QR principal <select name="caraAncla" aria-describedby="ayuda-cara-guia">${opcionesCara}</select></label>
          <p class="nota" id="ayuda-cara-guia">Toma izquierda y derecha mirando el frontal. Para un QR horizontal, elige el lado desde el que la flecha apunta al interior.</p>
          <label>Colocación del QR principal <select name="orientacionAncla" aria-describedby="ayuda-orientacion-guia">${opcionesOrientacion}</select></label>
          <p class="nota" id="ayuda-orientacion-guia">${instruccionesQR} Esta configuración se aplica a las guías que usan este QR en esta máquina.</p>
          <p class="nota estado-cara-guia" role="status" hidden></p>
        </div>
        <button type="button" class="boton-mini" data-a="crear-ancla">➕ Crear ancla nueva</button>
        <div class="bloque-archivo form-ancla-guia" hidden>
          <div class="titulo-archivo">⚓ Nueva ancla de ${maquina.nombre}</div>
          <label>Identificador (lo que llevará su QR)<input name="anclaNuevaId" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
          <label>Nombre<input name="anclaNuevaNombre" autocomplete="off" placeholder="Por ejemplo Frontal izquierdo"></label>
          <label>Cara del QR principal <select name="anclaNuevaCara">${opcionesCara}</select></label>
          <label>Colocación del QR principal <select name="anclaNuevaOrientacion">${opcionesOrientacion}</select></label>
          <p class="nota">${instruccionesQR}</p>
          <p class="error-form error-ancla" hidden></p>
          <div class="botones-archivo">
            <button type="button" class="boton" data-a="guardar-ancla">💾 Crear y usar en la guía</button>
            <button type="button" class="boton secundario" data-a="cancelar-ancla">Cancelar</button>
          </div>
          <p class="nota">Después imprime su QR en ⚓ Gestión de anclas y pégalo en la máquina.</p>
        </div>
        ${!anclas.length ? '<p class="nota aviso-sin-anclas">Esta máquina aún no tiene anclas: crea una con el botón de arriba.</p>' : ''}
        <details class="bloque-archivo colocacion-subanclas">
          <summary>Colocar subanclas</summary>
          <div class="opciones-colocacion"></div>
        </details>
        <details class="bloque-archivo modelos-guia"><summary>Modelos 3D de la guía</summary><div class="biblioteca-3d"></div></details>
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
    const cara = campo('caraAncla');
    const orientacion = campo('orientacionAncla');
    const estadoCara = $('.estado-cara-guia');
    function pintarConfiguracion() {
      const ancla = anclas.find((a) => a.id === g.anclaId);
      $('.cara-ancla-guia').hidden = !ancla;
      cara.value = Object.hasOwn(CARAS_MAQUINA, ancla?.cara) ? ancla.cara : '';
      orientacion.value = Object.hasOwn(ORIENTACIONES_QR, ancla?.orientacion) ? ancla.orientacion : '';
      estadoCara.hidden = true;
    }
    async function guardarConfiguracion(campo, valor, confirmacion) {
      const ancla = anclas.find((a) => a.id === g.anclaId);
      if (!ancla || escrituraAncla) return;
      cara.disabled = orientacion.disabled = true;
      estadoCara.textContent = 'Guardando la configuración del QR…';
      estadoCara.hidden = false;
      escrituraAncla = guardarConfiguracionAncla(ancla.id, g.maquinaId, { [campo]: valor });
      try {
        await escrituraAncla;
        ancla[campo] = valor || null;
        if (activo && g.anclaId === ancla.id) {
          pintarConfiguracion();
          estadoCara.textContent = confirmacion;
          estadoCara.hidden = false;
        }
      } catch (error) {
        if (activo && g.anclaId === ancla.id) {
          pintarConfiguracion();
          estadoCara.textContent = error.message;
          estadoCara.hidden = false;
        }
      } finally {
        escrituraAncla = null;
        cara.disabled = orientacion.disabled = false;
      }
    }
    cara.addEventListener('change', () => guardarConfiguracion('cara', cara.value, 'Cara del QR guardada.'));
    orientacion.addEventListener('change', () => guardarConfiguracion('orientacion', orientacion.value, 'Colocación del QR guardada.'));
    pintarConfiguracion();
    campo('estado').value = g.estado;
    campo('nombre').addEventListener('input', (e) => { g.nombre = e.target.value; });
    campo('descripcion').addEventListener('input', (e) => { g.descripcion = e.target.value; });
    app.querySelectorAll('[name="tipo"]').forEach((r) => r.addEventListener('change', () => { g.tipo = r.value; }));
    campo('estado').addEventListener('change', (e) => { g.estado = e.target.value; });
    const modelos = $('.modelos-guia');
    modelos.addEventListener('toggle', () => {
      if (modelos.open && !editorModelos) editorModelos = montarModelosGuia($('.biblioteca-3d'), g, {
        antesDeColocar: () => escrituraAncla,
        destinoPaso: posicionPasoEditado,
        nombrePaso: (p) => (p.titulo || '').trim() || elementos.find((e) => e.id === p.elementoId)?.nombre,
      });
    });
    campo('ancla').addEventListener('change', async (e) => {
      g.anclaId = e.target.value || null;
      pintarConfiguracion();
      pintarColocacion();
      editorModelos?.actualizar();
      await cargarLocs();
      pintarPasos();
    });
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
        const a = await guardarAncla({ id: campo('anclaNuevaId').value, maquinaId: g.maquinaId,
          nombre: campo('anclaNuevaNombre').value, cara: campo('anclaNuevaCara').value,
          orientacion: campo('anclaNuevaOrientacion').value }, true);
        anclas = await listarAnclas(g.maquinaId);
        const sel = campo('ancla');
        sel.innerHTML = '<option value="">— Elige un ancla —</option>';
        for (const x of anclas) { const o = document.createElement('option'); o.value = x.id; o.textContent = `${x.nombre} (${x.id})`; sel.appendChild(o); }
        sel.value = a.id;
        g.anclaId = a.id;
        pintarConfiguracion();
        formAncla.hidden = true;
        $('.aviso-sin-anclas')?.remove();
        pintarColocacion();
        editorModelos?.actualizar();
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
    pintarColocacion();
    pintarPasos();
  }

  function pintarColocacion() {
    const cont = app.querySelector('.opciones-colocacion');
    const principal = anclas.find((a) => a.id === g.anclaId);
    if (!principal) {
      const aviso = document.createElement('p');
      aviso.className = 'nota';
      aviso.textContent = 'Elige el ancla principal de la guía.';
      cont.replaceChildren(aviso);
      return;
    }
    async function leerSubancla(id, boton) {
      await escrituraAncla;
      const a = await obtenerAncla(principal.id, g.maquinaId);
      if (!activo || !boton.isConnected || g.anclaId !== principal.id || calibracionPendiente) return null;
      const s = a && subanclasDe(a).find((item) => item.id === id);
      if (!s) throw new Error('La subancla ya no está disponible para esta guía.');
      return { a, s };
    }
    async function colocar(id, boton) {
      const actual = await leerSubancla(id, boton);
      if (!actual) return;
      const { a, s } = actual;
      const recorrido = datosDelVisor({
        anclaId: a.id, ladoCm: leerAjustes().qrCm || 10, puntos: [[0, 0, 0], s.pos],
        info: { nombre: s.nombre, referencia: CARAS_MAQUINA[s.cara], descripcion: describir(deG(s.pos)) },
        caraPrincipal: Object.hasOwn(CARAS_MAQUINA, a.cara) ? a.cara : undefined,
        orientacionPrincipal: a.orientacion,
        colocacion: { cara: s.cara, ladoCm: s.ladoCm, ...(s.orientacion ? { orientacion: s.orientacion } : {}),
          ...(giroSubanclaValido(s.giroQR) ? { giroQR: s.giroQR } : {}) }, flechas: false,
      });
      enviarARKit({ accion: 'prueba', recorrido });
    }
    async function calibrar(id, boton) {
      const actual = await leerSubancla(id, boton);
      if (!actual || calibracionPendiente) return false;
      const { a, s } = actual;
      const solicitud = crypto.randomUUID();
      const referencias = referenciasDelAncla(a, leerAjustes().qrCm || 10, [s]);
      const medicion = await new Promise((resolver, rechazar) => {
        calibracionPendiente = { solicitud, resolver };
        try { enviarARKit({ accion: 'calibrarSubancla', solicitud, anclas: referencias }); }
        catch (e) { calibracionPendiente = null; rechazar(e); }
      });
      if (!medicion || !activo || g.anclaId !== a.id || !boton.isConnected) return false;
      await guardarMedicionSubancla(a.id, a.maquinaId, s, medicion);
      return true;
    }
    montarSubanclas(cont, principal, { ...(tieneARKitIntegrado() ? { colocar, calibrar } : {}), mostrarCara: false });
  }

  function mensaje(err, ok) {
    const e = app.querySelector('.editor-guia > .error-form'), o = app.querySelector('.editor-guia > .ok-form');
    e.hidden = !err; e.textContent = err || '';
    o.hidden = !ok; o.textContent = ok || '';
    if (err) e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const tramosLlenos = (p) => p._tramos.filter((t) => String(t.cm ?? '').trim() !== '');
  const tramoValido = (t) => Object.values(t).every(Number.isFinite);

  function posicionPasoEditado(p) {
    if (!p) return null;
    if (!p._tramos) return destinoDelPaso(p, locs)?.pos;
    const tramos = tramosLlenos(p).map(deSimple);
    if (!tramos.every(tramoValido)) return null;
    return destinoDelPaso({
      ...p, rutaPropia: puntosDeTramos(tramos), destinoPropio: null,
    }, locs)?.pos;
  }

  function pintarPasos() {
    const cont = app.querySelector('.pasos');
    app.querySelector('.n-pasos').textContent = g.pasos.length;
    cont.innerHTML = '';
    g.pasos.forEach((p, i) => cont.appendChild(tarjetaPaso(p, i)));
    editorModelos?.actualizar();
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
      <div class="bloque-archivo">
        <div class="titulo-archivo">Información al llegar</div>
        <p class="nota">El usuario podrá abrir este PDF o vídeo cuando vea la marca del destino en cámara o llegue al final del recorrido.</p>
        <p class="nota nombre-ampliacion" aria-live="polite"></p>
        <div class="acciones-paso">
          <label class="boton-mini"><span class="seleccionar-ampliacion">Elegir PDF o vídeo</span><input type="file" accept=".pdf,application/pdf,video/*,.mp4,.m4v,.mov,.webm" class="entrada-oculta" data-ampliacion></label>
          <button type="button" class="boton-mini" data-quitar-ampliacion hidden>Quitar archivo</button>
        </div>
      </div>
      <label>Componente de la máquina (opcional)<select data-c="elementoId"><option value="">— Ninguno —</option></select></label>
      <p class="nota estado-loc"></p>
      <label class="fila check"><input type="checkbox" data-c="flechas"> Mostrar flechas 3D hasta el componente</label>
      <label class="fila check"><input type="checkbox" data-c="icono"> Mostrar icono 3D sobre el componente</label>
      <div class="titulo-archivo">🧭 Recorrido por tramos desde el QR del ancla</div>
      <p class="nota">Cada tramo es UNA dirección y una distancia en <b>cm</b>, desde donde terminó el anterior (el primero sale
        del QR del ancla). Ejemplo: <b>30 Adelante</b>, <b>20 Derecha</b>, <b>40 Abajo</b> → las flechas siguen exactamente ese camino.
        <b>Adelante</b> = hacia dentro de la máquina. En un QR horizontal sigue la flecha impresa. En vertical, esa flecha señala el borde de arriba. Sin tramos se usa la localización guardada del componente.</p>
      <ol class="tramos"></ol>
      <div class="acciones-paso">
        <button type="button" class="boton-mini" data-m="tramo">➕ Añadir tramo</button>
        <button type="button" class="boton-mini" data-m="copiar-ruta">↪️ Copiar el recorrido del componente</button>
      </div>
      <p class="nota destino-tramos"></p>
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
    // Tramos: se editan como { dir, cm } en p._tramos y se pasan a puntos (metros) al guardar
    if (!p._tramos) {
      const puntos = p.rutaPropia?.length ? p.rutaPropia : Array.isArray(p.destinoPropio) ? [p.destinoPropio] : [];
      p._tramos = simplesDeTramos(tramosDePuntos(puntos));
    }
    const leerTramos = () => tramosLlenos(p).map(deSimple);
    const pintarDestino = () => {
      const tr = leerTramos();
      const ok = tr.every(tramoValido);
      const fin = tr.length && ok ? deG(puntosDeTramos(tr).at(-1)) : null;
      q('.destino-tramos').textContent = !tr.length ? ''
        : !ok ? '⚠️ Algún tramo tiene una distancia que no es un número.'
          : `📍 Destino final: ${describir(fin)} desde el QR del ancla.`;
    };
    const pintarTramos = () => {
      pintarListaTramos(q('.tramos'), p._tramos, () => { pintarDestino(); estadoLoc(); editorModelos?.actualizar(); });
      pintarDestino();
    };
    const sel = q('[data-c="elementoId"]');
    for (const e of elementos) {
      const o = document.createElement('option');
      o.value = e.id; o.textContent = `${e.nombre} · ${e.referencia} (${e.id})${locs.has(e.id) ? '' : ' — sin localizar'}`;
      sel.appendChild(o);
    }
    sel.value = p.elementoId || '';
    const estadoLoc = () => {
      const t = q('.estado-loc');
      if (!p.elementoId && p.elementoPendiente) {
        t.textContent = `Selecciona el elemento para este paso. Antes usaba «${p.elementoPendiente}».`;
        return;
      }
      if (!p.elementoId && !leerTramos().length) { t.textContent = p.flechas === false ? '⚠️ "Mostrar flechas 3D" está DESACTIVADO.' : ''; return; }
      const conTramos = leerTramos().length > 0;
      t.textContent = conTramos ? '🧭 Se usarán los tramos de este paso (abajo).'
        : !g.anclaId ? 'Elige el ancla de la guía para usar las coordenadas del componente.'
          : locs.has(p.elementoId) ? '✅ Tiene localización respecto al ancla de la guía: se usa (o escribe tramos abajo).'
            : '⚠️ No está localizado respecto al ancla de la guía: escribe abajo los tramos del recorrido.';
      if (p.flechas === false) t.textContent += ' ⚠️ "Mostrar flechas 3D" está DESACTIVADO: márcalo para que se vea el camino.';
    };
    pintarTramos();
    estadoLoc();
    d.addEventListener('input', (e) => {
      const c = e.target.dataset.c;
      if (!c) return;
      if (c === 'titulo' || c === 'texto' || c === 'advertencia') p[c] = e.target.value;
      if (c === 'comprobaciones') p.comprobaciones = e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (c === 'flechas' || c === 'icono' || c === 'confirmar') p[c] = e.target.checked;
      if (c === 'titulo') { resumen(); editorModelos?.actualizar(); }
    });
    sel.addEventListener('change', () => {
      p.elementoId = sel.value || null;
      if (p.elementoId) delete p.elementoPendiente;
      estadoLoc();
      editorModelos?.actualizar();
    });
    d.addEventListener('click', (e) => {
      const m = e.target.dataset.m;
      if (!m) return;
      const k = g.pasos.indexOf(p);
      if (m === 'sube' && k > 0) [g.pasos[k - 1], g.pasos[k]] = [g.pasos[k], g.pasos[k - 1]];
      else if (m === 'baja' && k < g.pasos.length - 1) [g.pasos[k + 1], g.pasos[k]] = [g.pasos[k], g.pasos[k + 1]];
      else if (m === 'dup') { const c = { ...JSON.parse(JSON.stringify(p)), id: pasoVacio().id, imagenes: [], videos: [], ampliacionId: null }; g.pasos.splice(k + 1, 0, c); }
      else if (m === 'quita') { if (!confirm(`¿Quitar el paso ${k + 1}?`)) return; g.pasos.splice(k, 1); }
      else if (m === 'tramo') { p._tramos.push({ dir: 'adelante', cm: '' }); pintarTramos(); return; }
      else if (m === 'copiar-ruta') {
        const l = locs.get(p.elementoId);
        if (!l) { alert('El componente no tiene localización respecto al ancla de la guía.'); return; }
        p._tramos = simplesDeTramos(tramosDePuntos([...(l.ruta || []), l.pos]));
        pintarTramos();
        estadoLoc();
        editorModelos?.actualizar();
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
    const entradaAmpliacion = q('[data-ampliacion]');
    const quitarAmpliacion = q('[data-quitar-ampliacion]');
    async function pintarAmpliacion() {
      const id = p.ampliacionId;
      const cargando = ampliacionesEnCarga.has(p.id);
      entradaAmpliacion.disabled = quitarAmpliacion.disabled = cargando;
      quitarAmpliacion.hidden = !id;
      q('.seleccionar-ampliacion').textContent = id ? 'Cambiar PDF o vídeo' : 'Elegir PDF o vídeo';
      const nombre = q('.nombre-ampliacion');
      nombre.textContent = cargando ? 'Cargando archivo…' : '';
      if (id && !cargando) {
        const archivo = await obtenerArchivo(id);
        if (p.ampliacionId === id && !ampliacionesEnCarga.has(p.id)) nombre.textContent = archivo?.nombre || 'Archivo no disponible';
      }
    }
    entradaAmpliacion.addEventListener('change', async () => {
      const archivo = entradaAmpliacion.files[0];
      entradaAmpliacion.value = '';
      if (!archivo || guardando || ampliacionesEnCarga.has(p.id)) return;
      ampliacionesEnCarga.add(p.id);
      pintarAmpliacion();
      try {
        const formatos = { pdf: 'application/pdf', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
        const extension = archivo.name.split('.').at(-1).toLowerCase();
        const mime = archivo.type === 'application/pdf' || archivo.type.startsWith('video/') ? archivo.type
          : Object.hasOwn(formatos, extension) ? formatos[extension] : null;
        if (!mime || !archivo.size) throw new Error('Elige un PDF o vídeo que contenga datos.');
        const fid = await subir(archivo.type === mime ? archivo : new File([archivo], archivo.name, { type: mime }), false);
        if (!activo || !g.pasos.includes(p)) { archivosNuevos.delete(fid); await borrarArchivos([fid]); return; }
        p.ampliacionId = fid;
      } catch (error) { if (activo) mensaje(error.message); }
      finally {
        ampliacionesEnCarga.delete(p.id);
        if (activo && d.isConnected) pintarAmpliacion().catch((error) => mensaje(error.message));
        else if (activo && g.pasos.includes(p)) pintarPasos();
      }
    });
    quitarAmpliacion.addEventListener('click', () => {
      if (guardando) return;
      p.ampliacionId = null;
      pintarAmpliacion().catch((error) => mensaje(error.message));
    });
    pintarAmpliacion().catch((error) => { if (activo) mensaje(error.message); });
    return d;
  }

  async function guardar(yProbar) {
    if (guardando) return;
    if (ampliacionesEnCarga.size) { mensaje('Espera a que termine de cargar el archivo del paso.'); return; }
    guardando = true;
    mensaje('');
    try {
      await escrituraAncla;
      // Pasar los tramos escritos (cm) a puntos en metros: el último es el destino
      for (const [i, p] of g.pasos.entries()) {
        if (!p._tramos) continue;
        const tr = tramosLlenos(p).map((t, k) => {
          const v = deSimple(t);
          if (!tramoValido(v)) throw new Error(`Paso ${i + 1}, tramo ${k + 1}: escribe la distancia en cm (un número).`);
          return v;
        });
        p.rutaPropia = tr.length ? puntosDeTramos(tr) : null;
        p.destinoPropio = null;
      }
      editorModelos?.aplicarPendientes();
      const datos = { ...g, pasos: g.pasos.map(({ _tramos, _puntos, _destino, elemento, sinLocalizacion, _destinoAR, diagnostico, sinFlechas, ...resto }) => resto) };
      const nuevos = [...archivosNuevos];
      const r = await guardarGuia(datos);
      g.id = r.id;
      const usados = new Set(archivosDeGuia(r));
      nuevos.forEach((fid) => archivosNuevos.delete(fid));
      borrarArchivos(nuevos.filter((fid) => !usados.has(fid))).catch((error) => console.warn('Archivos de la guía:', error));
      if (!activo) return;
      mensaje('', `✅ Guía guardada (${ESTADOS_GUIA[r.estado]}).`);
      alGuardar && alGuardar(r.id);
      if (yProbar) probar(r.id);
    } catch (ex) { if (activo) mensaje(ex.message); }
    finally {
      guardando = false;
      if (!activo) borrarArchivos([...archivosNuevos]).catch((error) => console.warn('Archivos de la guía:', error));
    }
  }

  return () => {
    activo = false;
    editorModelos?.cerrar();
    window.removeEventListener('infolens:calibracion', recibirMedicion);
    calibracionPendiente?.resolver(null);
    calibracionPendiente = null;
    // Archivos subidos en esta edición que no llegaron a guardarse
    if (!guardando) borrarArchivos([...archivosNuevos]).catch((error) => console.warn('Archivos de la guía:', error));
    urls.forEach((u) => u && URL.revokeObjectURL(u));
  };
}
