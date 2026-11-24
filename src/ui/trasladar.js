import { esAdmin } from '../permisos.js';
import { asignarElemento, duplicarElemento, duplicarGuia, listarMaquinas, moverGuia } from '../maquinas.js';

export function elegirMaquinaDestino(pagina, registro, { guia = false, duplicar = false, alGuardar }) {
  if (!esAdmin() || pagina.querySelector('.traslado-maquina')) return;
  const accion = duplicar ? 'Duplicar' : 'Mover';
  const dialogo = document.createElement('dialog');
  dialogo.className = 'traslado-maquina';
  dialogo.setAttribute('aria-labelledby', 'traslado-titulo');
  dialogo.innerHTML = `
    <form>
      <h2 id="traslado-titulo">${accion} ${guia ? 'guía' : 'elemento'}</h2>
      <p class="traslado-nombre"></p>
      <label>Máquina de destino
        <select name="maquina" required disabled><option value="">Cargando máquinas…</option></select>
      </label>
      <p class="nota traslado-aviso" aria-live="polite"></p>
      <p class="error-form" role="alert" hidden></p>
      <div class="det-botones">
        <button type="button" class="boton secundario" data-cancelar>Cancelar</button>
        <button type="submit" class="boton" disabled>${accion}</button>
      </div>
    </form>`;
  pagina.appendChild(dialogo);
  dialogo.querySelector('.traslado-nombre').textContent = registro.nombre;
  const formulario = dialogo.querySelector('form');
  const destino = formulario.elements.maquina;
  const aviso = dialogo.querySelector('.traslado-aviso');
  const error = dialogo.querySelector('.error-form');
  const cancelar = dialogo.querySelector('[data-cancelar]');
  const confirmar = dialogo.querySelector('[type="submit"]');
  const guardar = guia ? (duplicar ? duplicarGuia : moverGuia) : (duplicar ? duplicarElemento : asignarElemento);

  function actualizarAviso() {
    confirmar.disabled = !destino.value;
    if (!destino.value) {
      aviso.textContent = '';
    } else if (guia) {
      aviso.textContent = destino.value === registro.maquinaId
        ? 'La copia se guardará como borrador.'
        : 'Los elementos vinculados se copiarán a la máquina de destino. La guía quedará en borrador para que asignes el ancla y revises las posiciones.';
    } else {
      aviso.textContent = duplicar
        ? 'La copia tendrá su propio QR. Podrás configurar su posición en la máquina elegida.'
        : 'El elemento conservará su QR. Se quitarán sus posiciones anteriores. Las guías publicadas que lo usaban pasarán a borrador.';
    }
  }

  dialogo.addEventListener('close', () => dialogo.remove());
  dialogo.addEventListener('cancel', (ev) => { if (cancelar.disabled) ev.preventDefault(); });
  cancelar.addEventListener('click', () => dialogo.close());
  destino.addEventListener('change', actualizarAviso);
  formulario.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!destino.value || confirmar.disabled || !esAdmin()) return;
    const maquinaId = destino.value;
    destino.disabled = cancelar.disabled = confirmar.disabled = true;
    error.hidden = true;
    let resultado;
    try {
      resultado = await guardar(registro.id, maquinaId);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      destino.disabled = cancelar.disabled = confirmar.disabled = false;
      return;
    }
    const visible = dialogo.open && dialogo.isConnected;
    dialogo.close();
    if (visible) alGuardar(resultado);
  });
  dialogo.showModal();

  listarMaquinas().then((maquinas) => {
    if (!dialogo.open || !dialogo.isConnected) return;
    const opciones = maquinas.filter((m) => duplicar || m.id !== registro.maquinaId);
    destino.replaceChildren(new Option('Selecciona una máquina', ''), ...opciones.map((m) => new Option(m.nombre, m.id)));
    if (!opciones.length) {
      aviso.textContent = 'Crea una máquina de destino en Máquinas.';
      return;
    }
    destino.disabled = false;
    if (duplicar && opciones.some((m) => m.id === registro.maquinaId)) destino.value = registro.maquinaId;
    actualizarAviso();
  }).catch((e) => {
    error.textContent = e.message;
    error.hidden = false;
  });
}
