// Navegación con QR en el escáner.
//  - Al ver un QR que es "ancla" de otros componentes, aparece un menú con esos componentes.
//  - Al elegir uno: flechas 3D desde el QR (pasando por los puntos intermedios) hasta el componente,
//    y en el destino la "i" con su nombre (tocarla abre su ficha).
//  - Con el QR a la vista, todo se coloca con su posición exacta. Si deja de verse, se mantiene con el
//    giro del móvil (aproximado: no compensa si andas). Para seguirlo andando: "Recorrido con LiDAR".
//  - Administrador: "Posicionar" calcula solo la posición de un componente viendo a la vez su QR y el
//    QR ancla, y la guarda.
import * as THREE from 'three';
import { marcoQR, gravedadEnQR, puntosRecorrido, crearFlechas } from './navegacion.js';
import { crearIcono } from './icono.js';
import { guardarElemento, obtenerArchivo } from '../db.js';
import { hayQuickLook, crearEnlaceAR } from './boton-ar.js';
import { prepararRecorridoQuickLook } from './quicklook.js';

const TAM_I = 0.1; // diámetro de la "i" de destino (m)
const fmtCm = (m) => Math.round(m * 100);
const fmtM = (m) => m.toFixed(1).replace('.', ',');

export function crearNavegacion({
  escena, camara, capaEtiquetas, panel, panelPos, sensor, seguidos, elementos, abrirDetalle, esAdmin, ladoCm, ocupado,
}) {
  let componentesDe = new Map();  // id del QR ancla -> [componentes]
  let menuDe = null;              // ancla cuyo menú se está mostrando
  let nav = null;                 // navegación en curso
  let posicionar = false;         // herramienta del administrador
  let posAncla = null;
  const fotos = new Map();
  const matG = new THREE.Matrix4(), giroInv = new THREE.Matrix4();
  const v = new THREE.Vector3(), hacia = new THREE.Vector3(), lateral = new THREE.Vector3();

  function recalcular() {
    componentesDe = new Map();
    const els = elementos();
    if (!els) return;
    for (const e of els.values()) {
      if (!e.nav || !e.nav.ancla || !Array.isArray(e.nav.pos)) continue;
      if (!componentesDe.has(e.nav.ancla)) componentesDe.set(e.nav.ancla, []);
      componentesDe.get(e.nav.ancla).push(e);
    }
    for (const l of componentesDe.values()) l.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  async function miniatura(e) {
    if (fotos.has(e.id)) return fotos.get(e.id);
    const a = await obtenerArchivo(e.miniaturaId || e.imagenId);
    const u = a ? URL.createObjectURL(a.blob) : '';
    fotos.set(e.id, u);
    return u;
  }

  // ---------- menú de componentes de un QR ancla ----------
  function mostrarMenu(anclaId) {
    menuDe = anclaId;
    const lista = componentesDe.get(anclaId) || [];
    const ancla = elementos().get(anclaId);
    panel.innerHTML = '';
    const det = document.createElement('details');
    det.className = 'nav-menu';
    det.open = true;
    det.innerHTML = '<summary></summary><div class="nav-lista"></div>';
    det.querySelector('summary').textContent = `🧭 Ir a un componente de ${ancla ? ancla.nombre : anclaId} (${lista.length})`;
    const cont = det.querySelector('.nav-lista');
    for (const c of lista) {
      const b = document.createElement('button');
      b.className = 'rec-candidato';
      b.innerHTML = '<span class="mini"><img alt=""></span><span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>';
      b.querySelector('.fila-nombre').textContent = c.nombre;
      b.querySelector('.fila-ref').textContent = `${c.referencia} · ${c.id}`;
      const img = b.querySelector('img');
      miniatura(c).then((u) => { if (u) img.src = u; else img.remove(); });
      b.addEventListener('click', () => empezar(anclaId, c));
      cont.appendChild(b);
    }
    panel.appendChild(det);
    panel.hidden = false;
  }
  function ocultarMenu() { menuDe = null; if (!nav) panel.hidden = true; }

  // ---------- navegación ----------
  function empezar(anclaId, comp) {
    terminar();
    const puntos = puntosRecorrido(comp.nav);
    const flechas = crearFlechas(puntos);
    flechas.matrixAutoUpdate = false;
    escena.add(flechas);
    const destino = new THREE.Group();
    destino.matrixAutoUpdate = false;
    const ic = crearIcono(true);
    destino.add(ic);
    destino.traverse((o) => { o.userData.idNav = comp.id; });
    escena.add(destino);
    const etiqueta = document.createElement('div');
    etiqueta.className = 'etiqueta nav-destino';
    etiqueta.innerHTML = '<div class="et-textos"><div class="et-nombre"></div><div class="et-ref"></div></div><button class="et-mas" aria-label="Ver ficha">+</button>';
    etiqueta.querySelector('.et-nombre').textContent = comp.nombre;
    etiqueta.querySelector('.et-ref').textContent = `${comp.referencia} · ${comp.id}`;
    etiqueta.querySelector('.et-mas').addEventListener('click', () => abrirDetalle(comp.id));
    etiqueta.hidden = true;
    capaEtiquetas.appendChild(etiqueta);
    nav = { anclaId, comp, puntos, destinoG: puntos[puntos.length - 1], flechas, destino, icono: ic, etiqueta, mundo: null, visto: false, distancia: 0 };

    // Panel de navegación
    panel.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'rec-titulo nav-titulo';
    panel.appendChild(t);
    nav.titulo = t;
    const aviso = document.createElement('p');
    aviso.className = 'nota nav-aviso';
    panel.appendChild(aviso);
    nav.aviso = aviso;
    const fila = document.createElement('div');
    fila.className = 'botones-archivo';
    fila.innerHTML = '<button class="boton" data-n="ficha">ℹ️ Ver ficha</button><button class="boton secundario" data-n="fin">✕ Terminar</button>';
    fila.querySelector('[data-n="ficha"]').addEventListener('click', () => abrirDetalle(comp.id));
    fila.querySelector('[data-n="fin"]').addEventListener('click', () => { terminar(); if (menuDe) mostrarMenu(menuDe); });
    panel.appendChild(fila);
    // Recorrido con LiDAR (AR de Apple anclado al QR: sigue estable aunque andes)
    const ancla = elementos().get(anclaId);
    if (hayQuickLook() && ancla) {
      const l = crearEnlaceAR({ texto: '⏳ Preparando recorrido con LiDAR…' });
      panel.appendChild(l.enlace);
      prepararRecorridoQuickLook(comp, ancla, ladoCm())
        .then((u) => l.poner(u, '🧭 Recorrido con LiDAR (se ancla solo al QR)'))
        .catch((e) => { console.warn('Recorrido LiDAR:', e); l.texto('❌ No se pudo preparar el recorrido'); });
    }
    panel.hidden = false;
  }

  function terminar() {
    if (!nav) return;
    escena.remove(nav.flechas);
    escena.remove(nav.destino);
    nav.etiqueta.remove();
    nav = null;
  }

  // ---------- herramienta "Posicionar" (administrador) ----------
  let ultimoPintadoPos = 0;
  function pintarPosicionar(arriba, ahora) {
    if (ahora - ultimoPintadoPos < 400) return;
    ultimoPintadoPos = ahora;
    const visibles = [...seguidos.values()].filter((s) => s.visible && s.elemento);
    if (!posAncla || !visibles.some((s) => s.id === posAncla)) {
      posAncla = (visibles.find((s) => componentesDe.has(s.id)) || visibles[0] || {}).id || null;
    }
    panelPos.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'rec-titulo';
    h.textContent = '📍 Posicionar componentes';
    panelPos.appendChild(h);
    if (visibles.length < 2) {
      const p = document.createElement('p');
      p.className = 'nota';
      p.textContent = 'Apunta para que se vean A LA VEZ el QR ancla (por ejemplo el de la máquina) y el QR del componente. Mantén el móvil quieto un momento.';
      panelPos.appendChild(p);
      return;
    }
    const sa = visibles.find((s) => s.id === posAncla);
    const elegir = document.createElement('div');
    elegir.className = 'pos-anclas';
    for (const s of visibles) {
      const b = document.createElement('button');
      b.className = 'boton-mini' + (s.id === posAncla ? ' activo' : '');
      b.textContent = (s.id === posAncla ? '⚓ ' : '') + s.id;
      b.addEventListener('click', () => { posAncla = s.id; ultimoPintadoPos = 0; });
      elegir.appendChild(b);
    }
    const lab = document.createElement('p');
    lab.className = 'nota';
    lab.textContent = `Ancla: ${sa.elemento.nombre}. Toca otro ID para cambiarla. Coordenadas en cm (X derecha, Y arriba, Z hacia fuera del QR):`;
    panelPos.appendChild(lab);
    panelPos.appendChild(elegir);
    marcoQR(sa.pos, sa.rot, arriba, matG);
    const inversa = matG.clone().invert();
    for (const s of visibles) {
      if (s.id === posAncla) continue;
      const p = s.pos.clone().applyMatrix4(inversa);
      const fila = document.createElement('div');
      fila.className = 'pos-fila';
      fila.innerHTML = '<span class="pos-txt"></span><button class="boton-mini">💾 Guardar</button>';
      fila.querySelector('.pos-txt').textContent = `${s.elemento.nombre}: X ${fmtCm(p.x)} · Y ${fmtCm(p.y)} · Z ${fmtCm(p.z)}`;
      fila.querySelector('button').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const previo = s.elemento.nav;
        const navNuevo = {
          ancla: posAncla,
          pos: [p.x, p.y, p.z].map((n) => Math.round(n * 1000) / 1000),
          ruta: previo && previo.ancla === posAncla ? previo.ruta || [] : [],
        };
        const gL = gravedadEnQR(sa.rot, arriba);
        await guardarElemento({ id: s.id, nav: navNuevo });
        await guardarElemento({ id: posAncla, anclaGravedad: [gL.x, gL.y, gL.z].map((n) => Math.round(n * 1000) / 1000) });
        s.elemento.nav = navNuevo;
        sa.elemento.anclaGravedad = [gL.x, gL.y, gL.z];
        recalcular();
        btn.textContent = '✅ Guardado';
      });
      panelPos.appendChild(fila);
    }
  }

  recalcular();

  return {
    recalcular,
    /** Cada fotograma, antes de dibujar. */
    actualizar(dt, arriba, ahora) {
      // Menú automático al ver un QR ancla (si no se está navegando ni posicionando)
      if (ocupado()) { if (!nav) panel.hidden = true; menuDe = null; return; }
      if (!nav && !posicionar) {
        const anclaVista = [...seguidos.values()].find((s) => s.visible && componentesDe.has(s.id));
        if (anclaVista && menuDe !== anclaVista.id) mostrarMenu(anclaVista.id);
        else if (!anclaVista && menuDe) ocultarMenu();
      }
      if (posicionar) pintarPosicionar(arriba, ahora);
      if (!nav) return;
      const s = seguidos.get(nav.anclaId);
      const q = sensor.giro(0);
      if (s && s.visible) {
        marcoQR(s.pos, s.rot, arriba, matG);
        if (q) (nav.mundo ||= new THREE.Matrix4()).makeRotationFromQuaternion(q).multiply(matG);
        nav.visto = true;
      } else if (nav.mundo && q) {
        giroInv.makeRotationFromQuaternion(q).invert();
        matG.multiplyMatrices(giroInv, nav.mundo);
      } else if (!nav.visto) {
        nav.flechas.visible = nav.destino.visible = false;
        nav.titulo.textContent = `🧭 Hacia: ${nav.comp.nombre}`;
        nav.aviso.textContent = 'Apunta al QR ancla para ver el recorrido.';
        return;
      }
      nav.flechas.visible = nav.destino.visible = true;
      nav.flechas.matrix.copy(matG);
      nav.flechas.matrixWorldNeedsUpdate = true;
      // Destino: "i" de pie y mirando a la cámara, algo por encima del punto
      const d = v.copy(nav.destinoG).applyMatrix4(matG).addScaledVector(arriba, TAM_I * 0.8 + 0.01 * Math.sin(ahora / 400));
      hacia.copy(d).negate();
      hacia.addScaledVector(arriba, -hacia.dot(arriba));
      if (hacia.lengthSq() < 1e-8) hacia.set(0, 0, 1);
      hacia.normalize();
      lateral.crossVectors(arriba, hacia).normalize();
      nav.destino.matrix.makeBasis(lateral, arriba, hacia).scale(new THREE.Vector3(TAM_I, TAM_I, TAM_I)).setPosition(d);
      nav.destino.matrixWorldNeedsUpdate = true;
      nav.distancia = d.length();
      nav.titulo.textContent = `🧭 Hacia: ${nav.comp.nombre} · a ${fmtM(nav.distancia)} m`;
      nav.aviso.textContent = s && s.visible
        ? 'Sigue las flechas verdes. Toca la "i" del destino para ver su ficha.'
        : 'QR fuera de la vista: el recorrido es aproximado (no sigue si andas). Para andar con él, usa "Recorrido con LiDAR".';
    },
    /** Después de dibujar: coloca la etiqueta del destino. */
    etiquetas(g) {
      if (!nav || !nav.destino.visible) { if (nav) nav.etiqueta.hidden = true; return; }
      v.set(0, 0.75, 0).applyMatrix4(nav.destino.matrixWorld).project(camara);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { nav.etiqueta.hidden = true; return; }
      nav.etiqueta.hidden = false;
      const x = ((v.x + 1) / 2) * g.W, y = ((1 - v.y) / 2) * g.H;
      const ancho = nav.etiqueta.offsetWidth, alto = nav.etiqueta.offsetHeight;
      nav.etiqueta.style.transform = `translate(${Math.min(Math.max(x - ancho / 2, 8), g.W - ancho - 8)}px, ${y - alto - 6}px)`;
    },
    /** ¿Se ha tocado la "i" de destino? Devuelve el id del componente o null. */
    tocado(raycaster) {
      if (!nav || !nav.destino.visible) return null;
      const t = raycaster.intersectObject(nav.destino, true)[0];
      return t ? nav.comp.id : null;
    },
    alternarPosicionar() {
      posicionar = !posicionar && esAdmin();
      panelPos.hidden = !posicionar;
      ultimoPintadoPos = 0;
      if (posicionar) { terminar(); panel.hidden = true; menuDe = null; }
      return posicionar;
    },
    detener() {
      terminar();
      fotos.forEach((u) => u && URL.revokeObjectURL(u));
    },
  };
}
