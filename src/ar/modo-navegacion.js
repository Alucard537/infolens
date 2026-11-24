// Realidad aumentada de navegación con QR ancla.
//
// crearCapaRecorrido: dibuja un recorrido (flechas 3D e icono de destino) en el sistema de
//   coordenadas del QR ancla. Usa el QR o el seguimiento del entorno mientras la pose sea reciente.
//
// crearModoAncla: botón ANCLA. Activa un ancla de la máquina activa, muestra el menú de sus
//   componentes localizados y guía hasta el elegido. El administrador puede "Posicionar" componentes.
import * as THREE from 'three';
import { marcoQR, gravedadEnQR, puntosRecorrido, crearFlechas } from './navegacion.js';
import { fuentePoseAncla, progresoRecorrido, textoTramo } from './guia-recorrido.js';
import { leerAjustes } from '../ajustes.js';
import { crearIcono } from './icono.js';
import { obtenerArchivo } from '../db.js';
import { deG, describir } from '../coordenadas.js';
import {
  localizacionesDeAncla, guardarLocalizacion, guardarGravedadAncla, obtenerAncla,
} from '../maquinas.js';

const TAM_I = 0.1;                 // diámetro de la "i" de destino (m)

// ======================================================================
// Capa de recorrido (la usan el modo ANCLA y las GUÍAS)
// ======================================================================
export function crearCapaRecorrido({ escena, camara, capaEtiquetas, mostrarEjes = () => false }) {
  let r = null; // recorrido actual
  let elementosVisibles = null;
  const matG = new THREE.Matrix4(), inversa = new THREE.Matrix4();
  const v = new THREE.Vector3(), hacia = new THREE.Vector3(), lateral = new THREE.Vector3();
  const objetivoCam = new THREE.Vector3(), posicionG = new THREE.Vector3();
  const marcaTramo = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffc83d }));
  const iconoDestino = crearIcono(true);

  // Flecha en el borde de la pantalla que señala el siguiente punto del recorrido.
  const indicador = document.createElement('div');
  indicador.className = 'indicador-destino';
  indicador.innerHTML = '<span class="ind-flecha" aria-hidden="true">➤</span>';
  const flechaIndicador = indicador.firstElementChild;
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
    elementosVisibles = null;
    if (!r) return;
    quitarCamino();
    if (r.destino) escena.remove(r.destino);
    r = null;
  }

  function quitarCamino() {
    if (!r?.flechas) return;
    escena.remove(r.flechas);
    marcaTramo.removeFromParent();
    for (const objeto of r.flechas.children) if (objeto.userData.linea) objeto.geometry.dispose();
    for (const material of r.flechas.userData.materiales) material.dispose();
    r.flechas = null;
  }

  function dibujarCamino(vista) {
    const linea = vista === 'linea';
    r.flechas = crearFlechas(r.puntos, 0.5, { conLinea: linea, conFlechas: !linea, conAro: false, grosorLinea: 0.006 });
    r.flechas.add(marcaTramo);
    r.flechas.matrixAutoUpdate = false;
    r.flechas.visible = false;
    escena.add(r.flechas);
  }

  function cambiarVista(vista) {
    if (!r?.flechas) return;
    quitarCamino();
    dibujarCamino(vista);
  }

  /**
   * loc: { pos, ruta, posIcono }; opciones: conFlechas, conIcono, alTocar.
   * (Conserva el sistema de referencia ya calculado si el ancla es la misma.)
   */
  function mostrar(loc, { conFlechas = true, conIcono = true, alTocar } = {}) {
    const prev = r;
    ocultar();
    const puntos = puntosRecorrido(loc);
    const destinoG = new THREE.Vector3(...(loc.posIcono || loc.pos));
    r = { puntos, destinoG, alTocar, visto: prev?.visto || false, indice: 1, tramo: null };
    if (conFlechas) dibujarCamino(leerAjustes().lidarVista);
    if (conIcono) {
      r.destino = new THREE.Group();
      r.destino.matrixAutoUpdate = false;
      r.destino.visible = false;
      r.destino.add(iconoDestino);
      escena.add(r.destino);
    }
  }

  function mostrarElementos(marcas, anclaId) {
    ocultar();
    elementosVisibles = { anclaId, posiciones: marcas.map(({ id, pos }) => ({ id, punto: new THREE.Vector3(...pos) })) };
  }

  function proyectarPunto(punto) {
    if (punto.z >= -0.05) return null;
    punto.project(camara);
    if (Math.abs(punto.x) > 1 || Math.abs(punto.y) > 1 || punto.z < -1 || punto.z > 1) return null;
    return { x: (1 + punto.x) / 2, y: (1 - punto.y) / 2 };
  }

  /** Cada fotograma. seguidoAncla: el QR del ancla (o null). Devuelve el estado del recorrido. */
  function actualizar(arriba, ahora, seguidoAncla) {
    if (!r && !elementosVisibles) return null;
    const fuente = fuentePoseAncla(seguidoAncla, ahora);
    if (elementosVisibles) {
      if (!fuente || seguidoAncla.id !== elementosVisibles.anclaId) return { fiable: false };
      marcoQR(seguidoAncla.pos, seguidoAncla.rot, arriba, matG, gravedadDe(seguidoAncla));
      const elementos = [];
      for (const { id, punto } of elementosVisibles.posiciones) {
        const puntoVisible = proyectarPunto(v.copy(punto).applyMatrix4(matG));
        if (puntoVisible) elementos.push({ id, ...puntoVisible });
      }
      return { fiable: true, elementos };
    }
    if (!fuente) {
      if (r.flechas) r.flechas.visible = false;
      if (r.destino) r.destino.visible = false;
      indicador.hidden = true;
      r.tramo = null;
      return { fiable: false, esperandoAncla: !r.visto };
    }
    r.visto = true;
    marcoQR(seguidoAncla.pos, seguidoAncla.rot, arriba, matG, gravedadDe(seguidoAncla));
    posicionG.set(0, 0, 0).applyMatrix4(inversa.copy(matG).invert());
    const tramo = progresoRecorrido(r.puntos, posicionG, r.indice);
    r.indice = tramo.indice;
    r.tramo = tramo;
    objetivoCam.copy(tramo.punto).applyMatrix4(matG);
    if (r.flechas) {
      r.flechas.visible = true;
      r.flechas.matrix.copy(matG);
      r.flechas.matrixWorldNeedsUpdate = true;
      marcaTramo.visible = !tramo.llegada;
      marcaTramo.position.copy(tramo.punto);
      marcaTramo.position.y += 0.04;
    }
    const d = v.copy(r.destinoG).applyMatrix4(matG).addScaledVector(arriba, TAM_I * 0.8 + 0.01 * Math.sin(ahora / 400));
    if (r.destino) {
      r.destino.visible = true;
      hacia.copy(d).negate();
      hacia.addScaledVector(arriba, -hacia.dot(arriba));
      if (hacia.lengthSq() < 1e-8) hacia.set(0, 0, 1);
      hacia.normalize();
      lateral.crossVectors(arriba, hacia).normalize();
      r.destino.matrix.makeBasis(lateral, arriba, hacia).scale(escalaI).setPosition(d);
      r.destino.matrixWorldNeedsUpdate = true;
    }
    return { ...tramo, fuente, fiable: true, destinoVisible: !!r.destino && !!proyectarPunto(d) };
  }

  function etiquetas(g) {
    if (r?.flechas?.visible) {
      // El límite en pantalla evita que una flecha cercana ocupe toda la cámara.
      const escalaPorMetro = 2 * 64 / (g.H * camara.projectionMatrix.elements[5] * 0.16);
      for (const flecha of r.flechas.children) {
        const tramo = flecha.userData.tramo;
        if (!tramo) continue;
        const profundidad = -v.copy(flecha.position).applyMatrix4(matG).z;
        flecha.visible = profundidad > 0.08;
        if (flecha.visible) flecha.scale.setScalar(Math.min(tramo.escala, profundidad * escalaPorMetro));
      }
    }
    // Nombres de los ejes del ancla
    for (const { et, punta } of etiquetasEjes) {
      if (!ejes.visible) { et.hidden = true; continue; }
      const p = v.copy(punta).applyMatrix4(ejes.matrixWorld).project(camara);
      et.hidden = p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1;
      if (!et.hidden) et.style.transform = `translate(${((p.x + 1) / 2) * g.W - 12}px, ${((1 - p.y) / 2) * g.H - 12}px)`;
    }
    if (r?.flechas && r.tramo && !r.tramo.llegada) {
      const p = v.copy(objetivoCam).project(camara);
      const detras = objetivoCam.z >= 0;
      const fuera = detras || Math.abs(p.x) > 0.92 || Math.abs(p.y) > 0.92;
      indicador.hidden = !fuera;
      if (fuera) {
        let dx = detras ? objetivoCam.x : p.x, dy = detras ? objetivoCam.y : p.y;
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = -1; // justo detrás: "gírate"
        const ang = Math.atan2(-dy, dx); // en pantalla (y hacia abajo)
        const radio = Math.max(0, Math.min(g.W, g.H) / 2 - 38);
        const cx = g.W / 2 + Math.cos(ang) * radio, cy = g.H / 2 + Math.sin(ang) * radio;
        indicador.style.transform = `translate(${cx - 22}px, ${cy - 22}px)`;
        flechaIndicador.style.transform = `rotate(${ang}rad)`;
      }
    } else indicador.hidden = true;
  }

  /** ¿Se ha tocado el icono de destino? (llama a alTocar) */
  function tocado(raycaster) {
    if (!r || !r.destino || !r.destino.visible || !r.alTocar) return false;
    if (!raycaster.intersectObject(r.destino, true).length) return false;
    r.alTocar();
    return true;
  }

  /** Olvidar el sistema de referencia (al cambiar de ancla). */
  function reiniciarReferencia() { if (r) { r.visto = false; r.indice = 1; } }

  return {
    mostrar, mostrarElementos, ocultar, cambiarVista, actualizar, actualizarEjes, etiquetas, tocado, reiniciarReferencia, fijarGravedad,
    set forzarEjes(v) { forzarEjes = !!v; }, get activo() { return !!r; },
  };
}

