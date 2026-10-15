// Modo "Reconocer sin QR" del escáner.
// 1. BUSCANDO: cada poco tiempo compara lo que hay dentro del recuadro con las huellas guardadas.
//    Los resultados se suavizan mucho para que la lista no salte.
// 2. RECONOCIDO: cuando el mismo elemento sale claramente varias veces seguidas (o el usuario toca
//    un candidato), se "bloquea": deja de buscar y avisa al escáner para que ancle su modelo 3D.
import { listarHuellas, mapaElementos, obtenerArchivo } from '../db.js';
import { cargarReconocedor, huellaDe, comparar, ajustarGuia } from './huella.js';
import { bloqueLidar } from '../ar/quicklook.js';

const CADA_MS = 500;
const MINIMO = 0.45;      // por debajo: "no reconozco nada"
const PROBABLE = 0.68;    // a partir de aquí, y con ventaja sobre el 2º, cuenta como positivo
const VENTAJA = 0.025;
const SEGUIDAS = 2;       // positivos seguidos del mismo elemento para darlo por reconocido (~1 s)
const PESO_NUEVO = 0.5;   // suavizado: cuánto cuenta cada comparación nueva (menos = más estable)

export function crearReconocimiento({ video, guia, panel, abrirDetalle, estaActivo, alBloquear, alDesbloquear, alFijar }) {
  let encendido = false;
  let temporizador = 0;
  let huellas = null, elementos = null, embedder = null;
  const suavizado = new Map(); // elementoId -> parecido suavizado
  const fotos = new Map();     // elementoId -> blob: URL de la miniatura
  let ultimaLista = '';
  let racha = { id: null, n: 0 };
  let bloqueado = null;        // id del elemento reconocido
  let estadoFijar = () => {};  // para que el escáner avise si se ha fijado arrastrando

  const mensaje = (texto) => {
    panel.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'rec-msg'; p.textContent = texto;
    panel.appendChild(p);
    ultimaLista = '';
  };

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
      mensaje('Ningún elemento tiene huella todavía. El administrador la graba desde el detalle de cada elemento.');
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

  function tarjeta(el, pct, destacado) {
    const b = document.createElement('button');
    b.className = 'rec-candidato' + (destacado ? ' destacado' : '');
    b.innerHTML = '<span class="mini"><img alt=""></span><span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span><span class="rec-pct"></span>';
    b.querySelector('.fila-nombre').textContent = el.nombre;
    b.querySelector('.fila-ref').textContent = `${el.referencia} · ${el.id}`;
    b.querySelector('.rec-pct').textContent = pct == null ? '' : pct + ' %';
    const img = b.querySelector('img');
    miniatura(el.id).then((u) => { if (u) img.src = u; else img.remove(); });
    return b;
  }

  // Con el elemento ya reconocido: tarjeta fija y botones (no se mueve más hasta "Buscar otro")
  function pintarBloqueado() {
    const el = elementos.get(bloqueado);
    panel.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'rec-titulo';
    t.textContent = '✅ Reconocido:';
    panel.appendChild(t);
    const b = tarjeta(el, null, true);
    b.addEventListener('click', () => abrirDetalle(el.id));
    panel.appendChild(b);
    const fila = document.createElement('div');
    fila.className = 'botones-archivo';
    fila.innerHTML = '<button class="boton" data-r="ver">➕ Ver detalle</button><button class="boton secundario" data-r="otro">🔍 Buscar otro</button>';
    fila.querySelector('[data-r="ver"]').addEventListener('click', () => abrirDetalle(el.id));
    fila.querySelector('[data-r="otro"]').addEventListener('click', desbloquear);
    panel.appendChild(fila);
    // Anclar: fijar la "i" y el modelo donde están (y corregir arrastrando la "i")
    const fijar = document.createElement('button');
    fijar.className = 'boton boton-fijar';
    let fijo = false;
    const textoFijar = () => { fijar.textContent = fijo ? '🔓 Soltar (volver a seguir el elemento)' : '📌 Fijar aquí'; };
    textoFijar();
    fijar.addEventListener('click', () => { fijo = !fijo; textoFijar(); alFijar && alFijar(fijo); });
    panel.appendChild(fijar);
    const ayudaFijar = document.createElement('p');
    ayudaFijar.className = 'nota';
    ayudaFijar.textContent = 'Si no está bien colocado, arrastra la "i" con el dedo hasta su sitio (se queda fijado).';
    panel.appendChild(ayudaFijar);
    // Anclar con LiDAR (visor de Apple) o explicación de por qué no se puede
    panel.appendChild(bloqueLidar(el, { alPulsar: () => abrirDetalle(el.id) }));
    estadoFijar = (f) => { fijo = f; textoFijar(); };
    if (el.modelo3dId) {
      const n = document.createElement('p');
      n.className = 'nota';
      n.textContent = 'La "i" y el modelo siguen al elemento aunque te muevas. Arrastra el modelo para girarlo.';
      panel.appendChild(n);
    }
  }

  function bloquear(id) {
    if (!elementos.has(id)) return;
    bloqueado = id;
    clearTimeout(temporizador);
    guia.hidden = true;
    pintarBloqueado();
    alBloquear && alBloquear(id);
  }

  function desbloquear() {
    bloqueado = null;
    racha = { id: null, n: 0 };
    suavizado.clear();
    alDesbloquear && alDesbloquear();
    if (encendido) { guia.hidden = false; mensaje('Mete el elemento en el recuadro…'); paso(); }
  }

  function pintar(lista) {
    const visibles = lista.filter((x) => x.parecido >= MINIMO).slice(0, 3);
    // Porcentajes redondeados de 5 en 5: así no cambian a cada momento
    const clave = visibles.map((r) => r.elementoId + ':' + Math.round(r.parecido * 20) * 5).join('|');
    if (clave === ultimaLista) return;
    if (!visibles.length) { mensaje('No reconozco ningún elemento. Acércate y mételo en el recuadro.'); ultimaLista = clave; return; }
    ultimaLista = clave;
    const frag = document.createDocumentFragment();
    const t = document.createElement('div');
    t.className = 'rec-titulo';
    t.textContent = racha.n > 0 ? `Comprobando… (${racha.n}/${SEGUIDAS})` : '🤔 Se parece a (toca el correcto):';
    frag.appendChild(t);
    visibles.forEach((r, i) => {
      const el = elementos.get(r.elementoId);
      const b = tarjeta(el, Math.round(r.parecido * 20) * 5, i === 0 && racha.n > 0);
      b.addEventListener('click', () => bloquear(el.id)); // tocar un candidato = confirmarlo
      frag.appendChild(b);
    });
    panel.innerHTML = '';
    panel.appendChild(frag);
  }

  function paso() {
    if (!encendido || bloqueado || !estaActivo()) return;
    ajustarGuia(guia, video);
    if (video.readyState >= 2 && video.videoWidth && embedder && huellas && huellas.length) {
      try {
        const res = comparar(huellaDe(embedder, video, video.videoWidth, video.videoHeight), huellas);
        for (const r of res) {
          const prev = suavizado.get(r.elementoId);
          r.parecido = prev === undefined ? r.parecido : prev * (1 - PESO_NUEVO) + r.parecido * PESO_NUEVO;
          suavizado.set(r.elementoId, r.parecido);
        }
        res.sort((a, b) => b.parecido - a.parecido);
        const [p1, p2] = res;
        const positivo = p1 && p1.parecido >= PROBABLE && (!p2 || p1.parecido - p2.parecido >= VENTAJA);
        racha = positivo ? { id: p1.elementoId, n: racha.id === p1.elementoId ? racha.n + 1 : 1 } : { id: null, n: 0 };
        if (racha.n >= SEGUIDAS) { bloquear(racha.id); return; }
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
      if (bloqueado) { bloqueado = null; alDesbloquear && alDesbloquear(); }
      racha = { id: null, n: 0 };
      if (encendido) {
        suavizado.clear();
        ajustarGuia(guia, video);
        preparar().then((ok) => { if (ok && encendido) { mensaje('Mete el elemento en el recuadro…'); paso(); } });
      }
      return encendido;
    },
    get bloqueado() { return bloqueado; },
    marcarFijado(f) { estadoFijar(f); },
    detener() {
      encendido = false;
      clearTimeout(temporizador);
      fotos.forEach((u) => u && URL.revokeObjectURL(u));
    },
  };
}
