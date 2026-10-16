// Realidad aumentada de navegación con QR ancla.
//
// crearCapaRecorrido: dibuja un recorrido (flechas 3D + icono de destino + etiqueta) en el sistema de
//   coordenadas del QR ancla. Con el QR a la vista es exacto. Si deja de verse, se mantiene con el giro
//   del móvil; pasados unos segundos se considera POCO FIABLE: las flechas se atenúan y se pide
//   recalibrar (volver a apuntar al QR del ancla).
//
// crearModoAncla: botón ANCLA. Activa un ancla de la máquina activa, muestra el menú de sus
//   componentes localizados y guía hasta el elegido. El administrador puede "Posicionar" componentes.
import * as THREE from 'three';
import { marcoQR, gravedadEnQR, puntosRecorrido, crearFlechas } from './navegacion.js';
import { crearIcono } from './icono.js';
import { obtenerArchivo } from '../db.js';
import { deG, describir } from '../coordenadas.js';
import { hayQuickLook, crearEnlaceAR } from './boton-ar.js';
import { prepararRecorridoQuickLook, bloqueRecorridoLidar } from './quicklook.js';
import {
  localizacionesDeAncla, guardarLocalizacion, guardarGravedadAncla, obtenerAncla,
} from '../maquinas.js';

const TAM_I = 0.1;                 // diámetro de la "i" de destino (m)
const SEGUNDOS_FIABLE = 4;         // sin ver el QR del ancla más tiempo: poco fiable, recalibrar
const fmtCm = (m) => Math.round(m * 100);
const fmtM = (m) => m.toFixed(1).replace('.', ',');

