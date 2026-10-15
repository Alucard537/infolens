// Pantalla del escáner AR: cámara a pantalla completa + iconos 3D sobre los QR.
import * as THREE from 'three';
import { QR_PREFIX } from '../config.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { buscarElemento } from '../datos-prueba.js';
import { calcularPose } from '../ar/pose.js';
import { OneEuro } from '../ar/one-euro.js';
import { crearIcono, crearLuces } from '../ar/icono.js';

const TIEMPO_OCULTAR_MS = 1000;   // si no se ve el QR durante 1 s, se oculta el icono
const MAX_LADO_CAPTURA = 1920;    // resolución máxima que se pasa al lector de QR
const DIAMETRO_ICONO = 0.7;       // tamaño de la "i" respecto al lado del QR
const SEPARACION_ICONO = 0.15;    // hueco entre el borde del QR y la "i" (respecto al lado del QR)

export function pantallaEscaner(app, { abrirDetalle, volver }) {
  let ajustes = leerAjustes();
  app.innerHTML = `
    <div class="escaner">
      <video class="esc-video" playsinline muted autoplay></video>
      <canvas class="esc-3d"></canvas>
      <canvas class="esc-debug"></canvas>
      <div class="esc-etiquetas"></div>
      <div class="esc-barra">
        <button class="esc-btn" data-accion="volver" aria-label="Volver">‹</button>
        <div class="esc-estado">Iniciando cámara…</div>
        <button class="esc-btn" data-accion="linterna" aria-label="Linterna" hidden>🔦</button>
        <button class="esc-btn" data-accion="ajustes" aria-label="Ajustes">⚙</button>
      </div>
      <div class="esc-panel" hidden>
        <h3>Ajuste fino</h3>
        <label>Tamaño del QR impreso (cm, solo la zona negra)
          <input type="number" step="0.1" min="1" max="100" inputmode="decimal" data-ajuste="qrCm" value="${ajustes.qrCm}">
        </label>
        <label>Campo de visión de la cámara: <b data-valor="fov">${ajustes.fovGrados}°</b>
          <input type="range" min="40" max="100" step="0.5" data-ajuste="fovGrados" value="${ajustes.fovGrados}">
        </label>
        <label>Cámara
          <select data-ajuste="camaraId"><option value="">Automática</option></select>
        </label>
        <label class="fila"><input type="checkbox" data-ajuste="debug"> Mostrar esquinas y distancia</label>
        <p class="nota">Para afinar: pon el móvil a una distancia conocida del QR (por ejemplo 1 m) y mueve
          el campo de visión hasta que la distancia mostrada coincida.</p>
        <button class="boton" data-accion="cerrar-panel">Cerrar</button>
      </div>
    </div>`;

  const $ = (s) => app.querySelector(s);
  const video = $('.esc-video');
  const lienzo3d = $('.esc-3d');
  const lienzoDebug = $('.esc-debug');
  const capaEtiquetas = $('.esc-etiquetas');
  const estado = $('.esc-estado');
  const btnLinterna = $('[data-accion="linterna"]');
  const panel = $('.esc-panel');
  let debug = false;
  let activo = true;
  let stream = null;
  let linternaOn = false;

  // ---------- three.js ----------
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo3d, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera();
  crearLuces(escena);

  // Convierte coordenadas "de visión" (y abajo, z delante) a three.js (y arriba, z detrás)
  const D = new THREE.Matrix4().makeScale(1, -1, -1);

  // Relación entre píxeles del vídeo y píxeles de la pantalla (el vídeo se recorta para llenarla)
  function geometria() {
    const W = window.innerWidth, H = window.innerHeight;
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const s = Math.max(W / vw, H / vh);
    const f = (Math.max(vw, vh) / 2) / Math.tan((ajustes.fovGrados * Math.PI) / 360);
    return { W, H, s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2, f, cx: vw / 2, cy: vh / 2 };
  }

  // Proyección de three.js igual a la de la cámara real (para que el 3D encaje con el vídeo)
  function actualizarProyeccion(g) {
    const fx = g.f * g.s;
    const cx = g.ox + g.cx * g.s, cy = g.oy + g.cy * g.s;
    const n = 0.01, l = 100;
    camara.projectionMatrix.set(
      (2 * fx) / g.W, 0, 1 - (2 * cx) / g.W, 0,
      0, (2 * fx) / g.H, (2 * cy) / g.H - 1, 0,
      0, 0, -(l + n) / (l - n), (-2 * l * n) / (l - n),
      0, 0, -1, 0,
    );
    camara.projectionMatrixInverse.copy(camara.projectionMatrix).invert();
  }

  function ajustarTamano() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    lienzoDebug.width = window.innerWidth;
    lienzoDebug.height = window.innerHeight;
  }
  ajustarTamano();
  window.addEventListener('resize', ajustarTamano);

  // ---------- seguimiento de cada QR ----------
  const seguidos = new Map(); // id del elemento -> datos de seguimiento

  function crearSeguido(id) {
    const elemento = buscarElemento(id);
    const raiz = new THREE.Group();
    raiz.matrixAutoUpdate = false;
    const flotar = new THREE.Group();
    const icono = crearIcono(!!elemento);
    flotar.add(icono);
    raiz.add(flotar);
    raiz.visible = false;
    escena.add(raiz);
    icono.traverse((o) => { o.userData.id = id; });

    const etiqueta = document.createElement('div');
    etiqueta.className = 'etiqueta';
    etiqueta.hidden = true;
    etiqueta.innerHTML = `
      <div class="et-textos"><div class="et-nombre"></div><div class="et-ref"></div><div class="et-debug"></div></div>
      ${elemento ? '<button class="et-mas" aria-label="Más información">+</button>' : ''}`;
    etiqueta.querySelector('.et-nombre').textContent = elemento ? elemento.nombre : 'Elemento no registrado';
    etiqueta.querySelector('.et-ref').textContent = elemento ? elemento.referencia : `ID: ${id}`;
    etiqueta.querySelector('.et-mas')?.addEventListener('click', () => abrirDetalle(id));
    capaEtiquetas.appendChild(etiqueta);

    return {
      id, elemento, raiz, flotar, icono, etiqueta,
      filtros: Array.from({ length: 8 }, () => new OneEuro()),
      visto: 0, visible: false, esquinas: null, distancia: 0,
      objetivoPos: new THREE.Vector3(), objetivoRot: new THREE.Quaternion(),
      pos: new THREE.Vector3(), rot: new THREE.Quaternion(),
    };
  }

  function procesarDeteccion(qrs, k, tiempo) {
    const g = geometria();
    const lado = ajustes.qrCm / 100;
    for (const qr of qrs) {
      if (!qr.texto.startsWith(QR_PREFIX)) continue; // QR que no son nuestros: se ignoran
      const id = qr.texto.slice(QR_PREFIX.length).trim();
      if (!id) continue;
      let s = seguidos.get(id);
      if (!s) { s = crearSeguido(id); seguidos.set(id, s); }

      // Esquinas en píxeles del vídeo, suavizadas
      const esq = qr.esquinas.map(([x, y], i) => [
        s.filtros[i * 2].filter(x / k, tiempo),
        s.filtros[i * 2 + 1].filter(y / k, tiempo),
      ]);
      const pose = calcularPose(esq, g.f, g.cx, g.cy, lado);
      if (!pose) continue;
      const [r1, r2, r3] = pose.R, t = pose.t;
      const M = new THREE.Matrix4().set(
        r1[0], r2[0], r3[0], t[0],
        r1[1], r2[1], r3[1], t[1],
        r1[2], r2[2], r3[2], t[2],
        0, 0, 0, 1,
      );
      M.premultiply(D).multiply(D);
      M.decompose(s.objetivoPos, s.objetivoRot, new THREE.Vector3());
      s.esquinas = esq;
      s.distancia = Math.hypot(t[0], t[1], t[2]);
      s.visto = performance.now();
    }
  }

  // ---------- lector de QR en segundo plano ----------
  const worker = new Worker(new URL('../ar/qr-worker.js', import.meta.url), { type: 'module' });
  const lienzoCaptura = document.createElement('canvas');
  const ctxCaptura = lienzoCaptura.getContext('2d', { willReadFrequently: true });
  let ocupado = false;
  let peticion = 0;
  const pendientes = new Map();

  worker.onmessage = (e) => {
    ocupado = false;
    const info = pendientes.get(e.data.id);
    pendientes.delete(e.data.id);
    if (!activo || !info) return;
    if (e.data.error) console.warn('Lector QR:', e.data.error);
    procesarDeteccion(e.data.qrs, info.k, info.tiempo);
  };
  worker.onerror = (e) => {
    ocupado = false;
    estado.hidden = false;
    estado.textContent = 'Error del lector de QR: ' + (e.message || 'desconocido');
  };

  function capturar() {
    if (ocupado || video.readyState < 2 || !video.videoWidth) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.min(1, MAX_LADO_CAPTURA / Math.max(vw, vh));
    const w = Math.round(vw * k), h = Math.round(vh * k);
    if (lienzoCaptura.width !== w) lienzoCaptura.width = w;
    if (lienzoCaptura.height !== h) lienzoCaptura.height = h;
    ctxCaptura.drawImage(video, 0, 0, w, h);
    const datos = ctxCaptura.getImageData(0, 0, w, h);
    const id = ++peticion;
    pendientes.set(id, { k, tiempo: performance.now() });
    ocupado = true;
    worker.postMessage({ id, ancho: w, alto: h, buffer: datos.data.buffer }, [datos.data.buffer]);
  }

  // ---------- bucle de dibujo ----------
  let ultimo = performance.now();
  let rafId = 0;
  const v = new THREE.Vector3();
  const ESCALA1 = new THREE.Vector3(1, 1, 1);

  function bucle() {
    if (!activo) return;
    rafId = requestAnimationFrame(bucle);
    const ahora = performance.now();
    const dt = Math.min((ahora - ultimo) / 1000, 0.1);
    ultimo = ahora;
    capturar();

    const g = geometria();
    actualizarProyeccion(g);
    const lado = ajustes.qrCm / 100;
    const suav = 1 - Math.exp(-dt * 18);
    let hayAlguno = false;

    for (const s of seguidos.values()) {
      const reciente = ahora - s.visto < TIEMPO_OCULTAR_MS;
      if (!reciente) {
        if (s.visible) {
          s.visible = false; s.raiz.visible = false; s.etiqueta.hidden = true;
          s.filtros.forEach((f) => f.reset());
        }
        continue;
      }
      hayAlguno = true;
      if (!s.visible) {               // recién aparecido: colocar directamente, sin animación
        s.pos.copy(s.objetivoPos); s.rot.copy(s.objetivoRot);
        s.visible = true; s.raiz.visible = true; s.etiqueta.hidden = false;
      } else {
        s.pos.lerp(s.objetivoPos, suav); s.rot.slerp(s.objetivoRot, suav);
      }
      s.raiz.matrix.compose(s.pos, s.rot, ESCALA1);
      s.raiz.matrixWorldNeedsUpdate = true;
      // La "i" va justo encima del QR (sin taparlo), flotando un poco hacia delante
      s.flotar.scale.setScalar(lado * DIAMETRO_ICONO);
      s.flotar.position.set(
        0,
        lado * (0.5 + DIAMETRO_ICONO / 2 + SEPARACION_ICONO),
        lado * (0.08 + 0.04 * Math.sin(ahora / 450)),
      );
      s.icono.rotation.y = 0.15 * Math.sin(ahora / 900);
    }
    renderer.render(escena, camara);

    // Etiquetas HTML: encima de la "i" o, si no cabe, debajo del QR. Nunca tapan la "i" ni el QR.
    const margenSuperior = $('.esc-barra').offsetHeight + 8;
    for (const s of seguidos.values()) {
      if (!s.visible) continue;
      const caja = cajaEnPantalla(s, lado, g);
      if (!caja) { s.etiqueta.hidden = true; continue; }
      s.etiqueta.hidden = false;
      const ancho = s.etiqueta.offsetWidth, alto = s.etiqueta.offsetHeight;
      const hueco = 12;
      let y = caja.arriba - hueco - alto;                       // encima de la "i"
      if (y < margenSuperior) y = caja.abajo + hueco;           // si no cabe: debajo del QR
      const x = Math.min(Math.max(caja.centroX - ancho / 2, 8), g.W - ancho - 8);
      s.etiqueta.style.transform = `translate(${x}px, ${y}px)`;
      const deb = s.etiqueta.querySelector('.et-debug');
      deb.hidden = !debug;
      if (debug) deb.textContent = `Distancia: ${(s.distancia * 100).toFixed(0)} cm`;
    }

    dibujarDebug(g);
    if (stream) {
      estado.hidden = hayAlguno;
      if (!hayAlguno && !estado.textContent.startsWith('Error')) estado.textContent = 'Apunta a un código QR';
    }
  }

  // Rectángulo en pantalla que ocupan juntos el QR y la "i" (para colocar la etiqueta fuera de él)
  function cajaEnPantalla(s, lado, g) {
    let arriba = Infinity, abajo = -Infinity, izq = Infinity, der = -Infinity;
    const anadir = (vec) => {
      vec.project(camara);
      if (vec.z > 1) return false;
      const x = ((vec.x + 1) / 2) * g.W, y = ((1 - vec.y) / 2) * g.H;
      arriba = Math.min(arriba, y); abajo = Math.max(abajo, y);
      izq = Math.min(izq, x); der = Math.max(der, x);
      return true;
    };
    const h = lado / 2;
    for (const [qx, qy] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {   // esquinas del QR
      if (!anadir(v.set(qx, qy, 0).applyMatrix4(s.raiz.matrixWorld))) return null;
    }
    for (let i = 0; i < 12; i++) {                                     // borde de la "i"
      const a = (i / 12) * Math.PI * 2;
      if (!anadir(v.set(0.55 * Math.cos(a), 0.55 * Math.sin(a), 0).applyMatrix4(s.flotar.matrixWorld))) return null;
    }
    return { arriba, abajo, centroX: (izq + der) / 2 };
  }

  function dibujarDebug(g) {
    const c = lienzoDebug.getContext('2d');
    c.clearRect(0, 0, lienzoDebug.width, lienzoDebug.height);
    if (!debug) return;
    const colores = ['#ff3b30', '#34c759', '#007aff', '#ffcc00']; // arriba-izq, arriba-der, abajo-der, abajo-izq
    for (const s of seguidos.values()) {
      if (!s.visible || !s.esquinas) continue;
      s.esquinas.forEach(([x, y], i) => {
        c.fillStyle = colores[i];
        c.beginPath();
        c.arc(g.ox + x * g.s, g.oy + y * g.s, 7, 0, Math.PI * 2);
        c.fill();
      });
    }
  }

  // Tocar el icono también abre el detalle
  const raycaster = new THREE.Raycaster();
  lienzo3d.addEventListener('click', (e) => {
    const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camara);
    const objetivos = [...seguidos.values()].filter((s) => s.visible && s.elemento).map((s) => s.icono);
    const toque = raycaster.intersectObjects(objetivos, true)[0];
    if (toque) abrirDetalle(toque.object.userData.id);
  });

  // ---------- cámara ----------
  const TAM = { width: { ideal: 1920 }, height: { ideal: 1080 } };

  async function abrir(videoConstraints) {
    return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  }

  async function iniciarCamara() {
    detenerCamara();
    const automatica = { facingMode: { ideal: 'environment' }, ...TAM };
    try {
      stream = await abrir(ajustes.camaraId ? { deviceId: { exact: ajustes.camaraId }, ...TAM } : automatica);
    } catch (e) {
      if (ajustes.camaraId) { // la cámara guardada ya no existe: probar la automática
        ajustes = guardarAjustes({ camaraId: '' });
        return iniciarCamara();
      }
      estado.textContent = 'Error: no se pudo abrir la cámara (' + e.message + ')';
      return;
    }
    if (!activo) { detenerCamara(); return; }

    // En iPhone con varias cámaras, preferir la principal ("Cámara trasera"),
    // porque la "triple"/"dual" cambia sola de lente y estropea el cálculo 3D.
    const dispositivos = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    rellenarSelectorCamaras(dispositivos);
    if (!ajustes.camaraId) {
      const principal = dispositivos.find((d) => /^(back camera|cámara trasera|cámara posterior)$/i.test(d.label.trim()));
      const actual = stream.getVideoTracks()[0].getSettings().deviceId;
      if (principal && principal.deviceId !== actual) {
        detenerCamara();
        try {
          stream = await abrir({ deviceId: { exact: principal.deviceId }, ...TAM });
        } catch {
          stream = await abrir(automatica);
        }
        if (!activo) { detenerCamara(); return; }
      }
    }

    video.srcObject = stream;
    try { await video.play(); } catch {}
    estado.textContent = 'Apunta a un código QR';

    const pista = stream.getVideoTracks()[0];
    const capacidades = pista.getCapabilities ? pista.getCapabilities() : {};
    btnLinterna.hidden = !capacidades.torch;
    linternaOn = false;
    btnLinterna.classList.remove('activo');
  }

  function detenerCamara() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function rellenarSelectorCamaras(dispositivos) {
    const sel = $('[data-ajuste="camaraId"]');
    sel.innerHTML = '<option value="">Automática</option>';
    dispositivos.forEach((d, i) => {
      const op = document.createElement('option');
      op.value = d.deviceId;
      op.textContent = d.label || 'Cámara ' + (i + 1);
      sel.appendChild(op);
    });
    sel.value = ajustes.camaraId;
  }

  // ---------- botones ----------
  $('.esc-barra').addEventListener('click', async (e) => {
    const accion = e.target.closest('[data-accion]')?.dataset.accion;
    if (accion === 'volver') volver();
    if (accion === 'ajustes') panel.hidden = !panel.hidden;
    if (accion === 'linterna' && stream) {
      linternaOn = !linternaOn;
      try {
        await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: linternaOn }] });
      } catch { linternaOn = false; }
      btnLinterna.classList.toggle('activo', linternaOn);
    }
  });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-accion="cerrar-panel"]')) panel.hidden = true;
  });
  panel.addEventListener('input', (e) => {
    const campo = e.target.dataset.ajuste;
    if (campo === 'qrCm') {
      const n = parseFloat(String(e.target.value).replace(',', '.'));
      if (n > 0) ajustes = guardarAjustes({ qrCm: n });
    } else if (campo === 'fovGrados') {
      ajustes = guardarAjustes({ fovGrados: parseFloat(e.target.value) });
      panel.querySelector('[data-valor="fov"]').textContent = ajustes.fovGrados + '°';
    } else if (campo === 'debug') {
      debug = e.target.checked;
    }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.dataset.ajuste === 'camaraId') {
      ajustes = guardarAjustes({ camaraId: e.target.value });
      iniciarCamara();
    }
  });

  iniciarCamara();
  bucle();

  // Al salir de la pantalla: apagar cámara, lector y 3D
  return () => {
    activo = false;
    cancelAnimationFrame(rafId);
    detenerCamara();
    worker.terminate();
    window.removeEventListener('resize', ajustarTamano);
    renderer.dispose();
  };
}
