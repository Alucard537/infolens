// Pantalla del escáner AR: cámara a pantalla completa + iconos 3D sobre los QR.
import * as THREE from 'three';
import { QR_PREFIX } from '../config.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';
import { mapaElementos, obtenerArchivo } from '../db.js';
import { cargarModeloAR } from '../ar/modelo-ar.js';
import { calcularPose } from '../ar/pose.js';
import { OneEuro } from '../ar/one-euro.js';
import { crearIcono, crearLuces } from '../ar/icono.js';
import { crearSensorVertical, pedirPermisoSensor, faltaPermiso } from '../ar/vertical.js';

const TIEMPO_OCULTAR_MS = 1000;   // si no se ve el QR durante 1 s, se oculta el icono
const MAX_LADO_CAPTURA = 1920;    // resolución máxima que se pasa al lector de QR
const DIAMETRO_ICONO = 0.7;       // tamaño de la "i" respecto al lado del QR
const SEPARACION_ICONO = 0.15;    // hueco entre el borde del QR y la "i" (respecto al lado del QR)
// Tamaño del modelo 3D en realidad aumentada: unas 2,5 veces el QR, entre 12 y 30 cm
const tamanoModelo = (lado) => Math.min(0.3, Math.max(0.12, lado * 2.5));

export function pantallaEscaner(app, { abrirDetalle, darDeAlta, volver }) {
  let ajustes = leerAjustes();
  // Todos los elementos en memoria para encontrarlos al instante al leer un QR
  let elementos = null;
  mapaElementos().then((m) => { elementos = m; }).catch(() => { elementos = new Map(); });
  app.innerHTML = `
    <div class="escaner">
      <video class="esc-video" playsinline muted autoplay></video>
      <canvas class="esc-3d"></canvas>
      <canvas class="esc-debug"></canvas>
      <div class="esc-etiquetas"></div>
      <div class="esc-barra">
        <button class="esc-btn" data-accion="volver" aria-label="Volver">‹</button>
        <div class="esc-estado">Iniciando cámara…</div>
        <button class="esc-btn" data-accion="nivel" aria-label="Activar sensor de inclinación" hidden>📐</button>
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
        <label>Posición del modelo 3D
          <select data-ajuste="posModelo">
            <option value="encima">Encima de la "i"</option>
            <option value="debajo">Debajo del QR</option>
          </select>
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
  panel.querySelector('[data-ajuste="posModelo"]').value = ajustes.posModelo === 'debajo' ? 'debajo' : 'encima';
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
    const elemento = elementos.get(id) || null;
    const raiz = new THREE.Group();
    raiz.matrixAutoUpdate = false;
    const flotar = new THREE.Group();
    const icono = crearIcono(!!elemento);
    flotar.add(icono);
    flotar.matrixAutoUpdate = false; // se coloca a mano: posición del QR + vertical del mundo
    flotar.visible = false;
    raiz.visible = false;
    escena.add(raiz);
    escena.add(flotar);
    icono.traverse((o) => { o.userData.id = id; });

    const etiqueta = document.createElement('div');
    etiqueta.className = 'etiqueta';
    etiqueta.hidden = true;
    etiqueta.innerHTML = `
      ${elemento && (elemento.miniaturaId || elemento.imagenId) ? '<button class="et-foto" aria-label="Ver detalle"><img alt=""></button>' : ''}
      <div class="et-textos"><div class="et-nombre"></div><div class="et-ref"></div><div class="et-debug"></div></div>
      ${elemento
        ? '<button class="et-mas" aria-label="Más información">+</button>'
        : '<button class="et-alta">➕ Dar de alta</button>'}`;
    etiqueta.querySelector('.et-nombre').textContent = elemento ? elemento.nombre : 'Elemento no registrado';
    etiqueta.querySelector('.et-ref').textContent = elemento ? elemento.referencia : `ID: ${id}`;
    etiqueta.querySelector('.et-mas')?.addEventListener('click', () => abrirDetalle(id));
    etiqueta.querySelector('.et-foto')?.addEventListener('click', () => abrirDetalle(id));
    etiqueta.querySelector('.et-alta')?.addEventListener('click', () => darDeAlta(id));
    capaEtiquetas.appendChild(etiqueta);

    const seguido = {
      id, elemento, raiz, flotar, icono, etiqueta, modelo: null,
      filtros: Array.from({ length: 8 }, () => new OneEuro()),
      visto: 0, visible: false, esquinas: null, distancia: 0,
      objetivoPos: new THREE.Vector3(), objetivoRot: new THREE.Quaternion(),
      pos: new THREE.Vector3(), rot: new THREE.Quaternion(),
    };

    // Foto del elemento en la tarjeta (la miniatura carga al instante; si no hay, la foto grande)
    const img = etiqueta.querySelector('.et-foto img');
    if (img) {
      obtenerArchivo(elemento.miniaturaId || elemento.imagenId).then((a) => {
        if (!a || !activo) return;
        const u = URL.createObjectURL(a.blob);
        urlsFotos.push(u);
        img.src = u;
      }).catch(() => {});
    }

    // Modelo 3D, si lo tiene: se carga en segundo plano y aparece en cuanto está listo
    if (elemento && elemento.modelo3dId) {
      obtenerArchivo(elemento.modelo3dId)
        .then((a) => (a ? cargarModeloAR(a.blob, tamanoModelo(ajustes.qrCm / 100)) : null))
        .then((m) => {
          if (!m || !activo) return;
          m.traverse((o) => { o.userData.id = id; });
          m.visible = seguido.visible;
          escena.add(m);
          seguido.modelo = m;
        })
        .catch((e) => console.warn('No se pudo cargar el modelo 3D de', id, e));
    }
    return seguido;
  }
  const urlsFotos = [];

  function procesarDeteccion(qrs, k, tiempo) {
    if (!elementos) return; // la base de datos aún no ha cargado (tarda milisegundos)
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
  const pIcono = new THREE.Vector3(), haciaCamara = new THREE.Vector3(), ejeX = new THREE.Vector3();
  const escalaIcono = new THREE.Vector3();

  // Sensor de inclinación (para que la "i" esté siempre de pie)
  const sensor = crearSensorVertical();
  const btnNivel = $('[data-accion="nivel"]');
  setTimeout(() => { if (activo && !sensor.activo && faltaPermiso()) btnNivel.hidden = false; }, 1200);

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
    const arriba = sensor.leer(dt);
    let hayAlguno = false;

    for (const s of seguidos.values()) {
      const reciente = ahora - s.visto < TIEMPO_OCULTAR_MS;
      if (!reciente) {
        if (s.visible) {
          s.visible = false; s.raiz.visible = false; s.flotar.visible = false; s.etiqueta.hidden = true;
          if (s.modelo) s.modelo.visible = false;
          s.filtros.forEach((f) => f.reset());
        }
        continue;
      }
      hayAlguno = true;
      if (!s.visible) {               // recién aparecido: colocar directamente, sin animación
        s.pos.copy(s.objetivoPos); s.rot.copy(s.objetivoRot);
        s.visible = true; s.raiz.visible = true; s.flotar.visible = true; s.etiqueta.hidden = false;
      } else {
        s.pos.lerp(s.objetivoPos, suav); s.rot.slerp(s.objetivoRot, suav);
      }
      s.raiz.matrix.compose(s.pos, s.rot, ESCALA1);
      s.raiz.matrixWorldNeedsUpdate = true;
      // La "i": SIEMPRE DE PIE (vertical del mundo, con el sensor) y mirando hacia la cámara.
      // Del QR solo se usa la posición; su inclinación no afecta a la "i".
      haciaCamara.copy(s.pos).negate();                               // la cámara está en el origen
      haciaCamara.addScaledVector(arriba, -haciaCamara.dot(arriba));  // solo giro horizontal
      if (haciaCamara.lengthSq() < 1e-8) haciaCamara.set(0, 0, 1).addScaledVector(arriba, -arriba.z);
      haciaCamara.normalize();
      ejeX.crossVectors(arriba, haciaCamara).normalize();
      const flota = 0.04 * Math.sin(ahora / 450);
      // La "i" SIEMPRE justo encima del QR
      pIcono.copy(s.pos).addScaledVector(arriba, lado * (0.5 + DIAMETRO_ICONO / 2 + SEPARACION_ICONO + flota));
      // El modelo 3D, si lo hay: encima de la "i" o debajo del QR (según el ajuste)
      if (s.modelo) colocarModelo(s, lado, arriba);
      s.flotar.matrix.makeBasis(ejeX, arriba, haciaCamara)
        .scale(escalaIcono.setScalar(lado * DIAMETRO_ICONO))
        .setPosition(pIcono);
      s.flotar.matrixWorldNeedsUpdate = true;
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
      if (debug) deb.textContent = `Distancia: ${(s.distancia * 100).toFixed(0)} cm · Sensor de inclinación: ${sensor.activo ? 'sí' : 'no'}`;
    }

    dibujarDebug(g);
    if (stream) {
      estado.hidden = hayAlguno;
      if (!hayAlguno && !estado.textContent.startsWith('Error')) estado.textContent = 'Apunta a un código QR';
    }
  }

  // Modelo 3D de pie (vertical del mundo), apoyado justo encima del QR.
  // Su giro horizontal sigue al QR (no a la cámara), para poder rodearlo y verlo por los lados.
  const frenteModelo = new THREE.Vector3(), lateralModelo = new THREE.Vector3(), baseModelo = new THREE.Vector3();
  const matrizGiro = new THREE.Matrix4();
  function colocarModelo(s, lado, arriba) {
    frenteModelo.set(0, 0, 1).applyQuaternion(s.rot);                 // hacia fuera del QR
    frenteModelo.addScaledVector(arriba, -frenteModelo.dot(arriba));
    if (frenteModelo.lengthSq() < 0.05) {                               // QR tumbado (en una mesa)
      frenteModelo.set(0, -1, 0).applyQuaternion(s.rot);                // usar el borde de abajo del QR
      frenteModelo.addScaledVector(arriba, -frenteModelo.dot(arriba));
    }
    if (frenteModelo.lengthSq() < 1e-8) frenteModelo.copy(haciaCamara);
    frenteModelo.normalize();
    lateralModelo.crossVectors(arriba, frenteModelo).normalize();

    // Cuánto sobresale el modelo hacia arriba/abajo desde su centro, tal como esté girado con el dedo
    // (así nunca se mete encima de la "i" ni del QR, aunque se gire)
    const { medio, pivote } = s.modelo.userData;
    matrizGiro.makeRotationFromEuler(pivote.rotation);
    const e = matrizGiro.elements; // fila "y" de la rotación: e[1], e[5], e[9]
    const semiAlto = Math.abs(e[1]) * medio.x + Math.abs(e[5]) * medio.y + Math.abs(e[9]) * medio.z;
    const hueco = lado * SEPARACION_ICONO;
    let centro;
    if (ajustes.posModelo === 'debajo') {
      centro = -(lado * 0.5 + hueco + semiAlto);                                 // debajo del QR
    } else {
      centro = lado * (0.5 + DIAMETRO_ICONO + SEPARACION_ICONO) + hueco + semiAlto; // encima de la "i"
    }
    // El origen del modelo está en su base sin girar (el centro queda medio.y más arriba)
    baseModelo.copy(s.pos).addScaledVector(arriba, centro - medio.y);
    s.modelo.matrix.makeBasis(lateralModelo, arriba, frenteModelo).setPosition(baseModelo);
    s.modelo.matrixWorldNeedsUpdate = true;
    s.modelo.visible = true;
  }

  // Rectángulo en pantalla que ocupan juntos el QR, la "i" y el modelo (para colocar la etiqueta fuera)
  const cajaModelo = new THREE.Box3();
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
    if (s.modelo && s.modelo.visible) {                                // caja del modelo 3D
      cajaModelo.setFromObject(s.modelo);
      const { min, max } = cajaModelo;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        if (!anadir(v.set(x, y, z))) return null;
      }
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
  // Tocar la "i" o el modelo abre el detalle. Arrastrar sobre el modelo lo gira:
  // en horizontal gira sobre sí mismo y en vertical se inclina. Doble toque en el modelo: posición inicial.
  function tocado(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camara);
    const objetivos = [...seguidos.values()].filter((s) => s.visible && s.elemento)
      .flatMap((s) => (s.modelo ? [s.icono, s.modelo] : [s.icono]));
    const t = raycaster.intersectObjects(objetivos, true)[0];
    if (!t) return null;
    const s = seguidos.get(t.object.userData.id);
    if (!s) return null;
    let o = t.object, esModelo = false;
    while (o) { if (o === s.modelo) { esModelo = true; break; } o = o.parent; }
    return { s, esModelo };
  }

  let arrastre = null;
  let toqueEnEspera = null; // para distinguir un toque de un doble toque en el modelo
  lienzo3d.addEventListener('pointerdown', (e) => {
    const t = tocado(e.clientX, e.clientY);
    if (!t) return;
    const piv = t.esModelo ? t.s.modelo.userData.pivote : null;
    arrastre = {
      ...t, piv, x0: e.clientX, y0: e.clientY, movido: false,
      giro0: piv ? piv.rotation.y : 0, inclinacion0: piv ? piv.rotation.x : 0,
    };
    lienzo3d.setPointerCapture(e.pointerId);
  });
  lienzo3d.addEventListener('pointermove', (e) => {
    if (!arrastre || !arrastre.piv) return;
    const dx = e.clientX - arrastre.x0, dy = e.clientY - arrastre.y0;
    if (!arrastre.movido && Math.hypot(dx, dy) > 8) arrastre.movido = true;
    if (!arrastre.movido) return;
    arrastre.piv.rotation.y = arrastre.giro0 + dx * 0.012;
    arrastre.piv.rotation.x = Math.max(-1.4, Math.min(1.4, arrastre.inclinacion0 + dy * 0.012));
  });
  lienzo3d.addEventListener('pointerup', () => {
    const a = arrastre;
    arrastre = null;
    if (!a || a.movido) return;
    if (!a.esModelo) { abrirDetalle(a.s.id); return; }
    if (toqueEnEspera && toqueEnEspera.id === a.s.id) {   // doble toque: volver a la posición inicial
      clearTimeout(toqueEnEspera.temporizador);
      toqueEnEspera = null;
      a.piv.rotation.set(0, 0, 0);
      return;
    }
    toqueEnEspera = {
      id: a.s.id,
      temporizador: setTimeout(() => { toqueEnEspera = null; if (activo) abrirDetalle(a.s.id); }, 320),
    };
  });
  lienzo3d.addEventListener('pointercancel', () => { arrastre = null; });

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
    if (accion === 'nivel') pedirPermisoSensor().then((r) => { btnNivel.hidden = r === 'granted'; });
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
    } else if (campo === 'posModelo') {
      ajustes = guardarAjustes({ posModelo: e.target.value });
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
    sensor.detener();
    detenerCamara();
    worker.terminate();
    window.removeEventListener('resize', ajustarTamano);
    renderer.dispose();
    urlsFotos.forEach((u) => URL.revokeObjectURL(u));
  };
}
