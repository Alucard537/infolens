import { obtenerAncla } from '../maquinas.js';
import { leerAjustes } from '../ajustes.js';
import { enviarARKit, referenciasDelAncla, tieneARKitIntegrado } from '../ar/visor-nativo.js';
import { colocacionValida, importarBiblioteca3D, listarBiblioteca3D, MAX_MODELOS_GUIA } from '../modelos-guia.js';
import { deG, deSimple, describir, puntosDeTramos, simplesDeTramos } from '../coordenadas.js';
import { pintarListaTramos } from '../ui/tramos.js';

export function montarModelosGuia(cont, guia, { antesDeColocar, destinoPaso, nombrePaso }) {
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
  const tarjetas = new Map();
  const pendientes = new Map();
  function avisar(m = '') { error.textContent = m; error.hidden = !m; }
  const nombreModelo = (m) => biblioteca.find((a) => a.id === m.archivoId)?.nombre.replace(/\.usdz$/i, '') || 'Modelo 3D';
  function actualizar() { tarjetas.forEach(({ actualizar }) => actualizar()); }

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
    actualizar();
    controles();
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
  guia.modelos3d.forEach((m) => montarTarjeta(m));
  elegir.onclick = () => {
    if (elegir.disabled) return;
    const m = { id: crypto.randomUUID(), archivoId: selector.value, anclaId: null,
      pos: [0, 0, -0.5], rotacion: [0, 0, 0], escala: 1 };
    guia.modelos3d.push(m);
    montarTarjeta(m, true);
    controles();
  };

  async function colocar(m, boton) {
    if (pendiente || boton.disabled) return;
    boton.disabled = true;
    avisar();
    try {
      pendientes.get(m)?.();
      await antesDeColocar();
      const a = await obtenerAncla(guia.anclaId, guia.maquinaId);
      if (!activo || !boton.isConnected || pendiente) return;
      if (!a) throw new Error('Elige el QR principal de la guía.');
      const solicitud = crypto.randomUUID();
      const anclas = referenciasDelAncla(a, leerAjustes().qrCm || 10);
      const pos = m.pasoId ? destinoPaso(guia.pasos.find((p) => p.id === m.pasoId)) : m.pos;
      const modelo = { ...m, pos: pos || m.pos, anclaId: a.id, nombre: nombreModelo(m) };
      const pose = await new Promise((resolver, fallar) => {
        pendiente = { solicitud, resolver };
        try { enviarARKit({ accion: 'colocarModelo', solicitud, anclas, modelo }); }
        catch (e) { pendiente = null; fallar(e); }
      });
      if (!activo || !pose || a.id !== guia.anclaId || !guia.modelos3d.includes(m)) return;
      const nuevo = { ...m, ...pose, anclaId: a.id, pasoId: null, tramosPosicion: null };
      if (!colocacionValida(nuevo)) throw new Error('La colocación recibida no es válida.');
      Object.assign(m, nuevo);
      estado.textContent = 'Colocación aplicada. Guarda la guía para conservarla.';
      montarTarjeta(m, true);
    } catch (e) { if (activo) avisar(e.message); }
    finally { if (boton.isConnected) boton.disabled = !guia.anclaId; }
  }

  function montarTarjeta(m, abierta = false) {
    const d = document.createElement('details');
    d.dataset.modelo = m.id;
    d.className = 'bloque-archivo modelo-colocado';
    d.open = abierta;
    d.innerHTML = `
      <summary></summary>
      <p class="nota estado-colocacion"></p>
      ${tieneARKitIntegrado() ? '<button class="boton" type="button" data-m3="colocar">Colocar con la cámara</button>' : ''}
      <form class="medidas-modelo">
        <label>Posición del modelo<select name="origenPosicion">
          <option value="tramos">Por tramos desde el QR</option>
          <option value="paso">Usar la posición de un paso</option>
        </select></label>
        <div data-pos="tramos">
          <ol class="tramos-modelo"></ol>
          <button class="boton-mini" type="button" data-m3="tramo">Añadir tramo</button>
        </div>
        <div data-pos="paso" hidden><label>Paso de la guía<select name="paso"></select></label></div>
        <p class="nota destino-modelo" aria-live="polite"></p>
        <fieldset><legend>Rotación (grados)</legend>
          <label>Eje X<input type="number" name="rx" step="any" required></label>
          <label>Eje Y<input type="number" name="ry" step="any" required></label>
          <label>Eje Z<input type="number" name="rz" step="any" required></label>
        </fieldset>
        <label>Tamaño (%)<input type="number" name="escala" min="1" max="10000" step="any" required></label>
        <div class="botones-archivo">
          <button class="boton secundario" type="submit">Aplicar posición</button>
          <button class="boton secundario" type="button" data-m3="quitar">Quitar de la guía</button>
        </div>
      </form>`;
    const estadoColocacion = d.querySelector('.estado-colocacion');
    const destino = d.querySelector('.destino-modelo');
    const camara = d.querySelector('[data-m3="colocar"]');
    if (camara) camara.onclick = () => colocar(m, camara);
    const f = d.querySelector('form');
    const campos = f.elements;
    const tramos = (m.tramosPosicion ?? simplesDeTramos([deG(m.pos)])).map((t) => ({ ...t }));
    if (!tramos.length) tramos.push({ dir: 'adelante', cm: '0' });
    campos.origenPosicion.value = m.pasoId ? 'paso' : 'tramos';
    let pasoId = m.pasoId || '';
    [campos.rx.value, campos.ry.value, campos.rz.value] = m.rotacion;
    campos.escala.value = Number((m.escala * 100).toPrecision(15));
    const usaPaso = () => campos.origenPosicion.value === 'paso';
    const tramosLlenos = () => tramos.filter((t) => String(t.cm ?? '').trim() !== '');
    function posicionTramos() {
      const llenos = tramosLlenos();
      if (!llenos.length || llenos.some((t) => !/^\d+(?:[.,]\d+)?$/.test(String(t.cm).trim()))) return null;
      return puntosDeTramos(llenos.map(deSimple)).at(-1);
    }
    function pintarDestino() {
      d.querySelector('[data-pos="tramos"]').hidden = usaPaso();
      d.querySelector('[data-pos="paso"]').hidden = !usaPaso();
      const pos = usaPaso() ? destinoPaso(guia.pasos.find((p) => p.id === pasoId)) : posicionTramos();
      destino.textContent = pos?.every(Number.isFinite) && pos.every((n) => Math.abs(n) <= 100)
        ? `Destino desde el QR: ${describir(deG(pos))}.`
        : usaPaso() ? (pasoId ? 'La pieza quedará pendiente hasta que el paso tenga un destino.' : 'Elige un paso de esta guía.')
          : 'Indica la distancia de cada tramo en centímetros.';
    }
    function refrescar() {
      d.querySelector('summary').textContent = nombreModelo(m);
      estadoColocacion.textContent = !guia.anclaId ? 'Elige el QR principal de la guía.'
        : m.pasoId ? 'Vinculado al destino de un paso.'
          : m.anclaId === guia.anclaId ? 'Colocado respecto al QR principal.' : 'Pendiente de colocar en esta guía.';
      if (camara) camara.disabled = !guia.anclaId;
      campos.paso.replaceChildren(new Option('Elige un paso', ''), ...guia.pasos.map((p, i) => {
        const nombre = nombrePaso(p);
        return new Option(nombre ? `Paso ${i + 1} · ${nombre}` : `Paso ${i + 1}`, p.id);
      }));
      if (pasoId && !guia.pasos.some((p) => p.id === pasoId)) campos.paso.add(new Option('Paso eliminado', pasoId));
      campos.paso.value = pasoId;
      pintarDestino();
    }
    function aplicar() {
      if (!guia.anclaId) throw new Error('Elige el QR principal de la guía para colocar el modelo.');
      if (usaPaso() && !pasoId) throw new Error('Elige el paso donde quieres colocar el modelo.');
      const pos = usaPaso() ? m.pos : posicionTramos();
      const nuevo = { ...m, anclaId: guia.anclaId, pos, pasoId: usaPaso() ? pasoId : null,
        tramosPosicion: usaPaso() ? m.tramosPosicion : tramosLlenos().map((t) => ({ ...t })),
        escala: campos.escala.valueAsNumber / 100,
        rotacion: [campos.rx.valueAsNumber, campos.ry.valueAsNumber, campos.rz.valueAsNumber] };
      if (!colocacionValida(nuevo)) throw new Error('Revisa las distancias, la rotación y el tamaño del modelo.');
      Object.assign(m, nuevo);
      pendientes.delete(m);
      refrescar();
      avisar();
    }
    function registrarCambio() {
      pendientes.set(m, aplicar);
      pintarDestino();
    }
    campos.paso.addEventListener('change', () => { pasoId = campos.paso.value; registrarCambio(); });
    campos.origenPosicion.addEventListener('change', registrarCambio);
    for (const c of [campos.rx, campos.ry, campos.rz, campos.escala]) c.addEventListener('input', registrarCambio);
    const pintarTramos = () => pintarListaTramos(d.querySelector('.tramos-modelo'), tramos, registrarCambio);
    d.querySelector('[data-m3="tramo"]').onclick = () => {
      tramos.push({ dir: 'adelante', cm: '' });
      pintarTramos();
      d.querySelector('.tramos-modelo li:last-child input').focus();
    };
    f.onsubmit = (ev) => {
      ev.preventDefault();
      try {
        aplicar();
        estado.textContent = 'Posición aplicada. Guarda la guía para conservarla.';
      } catch (e) { avisar(e.message); }
    };
    d.querySelector('[data-m3="quitar"]').onclick = () => {
      guia.modelos3d = guia.modelos3d.filter((p) => p !== m);
      pendientes.delete(m);
      tarjetas.delete(m);
      d.remove();
      controles();
    };
    const tarjetaAnterior = tarjetas.get(m);
    if (tarjetaAnterior) tarjetaAnterior.d.replaceWith(d);
    else lista.append(d);
    tarjetas.set(m, { d, actualizar: refrescar });
    pintarTramos();
    refrescar();
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
  return { actualizar, aplicarPendientes() { pendientes.forEach((aplicar) => aplicar()); }, cerrar() {
    activo = false;
    window.removeEventListener('infolens:modelo-colocado', recibir);
    pendiente?.resolver(null);
    pendiente = null;
  } };
}
