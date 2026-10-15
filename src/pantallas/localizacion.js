// Localizaciones de un elemento (administrador): respecto a qué ancla de SU máquina está, dónde está
// (adelante / derecha / arriba, en cm desde el centro del QR del ancla), por qué TRAMOS va el recorrido
// y dónde va el icono final.
import { obtenerElemento } from '../db.js';
import {
  obtenerMaquina, listarAnclas, localizacionesDeElemento, guardarLocalizacion, borrarLocalizacion,
} from '../maquinas.js';
import { aG, deG, puntosDeTramos, tramosDePuntos, describir, numero } from '../coordenadas.js';

const CAMPOS = ['adelante', 'derecha', 'arriba'];
const TITULOS = { adelante: 'Adelante', derecha: 'Derecha', arriba: 'Arriba' };

function casillas(prefijo) {
  return `<div class="fila-xyz">${CAMPOS.map((k) => `<label>${TITULOS[k]}<input name="${prefijo}${k}" inputmode="decimal"></label>`).join('')}</div>`;
}

export function pantallaLocalizacion(app, elementoId, { volver, previsualizar, posicionarConCamara }) {
  let activo = true;

  const pintar = async () => {
    const el = await obtenerElemento(elementoId);
    if (!activo) return;
    if (!el) { app.innerHTML = '<div class="pagina"><p>El elemento no existe.</p></div>'; return; }
    const maquina = el.maquinaId ? await obtenerMaquina(el.maquinaId) : null;
    const [anclas, locs] = await Promise.all([listarAnclas(el.maquinaId), localizacionesDeElemento(elementoId)]);
    if (!activo) return;
    app.innerHTML = `
      <div class="pagina formulario">
        <button class="volver">‹ Volver</button>
        <h1>🧭 Localizaciones</h1>
        <p class="det-ref"></p>
        <p class="nota">Todo en <b>cm</b> desde el centro del QR del ancla:
          <b>Adelante</b> = hacia donde miras al leer el QR derecho (la flecha "▲ ADELANTE" impresa; negativo = atrás),
          <b>Derecha</b> (negativo = izquierda) y <b>Arriba</b> según la gravedad (negativo = abajo).
          Lo más fácil para la posición: botón <b>📍</b> en ANCLA, viendo a la vez el QR del ancla y el del componente.</p>
        <div class="avisos-loc"></div>
        <div class="lista-loc"></div>
        <button class="boton" data-a="nueva">➕ Nueva localización (otra ancla)</button>
        <button class="boton secundario" data-a="camara">📍 Medir con la cámara (ANCLA)</button>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('.volver').addEventListener('click', volver);
    $('.det-ref').textContent = `${el.nombre} · ${el.referencia} · ${el.id} — Máquina: ${maquina ? maquina.nombre : 'ninguna'}`;
    $('[data-a="camara"]').addEventListener('click', posicionarConCamara);
    if (!maquina) { $('.avisos-loc').innerHTML = '<p class="error-form">Este elemento no pertenece a ninguna máquina. Asígnalo a una máquina para poder localizarlo.</p>'; return; }
    if (!anclas.length) { $('.avisos-loc').innerHTML = '<p class="error-form">Su máquina todavía no tiene anclas. Créalas en ⚓ Gestión de anclas.</p>'; }

    const cont = $('.lista-loc');
    const bloque = (loc) => {
      const b = document.createElement('form');
      b.className = 'bloque-archivo bloque-loc';
      b.noValidate = true;
      b.innerHTML = `
        <label>Ancla de referencia (de la máquina ${maquina.id})
          <select name="ancla"></select>
        </label>
        <div class="titulo-archivo">📌 Dónde está el componente (cm desde el QR del ancla)</div>
        ${casillas('p')}
        <div class="titulo-archivo">🧭 Recorrido por tramos (opcional)</div>
        <p class="nota">Cada tramo es un movimiento desde donde terminó el anterior (el primero sale del QR). Ejemplo:
          <b>Adelante 130</b> y luego <b>Derecha 150</b>. Después del último tramo, las flechas van directas al componente.
          Sin tramos, van en línea recta desde el QR.</p>
        <ol class="tramos"></ol>
        <button type="button" class="boton-mini" data-a="tramo">➕ Añadir tramo</button>
        <p class="nota fin-tramos"></p>
        <div class="titulo-archivo">ℹ️ Posición del icono final (cm, opcional)</div>
        <p class="nota">Vacío = justo encima del componente.</p>
        ${casillas('i')}
        <p class="error-form" hidden></p><p class="ok-form" hidden></p>
        <div class="botones-archivo">
          <button class="boton" type="submit">💾 Guardar</button>
          ${loc ? '<button class="boton secundario" type="button" data-a="ver">🧪 Previsualizar</button>' : ''}
        </div>
        ${loc ? '<button class="quitar" type="button" data-a="borrar">Borrar esta localización</button>' : ''}`;
      const sel = b.elements.ancla;
      for (const a of anclas) {
        const o = document.createElement('option');
        o.value = a.id; o.textContent = `${a.nombre} (${a.id})`;
        sel.appendChild(o);
      }
      if (loc) { sel.value = loc.anclaId; sel.disabled = true; }
      const poner = (prefijo, p) => { const v = deG(p); CAMPOS.forEach((k) => { b.elements[prefijo + k].value = String(v[k]).replace('.', ','); }); };
      const leer = (prefijo) => Object.fromEntries(CAMPOS.map((k) => [k, numero(b.elements[prefijo + k].value)]));
      const vacio = (prefijo) => CAMPOS.every((k) => String(b.elements[prefijo + k].value).trim() === '');

      // Tramos
      const tramos = loc ? tramosDePuntos(loc.ruta || []).map((t) => ({ ...t })) : [];
      const ol = b.querySelector('.tramos');
      const pintarFin = () => {
        const ok = tramos.every((t) => CAMPOS.every((k) => Number.isFinite(numero(t[k]))));
        b.querySelector('.fin-tramos').textContent = !tramos.length ? '' : !ok ? '⚠️ Algún tramo no es un número.'
          : `Fin de los tramos: ${describir(deG(puntosDeTramos(tramos.map((t) => Object.fromEntries(CAMPOS.map((k) => [k, numero(t[k])])))).at(-1)))}.`;
      };
      const pintarTramos = () => {
        ol.innerHTML = '';
        tramos.forEach((t, k) => {
          const li = document.createElement('li');
          li.className = 'tramo-fila';
          li.innerHTML = `<span class="tramo-n">Tramo ${k + 1}</span>`
            + CAMPOS.map((c) => `<label class="eje">${TITULOS[c]}<input inputmode="decimal" data-k="${c}"></label>`).join('')
            + '<span class="tramo-botones"><button type="button" class="boton-mini" data-m="sube">↑</button><button type="button" class="boton-mini" data-m="baja">↓</button><button type="button" class="boton-mini" data-m="quita">✕</button></span>';
          li.querySelectorAll('input').forEach((inp) => {
            inp.value = t[inp.dataset.k] || t[inp.dataset.k] === 0 ? String(t[inp.dataset.k]).replace('.', ',') : '';
            if (inp.value === '0') inp.value = '';
            inp.addEventListener('input', () => { t[inp.dataset.k] = inp.value; pintarFin(); });
          });
          li.addEventListener('click', (ev) => {
            const m = ev.target.dataset.m;
            if (m === 'sube' && k > 0) [tramos[k - 1], tramos[k]] = [tramos[k], tramos[k - 1]];
            else if (m === 'baja' && k < tramos.length - 1) [tramos[k + 1], tramos[k]] = [tramos[k], tramos[k + 1]];
            else if (m === 'quita') tramos.splice(k, 1);
            else return;
            pintarTramos();
          });
          ol.appendChild(li);
        });
        pintarFin();
      };
      pintarTramos();
      b.querySelector('[data-a="tramo"]').addEventListener('click', () => { tramos.push({ adelante: '', derecha: '', arriba: '' }); pintarTramos(); });

      if (loc) {
        poner('p', loc.pos);
        if (loc.posIcono) poner('i', loc.posIcono);
      }
      b.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const er = b.querySelector('.error-form'), ok = b.querySelector('.ok-form');
        er.hidden = true; ok.hidden = true;
        try {
          if (vacio('p')) throw new Error('Escribe dónde está el componente (adelante, derecha, arriba en cm).');
          const pos = leer('p');
          if (!CAMPOS.every((k) => Number.isFinite(pos[k]))) throw new Error('La posición del componente tiene un valor que no es un número.');
          const tr = tramos.filter((t) => CAMPOS.some((k) => String(t[k] ?? '').trim() !== ''))
            .map((t, i) => {
              const v = Object.fromEntries(CAMPOS.map((k) => [k, numero(t[k])]));
              if (!CAMPOS.every((k) => Number.isFinite(v[k]))) throw new Error(`El tramo ${i + 1} tiene un valor que no es un número.`);
              return v;
            });
          let posIcono = null;
          if (!vacio('i')) {
            const ic = leer('i');
            if (!CAMPOS.every((k) => Number.isFinite(ic[k]))) throw new Error('La posición del icono tiene un valor que no es un número (o déjala vacía).');
            posIcono = aG(ic);
          }
          if (!sel.value) throw new Error('Elige un ancla.');
          await guardarLocalizacion({ maquinaId: el.maquinaId, anclaId: sel.value, elementoId, pos: aG(pos), ruta: puntosDeTramos(tr), posIcono });
          ok.hidden = false; ok.textContent = `✅ Guardada: el componente está ${describir(pos)} desde el QR.`;
          if (!loc) pintar();
        } catch (ex) { er.hidden = false; er.textContent = ex.message; }
      });
      b.querySelector('[data-a="ver"]')?.addEventListener('click', () => previsualizar(loc));
      b.querySelector('[data-a="borrar"]')?.addEventListener('click', async () => {
        if (!confirm('¿Borrar esta localización?')) return;
        await borrarLocalizacion(loc.id);
        pintar();
      });
      return b;
    };
    if (!locs.length && anclas.length) cont.appendChild(bloque(null));
    for (const l of locs) cont.appendChild(bloque(l));
    $('[data-a="nueva"]').addEventListener('click', () => {
      const libres = anclas.filter((a) => !locs.some((l) => l.anclaId === a.id));
      if (!libres.length) { alert('Ya tiene localización respecto a todas las anclas de su máquina.'); return; }
      const b = bloque(null);
      b.elements.ancla.value = libres[0].id;
      cont.appendChild(b);
      b.scrollIntoView({ behavior: 'smooth' });
    });
  };
  pintar();
  return () => { activo = false; };
}
