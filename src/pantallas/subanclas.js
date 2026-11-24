import { leerAjustes } from '../ajustes.js';
import { deG, describir, deSimple, puntosDeTramos, simplesDeTramos } from '../coordenadas.js';
import { borrarSubancla, guardarSubancla, listarSubanclasReutilizables, obtenerAncla } from '../maquinas.js';
import { CARAS_MAQUINA, ORIENTACIONES_QR, giroSubanclaValido, subanclasDe, textoQRSubancla } from '../subanclas.js';
import { guardarOCompartir } from '../ui/descargar.js';
import { pintarListaTramos } from '../ui/tramos.js';

function posicionPorTramos(lista) {
  const tramos = lista.filter((t) => String(t.cm).trim());
  if (!tramos.length) throw new Error('Añade al menos una distancia desde el QR principal.');
  const medidas = tramos.map((t) => {
    const cm = String(t.cm).trim();
    if (!/^\d+(?:[.,]\d+)?$/.test(cm) || !(Number(cm.replace(',', '.')) > 0)) {
      throw new Error('Escribe distancias positivas y elige el sentido en «Dirección».');
    }
    return deSimple(t);
  });
  return puntosDeTramos(medidas).at(-1);
}

export function montarSubanclas(cont, ancla, { colocar, calibrar, mostrarCara = true } = {}) {
  cont.innerHTML = `
    ${mostrarCara ? '<p class="nota cara-principal"></p>' : ''}
    <p class="nota">Mide desde el centro del QR principal hasta el centro de la nueva marca. Pégala plana, con la flecha hacia arriba si es vertical o hacia dentro de la máquina si es horizontal.</p>
    <div class="botones-archivo">
      <button class="boton-mini" type="button" data-s="nueva">Crear QR nuevo</button>
      <button class="boton-mini" type="button" data-s="reutilizar">Asignar un QR existente</button>
    </div>
    <label class="selector-reutilizar" hidden>QR de otra máquina <select></select></label>
    <p class="error-form" hidden></p>
    <form class="formulario" hidden></form>
    <ul class="lista"></ul>`;
  const formulario = cont.querySelector('form');
  const caraPrincipal = cont.querySelector('.cara-principal');
  const reutilizacion = cont.querySelector('.selector-reutilizar');
  const selector = reutilizacion.querySelector('select');
  const lista = cont.querySelector('ul');
  const error = cont.querySelector('.error-form');
  const avisar = (mensaje) => { error.textContent = mensaje; error.hidden = !mensaje; };

  async function pintar() {
    const actual = await obtenerAncla(ancla.id, ancla.maquinaId);
    lista.replaceChildren();
    if (!actual) { avisar('El ancla ya no está disponible.'); return; }
    if (caraPrincipal) {
      caraPrincipal.textContent = Object.hasOwn(CARAS_MAQUINA, actual.cara)
        ? `QR principal en ${CARAS_MAQUINA[actual.cara].toLowerCase()}.`
        : 'Indica la cara del QR principal al editar el ancla. Por defecto se toma como frontal.';
    }
    const subanclas = subanclasDe(actual);
    if (!subanclas.length) lista.innerHTML = '<li class="nota">Esta ancla todavía no tiene subanclas.</li>';
    for (const s of subanclas) {
      const li = document.createElement('li');
      li.className = 'fila-elemento fila-maquina';
      li.innerHTML = `<span class="fila-textos"><strong class="fila-nombre"></strong><span class="fila-ref"></span></span>
        <span class="acciones-fila">
          ${colocar ? '<button class="boton-mini" type="button" data-s="colocar">Marcar punto con la cámara</button>' : ''}
          ${calibrar ? '<button class="boton-mini" type="button" data-s="calibrar">Calibrar con la cámara</button>' : ''}
          <button class="boton-mini" data-s="qr">🖨️ QR</button>
          <button class="boton-mini" data-s="editar">Editar</button>
          <button class="boton-mini" data-s="borrar">Quitar</button>
        </span>`;
      li.querySelector('.fila-nombre').textContent = s.nombre;
      li.querySelector('.fila-ref').textContent = `${CARAS_MAQUINA[s.cara]} · ${ORIENTACIONES_QR[s.orientacion ?? 'vertical']} · ${describir(deG(s.pos))} · QR de ${s.ladoCm} cm${giroSubanclaValido(s.giroQR) ? ' · Calibrada con cámara' : ''}`;
      li.querySelector('[data-s="editar"]').onclick = () => { reutilizacion.hidden = true; editar(s); };
      for (const [accion, ejecutar] of [['colocar', colocar], ['calibrar', calibrar]]) {
        const boton = li.querySelector(`[data-s="${accion}"]`);
        if (!boton) continue;
        boton.onclick = async () => {
          boton.disabled = true;
          avisar('');
          try {
            if (await ejecutar(s.id, boton)) { formulario.hidden = true; await pintar(); }
          } catch (e) { avisar(e.message); }
          finally { boton.disabled = false; }
        };
      }
      li.querySelector('[data-s="qr"]').onclick = async () => {
        try {
          const { generarPdfQR } = await import('../qr-pdf.js');
          const pdf = generarPdfQR([{ id: s.id, nombre: s.nombre, referencia: `${ancla.nombre} · ${CARAS_MAQUINA[s.cara]}`,
            texto: textoQRSubancla(s.id), subancla: true, orientacion: s.orientacion }], s.ladoCm);
          await guardarOCompartir(pdf, `SUBANCLA-${s.id}.pdf`, 'application/pdf');
        } catch (e) { avisar(e.message); }
      };
      li.querySelector('[data-s="borrar"]').onclick = async () => {
        if (!confirm(`¿Quitar «${s.nombre}» de esta ancla?`)) return;
        try { await borrarSubancla(ancla.id, ancla.maquinaId, s.id); formulario.hidden = true; await pintar(); }
        catch (e) { avisar(e.message); }
      };
      lista.appendChild(li);
    }
  }

  function editar(s, reutilizar = false) {
    avisar('');
    formulario.hidden = false;
    const editando = s && !reutilizar;
    formulario.innerHTML = `
      ${reutilizar ? '<p class="nota">Guarda la cara y las medidas desde el QR principal de esta máquina. El código impreso es el mismo.</p>' : ''}
      <label>Nombre <input name="nombre" required maxlength="80" placeholder="Por ejemplo, esquina trasera"></label>
      <label>Cara de la máquina <select name="cara" required>
        <option value="">Elige una cara</option>
        ${Object.entries(CARAS_MAQUINA).map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('')}
      </select></label>
      <label>Colocación de la subancla <select name="orientacion">
        ${Object.entries(ORIENTACIONES_QR).map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('')}
      </select></label>
      <p class="nota">En horizontal, elige el lado desde el que la flecha apunta al interior de la máquina.</p>
      <p class="nota">Toma las direcciones mirando de frente al QR principal. Mide desde su centro y escribe las distancias en cm.</p>
      <ol class="tramos-subancla"></ol>
      <button class="boton-mini" type="button" data-s="tramo">Añadir tramo</button>
      <p class="nota posicion-subancla" aria-live="polite"></p>
      <label>Lado del QR (cm, zona negra) <input name="ladoCm" type="number" inputmode="decimal" min="2" max="16" step="any" required></label>
      <div class="botones-archivo"><button class="boton" type="submit">${reutilizar ? 'Asignar subancla' : 'Guardar subancla'}</button><button type="button" class="boton secundario" data-s="cancelar">Cancelar</button></div>`;
    const campos = formulario.elements;
    campos.nombre.value = s?.nombre || '';
    campos.cara.value = editando ? s.cara : '';
    campos.orientacion.value = s?.orientacion ?? 'vertical';
    campos.ladoCm.value = s?.ladoCm || leerAjustes().qrCm || 10;
    campos.ladoCm.readOnly = reutilizar;
    const tramos = editando ? simplesDeTramos([deG(s.pos)]) : [{ dir: 'adelante', cm: '' }];
    const listaTramos = formulario.querySelector('.tramos-subancla');
    const resumen = formulario.querySelector('.posicion-subancla');
    let conservarPosicion = !!editando;
    function actualizarPosicion() {
      conservarPosicion = false;
      try {
        resumen.textContent = `Posición desde el QR principal · ${describir(deG(posicionPorTramos(tramos)))}`;
      } catch {
        resumen.textContent = '';
      }
    }
    pintarListaTramos(listaTramos, tramos, actualizarPosicion);
    if (editando) resumen.textContent = `Posición desde el QR principal · ${describir(deG(s.pos))}`;
    formulario.querySelector('[data-s="tramo"]').onclick = () => {
      tramos.push({ dir: 'adelante', cm: '' });
      pintarListaTramos(listaTramos, tramos, actualizarPosicion);
      listaTramos.lastElementChild.querySelector('select').focus();
    };
    formulario.querySelector('[data-s="cancelar"]').onclick = () => { formulario.hidden = true; reutilizacion.hidden = true; avisar(''); };
    formulario.onsubmit = async (ev) => {
      ev.preventDefault();
      const boton = formulario.querySelector('[type="submit"]');
      boton.disabled = true;
      avisar('');
      try {
        await guardarSubancla(ancla.id, ancla.maquinaId, {
          id: editando ? s.id : undefined, reutilizarId: reutilizar ? s.id : undefined,
          nombre: campos.nombre.value, cara: campos.cara.value, ladoCm: campos.ladoCm.valueAsNumber,
          orientacion: campos.orientacion.value,
          pos: conservarPosicion ? s.pos : posicionPorTramos(tramos),
        });
        formulario.hidden = true;
        reutilizacion.hidden = true;
        await pintar();
      } catch (e) { avisar(e.message); }
      finally { boton.disabled = false; }
    };
    campos.nombre.focus();
  }

  cont.querySelector('[data-s="nueva"]').onclick = () => { reutilizacion.hidden = true; editar(null); };
  cont.querySelector('[data-s="reutilizar"]').onclick = async (evento) => {
    const boton = evento.currentTarget;
    boton.disabled = true;
    formulario.hidden = true;
    reutilizacion.hidden = true;
    avisar('');
    try {
      const disponibles = await listarSubanclasReutilizables(ancla.maquinaId);
      if (!boton.isConnected || !formulario.hidden) return;
      if (!disponibles.length) { avisar('No hay QR de otras máquinas disponibles para asignar aquí.'); return; }
      selector.replaceChildren(new Option('Elige un QR', ''));
      for (const s of disponibles) selector.add(new Option(`${s.nombre} · ${s.maquinaId} · ${s.id}`, s.id));
      selector.onchange = () => {
        const s = disponibles.find((s) => s.id === selector.value);
        if (s) editar(s, true);
        else formulario.hidden = true;
      };
      reutilizacion.hidden = false;
      selector.focus();
    } catch (e) { avisar(e.message); }
    finally { boton.disabled = false; }
  };
  pintar().catch((e) => avisar(e.message));
}
