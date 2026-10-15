// Pantalla de detalle de un elemento.
import { buscarElemento } from '../datos-prueba.js';
import { abrirImagen, abrirPdf } from '../ui/visor.js';

export function pantallaDetalle(app, id, { volver }) {
  const el = buscarElemento(id);
  if (!el) {
    app.innerHTML = `<div class="pagina"><button class="volver">‹ Volver</button>
      <h1>Elemento no registrado</h1><p class="ref"></p></div>`;
    app.querySelector('.ref').textContent = 'ID: ' + id;
    app.querySelector('.volver').addEventListener('click', volver);
    return;
  }

  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Volver</button>
      <h1 class="det-nombre"></h1>
      <p class="det-ref"></p>
      <p class="det-tipo"></p>
      <p class="det-desc"></p>
      <button class="det-imagen" aria-label="Ver imagen ampliada"><img alt=""></button>
      <button class="boton" data-accion="pdf">📄 Ver PDF</button>
      <div class="det-botones">
        <button class="boton secundario" disabled>✏️ Editar</button>
        <button class="boton secundario" disabled>🖨️ Imprimir QR</button>
      </div>
      <p class="nota">Editar llega en la Fase 3 e Imprimir QR en la Fase 5.</p>
    </div>`;
  const $ = (s) => app.querySelector(s);
  $('.det-nombre').textContent = el.nombre;
  $('.det-ref').textContent = 'Referencia: ' + el.referencia;
  $('.det-tipo').textContent = 'Tipo: ' + (el.tipo === 'COMPUESTO' ? 'Compuesto' : 'Sencillo');
  $('.det-desc').textContent = el.descripcion || '';
  $('.det-imagen img').src = el.imagenUrl;
  $('.det-imagen').addEventListener('click', () => abrirImagen(el.imagenUrl, el.nombre));
  $('[data-accion="pdf"]').addEventListener('click', () => abrirPdf(el.pdfUrl, el.nombre));
  $('.volver').addEventListener('click', volver);
}