// ======================================================================
// Capa de recorrido (la usan el modo ANCLA y las GUÍAS)
// ======================================================================
export function crearCapaRecorrido({ escena, camara, capaEtiquetas, sensor, mostrarEjes = () => false }) {
  let r = null; // recorrido actual
  const matG = new THREE.Matrix4(), giroInv = new THREE.Matrix4();
  const v = new THREE.Vector3(), hacia = new THREE.Vector3(), lateral = new THREE.Vector3();
  const destinoCam = new THREE.Vector3();

  // Flecha en el borde de la pantalla que señala el destino cuando no se ve
  const indicador = document.createElement('div');
  indicador.className = 'indicador-destino';
  indicador.innerHTML = '<span class="ind-flecha">➤</span><span class="ind-texto"></span>';
  indicador.hidden = true;
  capaEtiquetas.appendChild(indicador);

  // Ejes del ancla (X rojo, Y amarillo, Z azul), para saber hacia dónde va cada coordenada
  const LARGO_EJE = 0.3;
  const ejes = new THREE.Group();
  ejes.matrixAutoUpdate = false;
  ejes.visible = false;
  const etiquetasEjes = [];
  for (const [nombre, color, dir] of [['DERECHA', 0xff453a, [1, 0, 0]], ['ARRIBA', 0xffd60a, [0, 1, 0]], ['ADELANTE', 0x0a84ff, [0, 0, -1]]]) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const d = new THREE.Vector3(...dir);
    const palo = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, LARGO_EJE, 8), mat);
    palo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    palo.position.copy(d).multiplyScalar(LARGO_EJE / 2);
    const punta = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 12), mat);
    punta.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    punta.position.copy(d).multiplyScalar(LARGO_EJE);
    ejes.add(palo, punta);
    const et = document.createElement('div');
    et.className = 'etiqueta-eje';
    et.textContent = nombre;
    et.style.color = '#' + color.toString(16).padStart(6, '0');
    et.hidden = true;
    capaEtiquetas.appendChild(et);
    etiquetasEjes.push({ et, punta: d.clone().multiplyScalar(LARGO_EJE + 0.05) });
  }
  escena.add(ejes);
  const matEjes = new THREE.Matrix4();

  /** Cada fotograma (aunque no haya recorrido): coloca los ejes sobre el QR del ancla si se ve. */
  // "Arriba" medido en el escaneo inicial, en coordenadas del QR del ancla (fijo)
  let calibrada = null; // { id, g: Vector3 }
  const gravedadDe = (s) => (calibrada && s && s.id === calibrada.id ? calibrada.g : null);
  function fijarGravedad(id, g) { calibrada = id && g ? { id, g: new THREE.Vector3(g[0], g[1], g[2]).normalize() } : null; }
  let forzarEjes = false;
  function actualizarEjes(arriba, seguidoAncla) {
    const ver = (mostrarEjes() || forzarEjes) && seguidoAncla && seguidoAncla.visible;
    ejes.visible = !!ver;
    if (!ver) return;
    marcoQR(seguidoAncla.pos, seguidoAncla.rot, arriba, matEjes, gravedadDe(seguidoAncla));
    ejes.matrix.copy(matEjes);
    ejes.matrixWorldNeedsUpdate = true;
  }
  const escalaI = new THREE.Vector3(TAM_I, TAM_I, TAM_I);

  function ocultar() {
    indicador.hidden = true;
    if (!r) return;
    if (r.flechas) escena.remove(r.flechas);
    if (r.destino) escena.remove(r.destino);
    if (r.etiqueta) r.etiqueta.remove();
    r = null;
  }

  /**
   * loc: { pos, ruta, posIcono }; opciones: conFlechas, conIcono, titulo, subtitulo, descripcion, alTocar.
   * (Conserva el sistema de referencia ya calculado si el ancla es la misma.)
   */
  function mostrar(loc, { rutaPropia = null, conFlechas = true, conIcono = true, titulo = '', subtitulo = '', descripcion = '', alTocar } = {}) {
    const prev = r;
    ocultar();
    const puntos = puntosRecorrido({ pos: loc.pos, ruta: rutaPropia || loc.ruta || [] });
    const destinoG = new THREE.Vector3(...(loc.posIcono || loc.pos));
    r = { puntos, destinoG, alTocar, mundo: prev ? prev.mundo : null, visto: prev ? prev.visto : false, perdido: prev ? prev.perdido : 0 };
    if (conFlechas) {
      r.flechas = crearFlechas(puntos);
      r.flechas.matrixAutoUpdate = false;
      r.flechas.visible = false;
      r.materiales = r.flechas.userData.materiales || [];
      r.materiales.forEach((m) => { m.transparent = true; m.userData.opacidad = m.opacity; });
      escena.add(r.flechas);
    }
    if (conIcono) {
      r.destino = new THREE.Group();
      r.destino.matrixAutoUpdate = false;
      r.destino.visible = false;
      r.destino.add(crearIcono(true));
      escena.add(r.destino);
      const e = document.createElement('div');
      e.className = 'etiqueta nav-destino';
      e.innerHTML = '<div class="et-textos"><div class="et-nombre"></div><div class="et-ref"></div><div class="et-desc"></div><div class="et-aviso" hidden>⚠️ Poco fiable: apunta al QR del ancla</div></div>'
        + (alTocar ? '<button class="et-mas" aria-label="Ver ficha">+</button>' : '');
      e.querySelector('.et-nombre').textContent = titulo;
      e.querySelector('.et-ref').textContent = subtitulo;
      const d = e.querySelector('.et-desc');
      d.textContent = descripcion ? (descripcion.length > 140 ? descripcion.slice(0, 140) + '…' : descripcion) : '';
      d.hidden = !descripcion;
      e.querySelector('.et-mas')?.addEventListener('click', alTocar);
      e.hidden = true;
      capaEtiquetas.appendChild(e);
      r.etiqueta = e;
    }
  }

  /** Cada fotograma. seguidoAncla: el QR del ancla (o null). Devuelve el estado del recorrido. */
  function actualizar(dt, arriba, ahora, seguidoAncla) {
    if (!r) return null;
    const q = sensor.giro(0);
    if (seguidoAncla && seguidoAncla.visible) {
      marcoQR(seguidoAncla.pos, seguidoAncla.rot, arriba, matG, gravedadDe(seguidoAncla));
      if (q) (r.mundo ||= new THREE.Matrix4()).makeRotationFromQuaternion(q).multiply(matG);
      r.visto = true;
      r.perdido = 0;
    } else {
      r.perdido += dt;
      if (r.mundo && q) {
        giroInv.makeRotationFromQuaternion(q).invert();
        matG.multiplyMatrices(giroInv, r.mundo);
      } else if (!r.visto) {
        if (r.flechas) r.flechas.visible = false;
        if (r.destino) r.destino.visible = false;
        return { visto: false, fiable: false, distancia: 0, esperandoAncla: true };
      }
    }
    const fiable = r.perdido < SEGUNDOS_FIABLE;
    if (r.flechas) {
      r.flechas.visible = true;
      r.flechas.matrix.copy(matG);
      r.flechas.matrixWorldNeedsUpdate = true;
      (r.materiales || []).forEach((m) => { m.opacity = (m.userData.opacidad ?? 1) * (fiable ? 1 : 0.3); });
    }
    const d = v.copy(r.destinoG).applyMatrix4(matG).addScaledVector(arriba, TAM_I * 0.8 + 0.01 * Math.sin(ahora / 400));
    destinoCam.copy(d);
    r.hayDestino = true;
    if (r.destino) {
      r.destino.visible = true;
      hacia.copy(d).negate();
      hacia.addScaledVector(arriba, -hacia.dot(arriba));
      if (hacia.lengthSq() < 1e-8) hacia.set(0, 0, 1);
      hacia.normalize();
      lateral.crossVectors(arriba, hacia).normalize();
      r.destino.matrix.makeBasis(lateral, arriba, hacia).scale(escalaI).setPosition(d);
      r.destino.matrixWorldNeedsUpdate = true;
      r.etiqueta.querySelector('.et-aviso').hidden = fiable;
    }
    return { visto: !!(seguidoAncla && seguidoAncla.visible), fiable, distancia: d.length(), perdido: r.perdido };
  }

  function etiquetas(g) {
    // Nombres de los ejes del ancla
    for (const { et, punta } of etiquetasEjes) {
      if (!ejes.visible) { et.hidden = true; continue; }
      const p = v.copy(punta).applyMatrix4(ejes.matrixWorld).project(camara);
      et.hidden = p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1;
      if (!et.hidden) et.style.transform = `translate(${((p.x + 1) / 2) * g.W - 12}px, ${((1 - p.y) / 2) * g.H - 12}px)`;
    }
    // Destino fuera de la pantalla: flecha en el borde señalando hacia dónde girar el móvil
    if (r && r.hayDestino) {
      const p = v.copy(destinoCam).project(camara);
      const detras = destinoCam.z > 0; // la cámara mira hacia -Z: z > 0 es detrás
      const fuera = detras || Math.abs(p.x) > 0.92 || Math.abs(p.y) > 0.92;
      indicador.hidden = !fuera;
      if (fuera) {
        let dx = p.x, dy = p.y;
        if (detras) { dx = -dx; dy = -dy; }
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1; // justo detrás: "gírate"
        const ang = Math.atan2(-dy, dx); // en pantalla (y hacia abajo)
        const radio = Math.min(g.W, g.H) / 2 - 60;
        const cx = g.W / 2 + Math.cos(ang) * radio, cy = g.H / 2 + Math.sin(ang) * radio;
        indicador.style.transform = `translate(${cx - 40}px, ${cy - 30}px)`;
        indicador.querySelector('.ind-flecha').style.transform = `rotate(${ang}rad)`;
        indicador.querySelector('.ind-texto').textContent = `Destino · ${fmtM(destinoCam.length())} m${detras ? ' (detrás)' : ''}`;
      }
    }
    if (!r || !r.destino || !r.destino.visible) { if (r && r.etiqueta) r.etiqueta.hidden = true; return; }
    v.set(0, 0.75, 0).applyMatrix4(r.destino.matrixWorld).project(camara);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { r.etiqueta.hidden = true; return; }
    r.etiqueta.hidden = false;
    const x = ((v.x + 1) / 2) * g.W, y = ((1 - v.y) / 2) * g.H;
    const ancho = r.etiqueta.offsetWidth, alto = r.etiqueta.offsetHeight;
    r.etiqueta.style.transform = `translate(${Math.min(Math.max(x - ancho / 2, 8), g.W - ancho - 8)}px, ${y - alto - 6}px)`;
  }

  /** ¿Se ha tocado el icono de destino? (llama a alTocar) */
  function tocado(raycaster) {
    if (!r || !r.destino || !r.destino.visible || !r.alTocar) return false;
    if (!raycaster.intersectObject(r.destino, true).length) return false;
    r.alTocar();
    return true;
  }

  /** Olvidar el sistema de referencia (al cambiar de ancla). */
  function reiniciarReferencia() { if (r) { r.mundo = null; r.visto = false; r.perdido = 0; } }

  return {
    mostrar, ocultar, actualizar, actualizarEjes, etiquetas, tocado, reiniciarReferencia, fijarGravedad,
    set forzarEjes(v) { forzarEjes = !!v; }, get activo() { return !!r; },
  };
}

