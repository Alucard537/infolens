// Lista de tramos editable: cada fila = Tramo N · dirección (Adelante, Atrás, Derecha, Izquierda,
// Arriba, Abajo) · cm · ↑ ↓ ✕. "lista" es un array de { dir, cm } que se modifica en el sitio.
import { DIRECCIONES } from '../coordenadas.js';

export function pintarListaTramos(ol, lista, alCambiar = () => {}) {
  ol.innerHTML = '';
  ol.classList.add('tramos');
  lista.forEach((t, k) => {
    const li = document.createElement('li');
    li.className = 'tramo-fila tramo-simple';
    li.innerHTML = '<span class="tramo-n"></span>'
      + `<label class="eje">Dirección<select data-t="dir">${DIRECCIONES.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>`
      + '<label class="eje">Distancia (cm)<input inputmode="decimal" data-t="cm" placeholder="0"></label>'
      + '<span class="tramo-botones"><button type="button" class="boton-mini" data-p="sube">↑</button><button type="button" class="boton-mini" data-p="baja">↓</button><button type="button" class="boton-mini" data-p="quita">✕</button></span>';
    li.querySelector('.tramo-n').textContent = `Tramo ${k + 1}`;
    const sel = li.querySelector('select'), inp = li.querySelector('input');
    sel.value = t.dir || 'adelante';
    inp.value = t.cm ?? '';
    sel.addEventListener('change', () => { t.dir = sel.value; alCambiar(); });
    inp.addEventListener('input', () => { t.cm = inp.value; alCambiar(); });
    li.addEventListener('click', (ev) => {
      const a = ev.target.dataset.p;
      if (a === 'sube' && k > 0) [lista[k - 1], lista[k]] = [lista[k], lista[k - 1]];
      else if (a === 'baja' && k < lista.length - 1) [lista[k + 1], lista[k]] = [lista[k], lista[k + 1]];
      else if (a === 'quita') lista.splice(k, 1);
      else return;
      ev.stopPropagation();
      pintarListaTramos(ol, lista, alCambiar);
      alCambiar();
    });
    ol.appendChild(li);
  });
}
