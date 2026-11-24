import { obtenerAncla } from '../maquinas.js';
import { leerAjustes } from '../ajustes.js';
import { enviarARKit, referenciasDelAncla, tieneARKitIntegrado } from '../ar/visor-nativo.js';
import { colocacionValida, importarBiblioteca3D, listarBiblioteca3D, MAX_MODELOS_GUIA } from '../modelos-guia.js';

export function montarModelosGuia(cont, guia, antesDeColocar) {
  guia.modelos3d ??= [];
  let activo = true;
  let biblioteca = [];
  let importar = false;
  let pendiente = null;
  cont.innerHTML = `
    <label class="boton secundario">Importar modelos<input class="entrada-oculta" type="file" multiple accept=".usdz,.fbx,.zip"></label>
    <div class="botones-archivo">
      <select aria-label="Elegir de la biblioteca 3D"></select>
      <button type="button" class="boton" data-m3="anadir" disabled>Añadir a la guía</button>
    </div>
    <p class="nota estado-modelos" role="status"></p>
    <p class="error-form error-modelos" role="alert" hidden></p>
    <div class="modelos-colocados"></div>`;
  const $ = (s) => cont.querySelector(s);
  const selector = $('select');
  const estado = $('.estado-modelos');
  const error = $('.error-modelos');
  const elegir = $('[data-m3="anadir"]');
  const entrada = $('input[type=file]');
  const lista = $('.modelos-colocados');
  function avisar(m = '') { error.textContent = m; error.hidden = !m; }

  function controles() {
    elegir.disabled = importar || !selector.value || guia.modelos3d.length >= MAX_MODELOS_GUIA;
  }
  async function recargar() {
    biblioteca = await listarBiblioteca3D();
    if (!activo) return;
    const anterior = selector.value;
    biblioteca.sort((a, b) => a.nombre.localeCompare(b.nombre));
    selector.replaceChildren(new Option(biblioteca.length ? 'Elige un modelo 3D' : 'La biblioteca está vacía', ''),
      ...biblioteca.map((a) => new Option(a.nombre.replace(/\.usdz$/i, ''), a.id)));
    if (biblioteca.some((a) => a.id === anterior)) selector.value = anterior;
    pintar();
  }
  selector.onchange = controles;
  entrada.onchange = async () => {
    const archivos = [...entrada.files];
    entrada.value = '';
    if (importar || !archivos.length) return;
    importar = entrada.disabled = true;
    controles();
    avisar();
    try {
      const r = await importarBiblioteca3D(archivos, (m) => { if (activo) estado.textContent = m; });
      if (!activo) return;
      estado.textContent = `${r.cantidad} ${r.cantidad === 1 ? 'modelo importado' : 'modelos importados'}.`;
      avisar(r.errores.join('\n'));
      await recargar();
    } catch (e) { if (activo) avisar(e.message); }
    finally { importar = entrada.disabled = false; controles(); }
  };
  elegir.onclick = () => {
    if (elegir.disabled) return;
    guia.modelos3d.push({ id: crypto.randomUUID(), archivoId: selector.value, anclaId: null,
      pos: [0, 0, -0.5], rotacion: [0, 0, 0], escala: 1 });
    pintar();
    lista.lastElementChild.open = true;
  };

  async function colocar(m, boton) {
    if (pendiente || boton.disabled) return;
    boton.disabled = true;
    avisar();
    try {
      await antesDeColocar();
      const a = await obtenerAncla(guia.anclaId, guia.maquinaId);
      if (!activo || !boton.isConnected) return;
      if (!a) throw new Error('Elige el QR principal de la guía.');
      const solicitud = crypto.randomUUID();
      const anclas = referenciasDelAncla(a, leerAjustes().qrCm || 10);
      const modelo = { ...m, anclaId: a.id, nombre: biblioteca.find((f) => f.id === m.archivoId)?.nombre.replace(/\.usdz$/i, '') || 'Modelo 3D' };
      const pose = await new Promise((resolver, fallar) => {
        pendiente = { solicitud, resolver };
        try { enviarARKit({ accion: 'colocarModelo', solicitud, anclas, modelo }); }
        catch (e) { pendiente = null; fallar(e); }
      });
      if (!activo || !pose || a.id !== guia.anclaId || !guia.modelos3d.includes(m)) return;
      const nuevo = { ...m, ...pose, anclaId: a.id };
      if (!colocacionValida(nuevo)) throw new Error('La colocación recibida no es válida.');
      Object.assign(m, nuevo);
      estado.textContent = 'Colocación aplicada. Guarda la guía para conservarla.';
      pintar(m.id);
    } catch (e) { if (activo) avisar(e.message); }
    finally { if (boton.isConnected) boton.disabled = !guia.anclaId; }
  }

  function pintar(abrirId) {
    const abiertos = new Set([...lista.querySelectorAll('details[open]')].map((d) => d.dataset.modelo));
    lista.replaceChildren();
    controles();
    for (const m of guia.modelos3d) {
      const d = document.createElement('details');
      d.dataset.modelo = m.id;
      d.className = 'bloque-archivo modelo-colocado';
      d.open = abiertos.has(m.id) || abrirId === m.id;
      d.innerHTML = `
        <summary></summary>
        <p class="nota estado-colocacion"></p>
        ${tieneARKitIntegrado() ? '<button class="boton" type="button" data-m3="colocar">Colocar con la cámara</button>' : ''}
        <form class="medidas-modelo">
          <fieldset><legend>Posición desde el QR (cm)</legend>
            <label>Derecha<input type="number" name="x" step="any" required></label>
            <label>Arriba<input type="number" name="y" step="any" required></label>
            <label>Adelante<input type="number" name="z" step="any" required></label>
          </fieldset>
          <fieldset><legend>Rotación (grados)</legend>
            <label>Eje X<input type="number" name="rx" step="any" required></label>
            <label>Eje Y<input type="number" name="ry" step="any" required></label>
            <label>Eje Z<input type="number" name="rz" step="any" required></label>
          </fieldset>
          <label>Tamaño (%)<input type="number" name="escala" min="1" max="10000" step="any" required></label>
          <div class="botones-archivo">
            <button class="boton secundario" type="submit">Aplicar medidas</button>
            <button class="boton secundario" type="button" data-m3="quitar">Quitar de la guía</button>
          </div>
        </form>`;
      d.querySelector('summary').textContent = biblioteca.find((a) => a.id === m.archivoId)?.nombre.replace(/\.usdz$/i, '') || 'Modelo 3D sin archivo';
      d.querySelector('.estado-colocacion').textContent = m.anclaId && m.anclaId === guia.anclaId
        ? 'Colocado respecto al QR principal.' : 'Pendiente de colocar en esta guía.';
      const camara = d.querySelector('[data-m3="colocar"]');
      if (camara) { camara.disabled = !guia.anclaId; camara.onclick = () => colocar(m, camara); }
      const f = d.querySelector('form');
      const campos = f.elements;
      campos.x.value = Math.round(m.pos[0] * 1000) / 10;
      campos.y.value = Math.round(m.pos[1] * 1000) / 10;
      campos.z.value = Math.round(-m.pos[2] * 1000) / 10;
      [campos.rx.value, campos.ry.value, campos.rz.value] = m.rotacion.map((n) => Math.round(n * 10) / 10);
      campos.escala.value = Math.round(m.escala * 1000) / 10;
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const nuevo = { ...m, anclaId: guia.anclaId, escala: campos.escala.valueAsNumber / 100,
          pos: [campos.x.valueAsNumber / 100, campos.y.valueAsNumber / 100, -campos.z.valueAsNumber / 100],
          rotacion: [campos.rx.valueAsNumber, campos.ry.valueAsNumber, campos.rz.valueAsNumber] };
        if (!colocacionValida(nuevo)) { avisar('Selecciona un ancla y revisa las medidas del modelo.'); return; }
        avisar();
        Object.assign(m, nuevo);
        estado.textContent = 'Medidas aplicadas. Guarda la guía para conservarlas.';
        pintar(m.id);
      };
      d.querySelector('[data-m3="quitar"]').onclick = () => { guia.modelos3d = guia.modelos3d.filter((p) => p !== m); pintar(); };
      lista.append(d);
    }
  }

  function recibir({ detail }) {
    if (!pendiente || detail?.solicitud !== pendiente.solicitud) return;
    const { resolver } = pendiente;
    pendiente = null;
    if (detail.error) avisar(detail.error);
    resolver(detail.pose);
  }
  window.addEventListener('infolens:modelo-colocado', recibir);
  recargar().catch((e) => { if (activo) avisar(e.message); });
  return { actualizar: pintar, cerrar() {
    activo = false;
    window.removeEventListener('infolens:modelo-colocado', recibir);
    pendiente?.resolver(null);
    pendiente = null;
  } };
}
