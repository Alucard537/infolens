import { esAdmin } from '../permisos.js';
import { asignarElemento, duplicarElemento, duplicarGuia, listarGuias, listarMaquinas, moverGuia } from '../maquinas.js';

export function elegirMaquinaDestino(pagina, registro, { guia = false, duplicar = false, alGuardar }) {
  mostrarTraslado(pagina, { registro, guia, duplicar, alGuardar });
}

export function elegirGuiaOrigen(pagina, maquinaDestino, { alGuardar }) {
  mostrarTraslado(pagina, { maquinaDestino, guia: true, duplicar: true, alGuardar });
}

function mostrarTraslado(pagina, { registro, maquinaDestino, guia, duplicar, alGuardar }) {
  if (!esAdmin() || pagina.querySelector('.traslado-maquina')) return;
  const desdeDestino = Boolean(maquinaDestino);
  const accion = duplicar ? 'Duplicar' : 'Mover';
  const titulo = desdeDestino ? 'Añadir guía existente' : `${accion} ${guia ? 'guía' : 'elemento'}`;
  const etiqueta = desdeDestino ? 'Guía de otra máquina' : 'Máquina de destino';
  const dialogo = document.createElement('dialog');
  dialogo.className = 'traslado-maquina';
  dialogo.setAttribute('aria-labelledby', 'traslado-titulo');
  dialogo.innerHTML = `
    <form>
      <h2 id="traslado-titulo">${titulo}</h2>
      <p class="traslado-nombre"></p>
      <label>${etiqueta}
        <select name="seleccion" required disabled><option value="">Cargando…</option></select>
      </label>
      ${desdeDestino ? `<label>Operación
        <select name="operacion">
          <option value="duplicar">Duplicar la guía</option>
          <option value="mover">Mover la guía</option>
        </select>
      </label>` : ''}
      <p class="nota traslado-aviso" aria-live="polite"></p>
      <p class="error-form" role="alert" hidden></p>
      <div class="det-botones">
        <button type="button" class="boton secundario" data-cancelar>Cancelar</button>
        <button type="submit" class="boton" disabled>${accion}</button>
      </div>
    </form>`;
  pagina.appendChild(dialogo);
  dialogo.querySelector('.traslado-nombre').textContent = desdeDestino ? `Máquina de destino · ${maquinaDestino.nombre}` : registro.nombre;
  const formulario = dialogo.querySelector('form');
  const seleccion = formulario.elements.seleccion;
  const operacion = formulario.elements.operacion;
  const aviso = dialogo.querySelector('.traslado-aviso');
  const error = dialogo.querySelector('.error-form');
  const cancelar = dialogo.querySelector('[data-cancelar]');
  const confirmar = dialogo.querySelector('[type="submit"]');
  const guardar = guia ? (duplicar ? duplicarGuia : moverGuia) : (duplicar ? duplicarElemento : asignarElemento);

  function actualizarAviso() {
    confirmar.disabled = !seleccion.value;
    if (!seleccion.value) {
      aviso.textContent = '';
    } else if (guia) {
      aviso.textContent = !desdeDestino && seleccion.value === registro.maquinaId
        ? 'La copia se guardará como borrador.'
        : 'Los elementos vinculados se copiarán a la máquina de destino. Si el QR está asignado a esa máquina, la guía conservará el ancla. La guía quedará en borrador para que revises las posiciones.';
    } else {
      aviso.textContent = duplicar
        ? 'La copia tendrá su propio QR. Podrás configurar su posición en la máquina elegida.'
        : 'El elemento conservará su QR. Se quitarán sus posiciones anteriores. Las guías publicadas que lo usaban pasarán a borrador.';
    }
    if (desdeDestino) {
      confirmar.textContent = operacion.value === 'duplicar' ? 'Duplicar' : 'Mover';
      if (seleccion.value && operacion.value === 'mover') aviso.textContent += ' La guía saldrá de la máquina de origen.';
    }
  }

  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.addEventListener('cancel', (ev) => { if (cancelar.disabled) ev.preventDefault(); });
  cancelar.addEventListener('click', () => dialogo.close());
  seleccion.addEventListener('change', actualizarAviso);
  operacion?.addEventListener('change', actualizarAviso);
  formulario.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!seleccion.value || confirmar.disabled || !esAdmin()) return;
    const valor = seleccion.value;
    seleccion.disabled = cancelar.disabled = confirmar.disabled = true;
    if (operacion) operacion.disabled = true;
    error.hidden = true;
    let resultado;
    try {
      if (desdeDestino) {
        const trasladar = operacion.value === 'duplicar' ? duplicarGuia : moverGuia;
        resultado = await trasladar(valor, maquinaDestino.id);
      } else resultado = await guardar(registro.id, valor);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      seleccion.disabled = cancelar.disabled = confirmar.disabled = false;
      if (operacion) operacion.disabled = false;
      return;
    }
    const visible = dialogo.open && dialogo.isConnected;
    dialogo.close();
    if (visible) alGuardar(resultado);
  });
  dialogo.showModal();

  listarMaquinas().then(async (maquinas) => {
    const opciones = desdeDestino
      ? await gruposDeGuias(maquinas.filter((m) => m.id !== maquinaDestino.id))
      : maquinas.filter((m) => duplicar || m.id !== registro.maquinaId).map((m) => new Option(m.nombre, m.id));
    if (!dialogo.open || !dialogo.isConnected) return;
    seleccion.replaceChildren(new Option(desdeDestino ? 'Selecciona una guía' : 'Selecciona una máquina', ''), ...opciones);
    if (!opciones.length) {
      aviso.textContent = desdeDestino ? 'No hay guías en otras máquinas.' : 'Crea una máquina de destino en Máquinas.';
      return;
    }
    seleccion.disabled = false;
    if (!desdeDestino && duplicar && opciones.some((o) => o.value === registro.maquinaId)) seleccion.value = registro.maquinaId;
    actualizarAviso();
  }).catch((e) => {
    error.textContent = e.message;
    error.hidden = false;
  });
}

async function gruposDeGuias(maquinas) {
  const listas = await Promise.all(maquinas.map((m) => listarGuias(m.id)));
  const grupos = [];
  for (const [i, lista] of listas.entries()) {
    if (!lista.length) continue;
    const grupo = document.createElement('optgroup');
    grupo.label = maquinas[i].nombre;
    grupo.append(...lista.map((g) => new Option(`${g.nombre} (${g.id})`, g.id)));
    grupos.push(grupo);
  }
  return grupos;
}