// ======================================================================
// Modo ANCLA (localizar componentes de la máquina activa)
// ======================================================================
export function crearModoAncla({
  capa, panel, panelPos, seguidos, abrirDetalle, maquinaId, esAdmin, avisar, verLocId = null,
  gravedadCalibrada = () => null, alCambiarAncla = () => {} }) {
  let anclaId = null;          // ancla activa (QR de la máquina activa)
  let ancla = null;
  let locs = [];               // localizaciones válidas para esa ancla
  let avisoRecorrido = null;
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
    ancla = await obtenerAncla(id, maquinaId);
    // Si no se sabe cómo está colocado su QR (pared, mesa…), se mide ahora con el sensor
    const sa = seguidos.get(id);
    const medida = gravedadCalibrada(id);
    if (ancla && medida) ancla.gravedad = medida;
    else if (ancla && !ancla.gravedad && sa && arribaActual) {
      const gL = gravedadEnQR(sa.rot, arribaActual);
      ancla.gravedad = [gL.x, gL.y, gL.z];
      if (esAdmin()) guardarGravedadAncla(id, maquinaId, ancla.gravedad).catch(() => {});
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
      capa.ocultar(); avisoRecorrido = null; anclaId = null; ancla = null; locs = [];
      panel.classList.remove('tarjeta-recorrido');
      panel.innerHTML = '<p class="rec-msg">Apunta al QR del ancla que quieras usar.</p>';
      alCambiarAncla();
    });
    return h;
  }

  function mostrarMenu() {
    avisoRecorrido = null;
    capa.ocultar();
    panel.classList.remove('tarjeta-recorrido');
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
    const indice = locs.findIndex(({ id }) => id === l.id);
    const siguiente = indice >= 0 ? locs[indice + 1] : null;
    panel.classList.add('tarjeta-recorrido');
    panel.innerHTML = `
      <span class="guia-paso"></span>
      <h2 class="guia-titulo"></h2>
      <p class="guia-referencia"></p>
      <p class="nota nav-aviso"></p>
      <details class="guia-cuerpo">
        <summary>Ficha del elemento</summary>
        <p class="nota nav-descripcion"></p>
        <button class="boton-mini" data-n="ficha">Ver ficha completa</button>
      </details>
      <div class="guia-nav">
        <button class="boton secundario" data-n="fin">Ver lista</button>
        <button class="boton" data-n="sig">Siguiente ›</button>
      </div>`;
    const $ = (selector) => panel.querySelector(selector);
    $('.guia-paso').textContent = `Elemento ${indice + 1} de ${locs.length}`;
    $('.guia-titulo').textContent = c.nombre;
    $('.guia-referencia').textContent = [c.referencia, c.id].filter(Boolean).join(' · ');
    const descripcion = $('.nav-descripcion');
    descripcion.textContent = c.descripcion || '';
    descripcion.hidden = !c.descripcion;
    avisoRecorrido = $('.nav-aviso');
    $('[data-n="ficha"]').addEventListener('click', () => abrirDetalle(c.id));
    $('[data-n="fin"]').addEventListener('click', mostrarMenu);
    const siguienteBoton = $('[data-n="sig"]');
    siguienteBoton.disabled = !siguiente;
    siguienteBoton.addEventListener('click', () => { if (siguiente) empezar(siguiente); });
    const ficha = $('.guia-cuerpo');
    capa.mostrar(l, {
      nombre: c.nombre,
      fotos: [c.miniaturaId, c.imagenId].filter(Boolean),
      alTocar: () => { ficha.open = true; },
    });
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
          await guardarGravedadAncla(sa.id, maquinaId, [gL.x, gL.y, gL.z]);
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
    get anclaActivaId() { return anclaId; },
    actualizar(_dt, arriba, ahora) {
      arribaActual = arriba;
      capa.actualizarEjes(arriba, anclaId ? seguidos.get(anclaId) : [...seguidos.values()].find((s) => s.visible && s.tipo === 'ancla-activa'));
      if (!anclaId && !cargando) {
        const vista = [...seguidos.values()].find((s) => s.visible && s.tipo === 'ancla-activa');
        if (vista) activar(vista.id);
      }
      if (posicionar) pintarPosicionar(arriba, ahora);
      if (!avisoRecorrido) return;
      const est = capa.actualizar(arriba, ahora, seguidos.get(anclaId));
      if (!est) return;
      const texto = est.error || (est.pendiente ? 'Preparando la marca del elemento…'
        : est.fiable ? textoTramo(est) + (est.fueraDeCamara ? ' · Marca fuera de cámara' : '')
          : est.esperandoAncla ? 'Apunta al QR del ancla.' : 'Guía en pausa. Vuelve a enfocar el QR.');
      avisoRecorrido.classList.toggle('aviso-recalibrar', !est.fiable);
      if (avisoRecorrido.textContent !== texto) avisoRecorrido.textContent = texto;
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
