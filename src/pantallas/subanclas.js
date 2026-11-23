import { leerAjustes } from '../ajustes.js';
import { aG, deG, describir } from '../coordenadas.js';
import { borrarSubancla, guardarSubancla, obtenerAncla } from '../maquinas.js';
import { CARAS_SUBANCLA, subanclasDe, textoQRSubancla } from '../subanclas.js';
import { guardarOCompartir } from '../ui/descargar.js';

export function montarSubanclas(cont, ancla) {
  cont.innerHTML = `
    <p class="nota">Mide desde el centro del QR principal hasta el centro de la nueva marca. Pégala en una cara vertical y plana, con «ARRIBA» hacia el techo.</p>
    <button class="boton-mini" type="button" data-s="nueva">Añadir subancla</button>
    <p class="error-form" hidden></p>
    <form class="formulario" hidden></form>
    <ul class="lista"></ul>`;
  const formulario = cont.querySelector('form');
  const lista = cont.querySelector('ul');
  const error = cont.querySelector('.error-form');
  const avisar = (mensaje) => { error.textContent = mensaje; error.hidden = !mensaje; };

  async function pintar() {
    const actual = await obtenerAncla(ancla.id);
    lista.replaceChildren();
    if (!actual || actual.maquinaId !== ancla.maquinaId) { avisar('El ancla ya no está disponible.'); return; }
    const subanclas = subanclasDe(actual);
    if (!subanclas.length) lista.innerHTML = '<li class="nota">Esta ancla todavía no tiene subanclas.</li>';
    for (const s of subanclas) {
      const li = document.createElement('li');
      li.className = 'fila-elemento fila-maquina';
      li.innerHTML = `<span class="fila-textos"><strong class="fila-nombre"></strong><span class="fila-ref"></span></span>
        <span class="acciones-fila">
          <button class="boton-mini" data-s="qr">🖨️ QR</button>
          <button class="boton-mini" data-s="editar">Editar</button>
          <button class="boton-mini" data-s="borrar">Borrar</button>
        </span>`;
      li.querySelector('.fila-nombre').textContent = s.nombre;
      li.querySelector('.fila-ref').textContent = `${CARAS_SUBANCLA[s.cara]} · ${describir(deG(s.pos))} · QR de ${s.ladoCm} cm`;
      li.querySelector('[data-s="editar"]').onclick = () => editar(s);
      li.querySelector('[data-s="qr"]').onclick = async () => {
        try {
          const { generarPdfQR } = await import('../qr-pdf.js');
          const pdf = generarPdfQR([{ id: s.id, nombre: s.nombre, referencia: `${ancla.nombre} · ${CARAS_SUBANCLA[s.cara]}`,
            texto: textoQRSubancla(s.id), subancla: true }], s.ladoCm);
          guardarOCompartir(pdf, `SUBANCLA-${s.id}.pdf`, 'application/pdf');
        } catch (e) { avisar(e.message); }
      };
      li.querySelector('[data-s="borrar"]').onclick = async () => {
        if (!confirm(`¿Borrar la subancla ${s.nombre}?`)) return;
        try { await borrarSubancla(ancla.id, ancla.maquinaId, s.id); formulario.hidden = true; await pintar(); }
        catch (e) { avisar(e.message); }
      };
      lista.appendChild(li);
    }
  }

  function editar(s) {
    avisar('');
    formulario.hidden = false;
    formulario.innerHTML = `
      <label>Nombre <input name="nombre" required maxlength="80" placeholder="Por ejemplo, esquina trasera"></label>
      <label>Cara de la máquina <select name="cara" required>
        <option value="">Elige una cara</option>
        ${Object.entries(CARAS_SUBANCLA).map(([id, nombre]) => `<option value="${id}">${nombre}</option>`).join('')}
      </select></label>
      <p class="nota">Medidas en cm referidas al QR principal. Usa valores negativos para atrás, izquierda o abajo.</p>
      <div class="fila-xyz">
        <label>Adelante <input name="adelante" type="number" inputmode="decimal" step="any" required></label>
        <label>Derecha <input name="derecha" type="number" inputmode="decimal" step="any" required></label>
        <label>Arriba <input name="arriba" type="number" inputmode="decimal" step="any" required></label>
      </div>
      <label>Lado del QR (cm, zona negra) <input name="ladoCm" type="number" inputmode="decimal" min="2" max="16" step="any" required></label>
      <div class="botones-archivo"><button class="boton" type="submit">Guardar subancla</button><button type="button" class="boton secundario" data-s="cancelar">Cancelar</button></div>`;
    const campos = formulario.elements;
    const pos = deG(s?.pos || [0, 0, 0]);
    campos.nombre.value = s?.nombre || '';
    campos.cara.value = s?.cara || '';
    for (const [eje, valor] of Object.entries(pos)) campos[eje].value = valor;
    campos.ladoCm.value = s?.ladoCm || leerAjustes().qrCm || 10;
    formulario.querySelector('[data-s="cancelar"]').onclick = () => { formulario.hidden = true; avisar(''); };
    formulario.onsubmit = async (ev) => {
      ev.preventDefault();
      const boton = formulario.querySelector('[type="submit"]');
      boton.disabled = true;
      avisar('');
      try {
        await guardarSubancla(ancla.id, ancla.maquinaId, {
          id: s?.id, nombre: campos.nombre.value, cara: campos.cara.value, ladoCm: campos.ladoCm.valueAsNumber,
          pos: aG({ adelante: campos.adelante.valueAsNumber, derecha: campos.derecha.valueAsNumber, arriba: campos.arriba.valueAsNumber }),
        });
        formulario.hidden = true;
        await pintar();
      } catch (e) { avisar(e.message); }
      finally { boton.disabled = false; }
    };
    campos.nombre.focus();
  }

  cont.querySelector('[data-s="nueva"]').onclick = () => editar(null);
  pintar().catch((e) => avisar(e.message));
}