// ======================================================================
// Modo ANCLA (localizar componentes de la máquina activa)
// ======================================================================
export function crearModoAncla({
  capa, panel, panelPos, seguidos, abrirDetalle, maquinaId, ladoCm, esAdmin, avisar, verLocId = null, gravedadCalibrada = () => null }) {
  let anclaId = null;          // ancla activa (QR de la máquina activa)
  let ancla = null;
  let locs = [];               // localizaciones válidas para esa ancla
  let nav = null;              // { loc } navegación en curso
  let posicionar = false;
  let cargando = false;
  const fotos = new Map();
  let fotoUrls = [];

  async function miniatura(e) {
    if (fotos.has(e.id)) return fotos.get(e.id);
    const a = await obtenerArchivo(e.miniaturaId || e.imagenId);
    const u = a ? URL.createObjectURL(a.blob) : '';
    if (u) fotoUrls.push(u);
    fotos.set(e.id, u);
    return u;
  }

  let arribaActual = null;
  async function activar(id) {
    cargando = true;
    anclaId = id;
    ancla = await obtenerAncla(id);
    // Si no se sabe cómo está colocado su QR (pared, mesa…), se mide ahora con el sensor
    const sa = seguidos.get(id);
    const medida = gravedadCalibrada(id);
    if (ancla && medida) ancla.gravedad = medida;
    else if (ancla && !ancla.gravedad && sa && arribaActual) {
      const gL = gravedadEnQR(sa.rot, arribaActual);
      ancla.gravedad = [gL.x, gL.y, gL.z];
      if (esAdmin()) guardarGravedadAncla(id, ancla.gravedad).catch(() => {});
    }
    locs = await localizacionesDeAncla(maquinaId, id); // ya comprueba máquina–ancla–elemento
    cargando = false;
    capa.reiniciarReferencia();
    mostrarMenu();
    // Previsualización desde el editor de localizaciones: empezar directamente ese recorrido
    const ver = verLocId && locs.find((l) => l.id === verLocId);
    if (ver) empezar(ver);
    else if (verLocId) avisar('Esa localización es de otra ancla: apunta al QR de su ancla.');
  }

  function cabecera() {
    const h = document.createElement('div');
    h.className = 'nav-cabecera';
    h.innerHTML = '<span class="nav-ancla"></span><button class="boton-mini" data-n="cambiar">🔄 Cambiar de ancla</button>';
    h.querySelector('.nav-ancla').textContent = `⚓ ${ancla ? ancla.nombre : anclaId}`;
    h.querySelector('[data-n="cambiar"]').addEventListener('click', () => {
      capa.ocultar(); nav = null; anclaId = null; ancla = null; locs = [];
      panel.innerHTML = '<p class="rec-msg">Apunta al QR del ancla que quieras usar.</p>';
    });
    return h;
  }

  function mostrarMenu() {
    nav = null;
    capa.ocultar();
    panel.innerHTML = '';
    panel.appendChild(cabecera());
    const det = document.createElement('details');
    det.className = 'nav-menu';
    det.open = true;
    det.innerHTML = '<summary></summary><div class="nav-lista"></div>';
    det.querySelector('summary').textContent = `🧭 Componentes para localizar (${locs.length})`;
    const cont = det.querySelector('.nav-lista');
    if (!locs.length) {
      cont.innerHTML = '<p class="nota">Esta ancla todavía no tiene componentes localizados. El administrador puede configurarlos (botón 📍 o desde Gestión de máquinas).</p>';
    }
    for (const l of locs) {
      const c = l.elemento;
      const b = document.createElement('button');
      b.className = 'rec-candidato';
      b.innerHTML = '<span class="mini"><img alt=""></span><span class="fila-textos"><span class="fila-nombre"></span><span class="fila-ref"></span></span>';
      b.querySelector('.fila-nombre').textContent = c.nombre;
      b.querySelector('.fila-ref').textContent = `${c.referencia} · ${c.id}`;
      const img = b.querySelector('img');
      miniatura(c).then((u) => { if (u) img.src = u; else img.remove(); });
      b.addEventListener('click', () => empezar(l));
      cont.appendChild(b);
    }
    panel.appendChild(det);
  }

  function empezar(l) {
    const c = l.elemento;
    // Comprobación en el momento de usarla (regla 7): sigue siendo de esta máquina y de esta ancla
    if (c.maquinaId !== maquinaId || l.maquinaId !== maquinaId || l.anclaId !== anclaId) {
      avisar('Esa localización no corresponde a la máquina o al ancla activas.');
      return;
    }
    nav = { loc: l };
    capa.mostrar(l, {
      titulo: c.nombre, subtitulo: `${c.referencia} · ${c.id}`, alTocar: () => abrirDetalle(c.id),
    });
    panel.innerHTML = '';
    panel.appendChild(cabecera());
    const t = document.createElement('div');
    t.className = 'rec-titulo nav-titulo';
    panel.appendChild(t);
    const aviso = document.createElement('p');
    aviso.className = 'nota nav-aviso';
    panel.appendChild(aviso);
    nav.titulo = t; nav.aviso = aviso;
    const fila = document.createElement('div');
    fila.className = 'botones-archivo';
    fila.innerHTML = '<button class="boton" data-n="ficha">ℹ️ Ver ficha</button><button class="boton secundario" data-n="fin">✕ Terminar</button>';
    fila.querySelector('[data-n="ficha"]').addEventListener('click', () => abrirDetalle(c.id));
    fila.querySelector('[data-n="fin"]').addEventListener('click', mostrarMenu);
    panel.appendChild(fila);
    if (hayQuickLook() && ancla) {
      panel.appendChild(bloqueRecorridoLidar({ ...c, nav: { pos: l.pos, ruta: l.ruta } }, { id: ancla.id, anclaGravedad: ancla.gravedad }, ladoCm()));
    }
  }

  // ---------- "Posicionar" (administrador): elemento y ancla a la vista a la vez ----------
  let ultimoPintadoPos = 0;
  const matG = new THREE.Matrix4();
  function pintarPosicionar(arriba, ahora) {
    if (ahora - ultimoPintadoPos < 400) return;
    ultimoPintadoPos = ahora;
    const visibles = [...seguidos.values()].filter((s) => s.visible);
    const sa = visibles.find((s) => s.tipo === 'ancla-activa');
    panelPos.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'rec-titulo';
    h.textContent = '📍 Posicionar componentes';
    panelPos.appendChild(h);
    const comps = visibles.filter((s) => s.elementoDetectado && s.id !== (sa && sa.id));
    if (!sa || !comps.length) {
      const p = document.createElement('p');
      p.className = 'nota';
      p.textContent = 'Apunta para que se vean A LA VEZ el QR del ancla y el QR del componente. Mantén el móvil quieto un momento.';
      panelPos.appendChild(p);
      return;
    }
    const lab = document.createElement('p');
    lab.className = 'nota';
    lab.textContent = `Ancla: ${sa.ancla.nombre}. Posición de cada componente desde el QR del ancla (adelante = hacia donde miras al leerlo derecho):`;
    panelPos.appendChild(lab);
    marcoQR(sa.pos, sa.rot, arriba, matG);
    const inversa = matG.clone().invert();
    for (const s of comps) {
      const p = s.pos.clone().applyMatrix4(inversa);
      const fila = document.createElement('div');
      fila.className = 'pos-fila';
      fila.innerHTML = '<span class="pos-txt"></span><button class="boton-mini">💾 Guardar</button>';
      const deEsta = s.elementoDetectado.maquinaId === maquinaId;
      fila.querySelector('.pos-txt').textContent = deEsta
        ? `${s.elementoDetectado.nombre}: ${describir(deG([p.x, p.y, p.z]))}`
        : `${s.elementoDetectado.nombre}: es de otra máquina (${s.elementoDetectado.maquinaId || 'sin máquina'})`;
      const btn = fila.querySelector('button');
      btn.disabled = !deEsta;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const previa = locs.find((l) => l.elementoId === s.id);
          await guardarLocalizacion({
            maquinaId, anclaId: sa.id, elementoId: s.id, pos: [p.x, p.y, p.z],
            ruta: previa ? previa.ruta : [], posIcono: previa ? previa.posIcono : null,
          });
          const gL = gravedadEnQR(sa.rot, arriba);
          await guardarGravedadAncla(sa.id, [gL.x, gL.y, gL.z]);
          locs = await localizacionesDeAncla(maquinaId, sa.id);
          btn.textContent = '✅ Guardado';
        } catch (e) {
          avisar(e.message);
          btn.disabled = false;
        }
      });
      panelPos.appendChild(fila);
    }
  }

  panel.innerHTML = '<p class="rec-msg">Apunta al QR del ancla de la máquina.</p>';
  panel.hidden = false;

  return {
    actualizar(dt, arriba, ahora) {
      arribaActual = arriba;
      capa.actualizarEjes(arriba, anclaId ? seguidos.get(anclaId) : [...seguidos.values()].find((s) => s.visible && s.tipo === 'ancla-activa'));
      if (!anclaId && !cargando) {
        const vista = [...seguidos.values()].find((s) => s.visible && s.tipo === 'ancla-activa');
        if (vista) activar(vista.id);
      }
      if (posicionar) pintarPosicionar(arriba, ahora);
      if (!nav) return;
      const est = capa.actualizar(dt, arriba, ahora, seguidos.get(anclaId));
      if (!est) return;
      const c = nav.loc.elemento;
      if (est.esperandoAncla) {
        nav.titulo.textContent = `🧭 Hacia: ${c.nombre}`;
        nav.aviso.textContent = 'Apunta al QR del ancla para ver el recorrido.';
        return;
      }
      nav.titulo.textContent = `🧭 Hacia: ${c.nombre} · a ${fmtM(est.distancia)} m`;
      nav.aviso.className = 'nota nav-aviso' + (est.fiable ? '' : ' aviso-recalibrar');
      nav.aviso.textContent = est.visto
        ? 'Sigue las flechas verdes. Toca la "i" del destino para ver su ficha.'
        : est.fiable
          ? 'QR fuera de la vista: las flechas se mantienen con el giro del móvil.'
          : '⚠️ Precisión perdida: vuelve a apuntar al QR del ancla para recalibrar. Para andar con las flechas, usa "Recorrido con LiDAR".';
    },
    etiquetas(g) { capa.etiquetas(g); },
    tocado(raycaster) { return capa.tocado(raycaster); },
    alternarPosicionar() {
      posicionar = !posicionar && esAdmin();
      panelPos.hidden = !posicionar;
      panel.hidden = posicionar;
      ultimoPintadoPos = 0;
      return posicionar;
    },
    detener() {
      capa.ocultar();
      fotoUrls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
