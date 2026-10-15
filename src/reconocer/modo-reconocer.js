// Modo "Reconocer sin QR" del escáner: cada poco tiempo compara lo que hay dentro del recuadro
// con las huellas guardadas y muestra los elementos más parecidos para que el usuario elija.
import { listarHuellas, mapaElementos, obtenerArchivo } from '../db.js';
import { cargarReconocedor, huellaDe, comparar, ajustarGuia } from './huella.js';

const CADA_MS = 600;
const MINIMO = 0.5;       // por debajo: "no reconozco nada"
const PROBABLE = 0.72;    // a partir de aquí, y con ventaja sobre el 2º, se marca como "probable"
const VENTAJA = 0.04;

export function crearReconocimiento({ video, guia, panel, abrirDetalle, estaActivo }) {
  let encendido = false;
  let temporizador = 0;
  let huellas = null, elementos = null, embedder = null;
  const suavizado = new Map(); // elementoId -> parecido medio de las últimas comparaciones
  const fotos = new Map();     // elementoId -> blob: URL de la miniatura
  let ultimaLista = '';

  const mensaje = (texto) => { panel.innerHTML = ''; const p = document.createElement('p'); p.className = 'rec-msg'; p.textContent = texto; panel.appendChild(p); ultimaLista = ''; };

  async function preparar() {
    mensaje('Cargando el reconocimiento… (la primera vez necesita internet)');
    try {
      [huellas, elementos, embedder] = await Promise.all([listarHuellas(), mapaElementos(), cargarReconocedor()]);
    } catch (e) {
      mensaje('No se pudo cargar el reconocimiento: ' + (e.message || e) + '. Conéctate a internet y prueba otra vez.');
      return false;
    }
    huellas = huellas.filter((h) => elementos.has(h.elementoId));
    if (!huellas.length) {
      mensaje('Ningún elemento tiene huella todavía. Grábala desde el detalle de cada elemento: botón "🎯 Reconocer sin QR".');
      return false;
    }
    return true;
  }

  async function miniatura(id) {
    if (fotos.has(id)) return fotos.get(id);
    const el = elementos.get(id);
    const a = el ? await obtenerArchivo(el.miniaturaId || el.imagenId) : null;
    const u = a ? URL.createObjectURL(a.blob) : '';
    fotos.set(id, u);
    return u;
  }

  async function pintar(lista) {
    const clave = lista.map((r) => r.elementoId + Math.round(r.parecido * 100)).join('|');
    if (clave === ultimaLista) return;
    ultimaLista = clave;
    const mejor = lista[0];
    if (!mejor || mejor.parecido < MINIMO) { mensaje('No reconozco ningún elemento. Acércate y mételo en el recuadro.'); ultimaLista = clave; return; }
    const probable = mejor.parecido >= PROBABLE && (!lista[1] || mejor.parecido - lista[1].parecido >= VENTAJA);
    const frag = document.createDocumentFragment();
    const t = document.createElement('div');
    t.className = 'rec-titulo';
    t.textContent = probable ? '✅ Probablemente es:' : '🤔 Se parece a (toca el correcto):';
    frag.appendChild(t);
    for (const [i, r] of lista.filter((x) => x.parecido >= MINIMO).slice(0, 3).entries()) {
      const el = elementos.get(r.elementoId);
      const b = document.createElement('button');
      b.className = 'rec-candidato' + (i === 0 && probable ? ' destacado' : '');
      b.innerHTML = '<span class="mini"><img alt=""></span><span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span><span class="rec-pct"></span>';
      b.querySelector('.fila-nombre').textContent = el.nombre;
      b.querySelector('.fila-ref').textContent = `${el.referencia} · ${el.id}`;
      b.querySelector('.rec-pct').textContent = Math.round(r.parecido * 100) + ' %';
      const img = b.querySelector('img');
      miniatura(el.id).then((u) => { if (u) img.src = u; else img.remove(); });
      b.addEventListener('click', () => abrirDetalle(el.id));
      frag.appendChild(b);
    }
    panel.innerHTML = '';
    panel.appendChild(frag);
  }

  function paso() {
    if (!encendido || !estaActivo()) return;
    ajustarGuia(guia, video);
    if (video.readyState >= 2 && video.videoWidth && embedder && huellas && huellas.length) {
      try {
        const res = comparar(huellaDe(embedder, video, video.videoWidth, video.videoHeight), huellas);
        // Suavizar entre comparaciones para que la lista no salte
        for (const r of res) {
          const prev = suavizado.get(r.elementoId);
          r.parecido = prev === undefined ? r.parecido : prev * 0.5 + r.parecido * 0.5;
          suavizado.set(r.elementoId, r.parecido);
        }
        res.sort((a, b) => b.parecido - a.parecido);
        pintar(res);
      } catch (e) {
        console.warn('Reconocimiento:', e);
      }
    }
    temporizador = setTimeout(paso, CADA_MS);
  }

  return {
    /** Enciende o apaga. Devuelve si queda encendido. */
    alternar() {
      encendido = !encendido;
      panel.hidden = !encendido;
      guia.hidden = !encendido;
      clearTimeout(temporizador);
      if (encendido) {
        suavizado.clear();
        ajustarGuia(guia, video);
        preparar().then((ok) => { if (ok && encendido) { mensaje('Mete el elemento en el recuadro…'); paso(); } });
      }
      return encendido;
    },
    detener() {
      encendido = false;
      clearTimeout(temporizador);
      fotos.forEach((u) => u && URL.revokeObjectURL(u));
    },
  };
}
