// Ejecución de una GUÍA en realidad aumentada (localización o mantenimiento).
// 1. Pide escanear el QR del ancla de la guía (de la máquina activa).
// 2. Va paso a paso: instrucciones, fotos, vídeos, advertencias, comprobaciones y confirmación.
//    Solo se muestran las flechas y el icono del paso actual.
// 3. Para avanzar hay que cumplir lo que pida el paso (aceptar la advertencia, marcar comprobaciones,
//    confirmar). Una guía no sustituye al procedimiento técnico autorizado ni a las medidas de seguridad.
import { obtenerArchivo } from '../db.js';
import { localizacionesDeAncla, TIPOS_GUIA } from '../maquinas.js';
import { hayQuickLook, crearEnlaceAR } from './boton-ar.js';
import { gravedadEnQR } from './navegacion.js';
import { deG, describir } from '../coordenadas.js';

const fmtM = (m) => m.toFixed(1).replace('.', ',');

export function crearModoGuia({ capa, panel, seguidos, guia, maquinaId, abrirDetalle, abrirImagen, alSalir, ladoCm = () => 10 }) {
  let iniciada = false;
  let paso = 0;
  let locs = new Map();           // elementoId -> localización (de ESTA máquina y ESTA ancla)
  let terminada = false;
  const urls = [];
  const cumplido = new Map();     // índice de paso -> { advertencia, comprobaciones:Set, confirmado }
  let infoAR = null;              // texto de estado del recorrido del paso
  let plegado = false;

  const url = async (fid) => {
    const a = fid && (await obtenerArchivo(fid));
    if (!a) return null;
    const u = URL.createObjectURL(a.blob);
    urls.push(u);
    return u;
  };

  const estadoDe = (i) => {
    if (!cumplido.has(i)) cumplido.set(i, { advertencia: false, comprobaciones: new Set(), confirmado: false });
    return cumplido.get(i);
  };
  const puedeAvanzar = (i) => {
    const p = guia.pasos[i], e = estadoDe(i);
    if (p.advertencia && !e.advertencia) return false;
    if ((p.comprobaciones || []).some((_, k) => !e.comprobaciones.has(k))) return false;
    if (p.confirmar && !e.confirmado) return false;
    return true;
  };

  function esperarAncla() {
    panel.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'rec-titulo';
    t.textContent = `📘 ${guia.nombre}`;
    panel.appendChild(t);
    const p = document.createElement('p');
    p.className = 'rec-msg';
    p.textContent = `Apunta al QR del ancla "${guia.anclaNombre || guia.anclaId}" para empezar la guía.`;
    panel.appendChild(p);
    const b = document.createElement('button');
    b.className = 'boton secundario';
    b.textContent = '✕ Salir de la guía';
    b.addEventListener('click', alSalir);
    panel.appendChild(b);
  }

  async function pintarPaso() {
    const p = guia.pasos[paso];
    const total = guia.pasos.length;
    const e = estadoDe(paso);
    panel.innerHTML = '';
    panel.classList.toggle('plegado', plegado);
    // Cabecera
    const cab = document.createElement('div');
    cab.className = 'guia-cab';
    cab.innerHTML = '<div><div class="guia-nombre"></div><div class="guia-paso"></div><p class="nota guia-ar"></p></div><button class="boton-mini" data-g="plegar"></button>';
    cab.querySelector('.guia-nombre').textContent = `📘 ${guia.nombre}`;
    cab.querySelector('.guia-paso').textContent = `Paso ${paso + 1} de ${total} · ${TIPOS_GUIA[guia.tipo] || ''}`;
    cab.querySelector('[data-g="plegar"]').textContent = plegado ? '▴ Ver instrucciones' : '▾ Ocultar';
    cab.querySelector('[data-g="plegar"]').addEventListener('click', () => { plegado = !plegado; pintarPaso(); });
    panel.appendChild(cab);
    const cuerpo = document.createElement('div');
    cuerpo.className = 'guia-cuerpo';
    panel.appendChild(cuerpo);
    // Recorrido con LiDAR (AR de Apple anclado al QR del ancla): las flechas siguen fijas al andar
    if (p._destinoAR && p.flechas !== false && (hayQuickLook() || /iPhone|iPad|iPod/.test(navigator.userAgent))) {
      const b = document.createElement('button');
      b.className = 'boton boton-lidar';
      b.textContent = '🧭 Ver este paso con LiDAR (recomendado)';
      b.addEventListener('click', () => { location.hash = `#/guia-lidar/${encodeURIComponent(guia.id)}?paso=${paso}`; });
      cuerpo.appendChild(b);
    }
    // Título e instrucciones
    const h = document.createElement('h3');
    h.className = 'guia-titulo';
    h.textContent = p.titulo || (p.elementoId && p.elemento ? `Localizar: ${p.elemento.nombre}` : `Paso ${paso + 1}`);
    cuerpo.appendChild(h);
    infoAR = cab.querySelector('.guia-ar');
    if (p.elemento) {
      const c = document.createElement('div');
      c.className = 'guia-componente';
      c.innerHTML = '<b></b><span></span><button class="boton-mini">ℹ️ Ficha</button>';
      c.querySelector('b').textContent = p.elemento.nombre;
      c.querySelector('span').textContent = ` · ${p.elemento.referencia}`;
      c.querySelector('button').addEventListener('click', () => abrirDetalle(p.elemento.id));
      cuerpo.appendChild(c);
    }
    if (p.texto) {
      const t = document.createElement('p');
      t.className = 'guia-texto';
      t.textContent = p.texto;
      cuerpo.appendChild(t);
    }
    // Fotos y vídeos
    if ((p.imagenes || []).length) {
      const fila = document.createElement('div');
      fila.className = 'guia-medios';
      for (const fid of p.imagenes) {
        const u = await url(fid);
        if (!u) continue;
        const b = document.createElement('button');
        b.className = 'guia-foto';
        b.innerHTML = '<img alt="">';
        b.querySelector('img').src = u;
        b.addEventListener('click', () => abrirImagen(u, h.textContent));
        fila.appendChild(b);
      }
      cuerpo.appendChild(fila);
    }
    for (const fid of p.videos || []) {
      const u = await url(fid);
      if (!u) continue;
      const vid = document.createElement('video');
      vid.className = 'guia-video';
      vid.src = u; vid.controls = true; vid.playsInline = true; vid.preload = 'metadata';
      cuerpo.appendChild(vid);
    }
    // Advertencia de seguridad (hay que aceptarla para continuar)
    if (p.advertencia) {
      const a = document.createElement('div');
      a.className = 'guia-advertencia';
      a.innerHTML = '<div class="guia-adv-titulo">⚠️ Seguridad</div><p></p><label class="fila check"><input type="checkbox"> He leído y aplico estas medidas de seguridad</label>';
      a.querySelector('p').textContent = p.advertencia;
      const cb = a.querySelector('input');
      cb.checked = e.advertencia;
      cb.addEventListener('change', () => { e.advertencia = cb.checked; actualizarBotones(); });
      cuerpo.appendChild(a);
    }
    // Comprobaciones
    if ((p.comprobaciones || []).length) {
      const c = document.createElement('div');
      c.className = 'guia-comprobaciones';
      c.innerHTML = '<div class="guia-adv-titulo">☑️ Comprobaciones</div>';
      p.comprobaciones.forEach((texto, k) => {
        const l = document.createElement('label');
        l.className = 'fila check';
        l.innerHTML = '<input type="checkbox"> <span></span>';
        l.querySelector('span').textContent = texto;
        const cb = l.querySelector('input');
        cb.checked = e.comprobaciones.has(k);
        cb.addEventListener('change', () => { if (cb.checked) e.comprobaciones.add(k); else e.comprobaciones.delete(k); actualizarBotones(); });
        c.appendChild(l);
      });
      cuerpo.appendChild(c);
    }
    // Confirmación
    if (p.confirmar) {
      const b = document.createElement('button');
      b.className = 'boton boton-fijar';
      const pintar = () => { b.textContent = e.confirmado ? '✅ Paso completado' : '✔ Marcar el paso como completado'; };
      pintar();
      b.addEventListener('click', () => { e.confirmado = !e.confirmado; pintar(); actualizarBotones(); });
      cuerpo.appendChild(b);
    }
    // Navegación
    const nav = document.createElement('div');
    nav.className = 'guia-nav';
    nav.innerHTML = '<button class="boton secundario" data-g="ant">‹ Anterior</button><button class="boton" data-g="sig"></button>';
    nav.querySelector('[data-g="ant"]').disabled = paso === 0;
    nav.querySelector('[data-g="ant"]').addEventListener('click', () => { paso--; cargarPaso(); });
    const sig = nav.querySelector('[data-g="sig"]');
    sig.textContent = paso === total - 1 ? '🏁 Finalizar guía' : 'Siguiente ›';
    sig.addEventListener('click', () => {
      if (!puedeAvanzar(paso)) return;
      if (paso === total - 1) finalizar(); else { paso++; cargarPaso(); }
    });
    panel.appendChild(nav);
    const salir = document.createElement('button');
    salir.className = 'quitar';
    salir.textContent = 'Salir de la guía';
    salir.addEventListener('click', () => { if (confirm('¿Salir de la guía?')) alSalir(); });
    panel.appendChild(salir);
    actualizarBotones();
    panel.scrollTop = 0;
  }

  function actualizarBotones() {
    const sig = panel.querySelector('[data-g="sig"]');
    if (!sig) return;
    const ok = puedeAvanzar(paso);
    sig.disabled = !ok;
    sig.title = ok ? '' : 'Completa lo que pide el paso para continuar';
  }

  function cargarPaso() {
    const p = guia.pasos[paso];
    p.elemento = p.elementoId ? guia.elementos.get(p.elementoId) || null : null;
    const propios = Array.isArray(p.rutaPropia) && p.rutaPropia.length ? p.rutaPropia : null;
    // ¿Adónde se va en este paso? Por orden:
    //  1. los TRAMOS del paso (desde el QR del ancla): el destino es el final del último tramo
    //  2. una posición final suelta (guías antiguas)
    //  3. la localización guardada del componente respecto al ancla de la guía
    let destino = null, origen = '';
    if (propios) { destino = { pos: propios[propios.length - 1], ruta: propios.slice(0, -1), posIcono: null }; origen = `${propios.length} tramo(s) del paso`; }
    else if (Array.isArray(p.destinoPropio)) { destino = { pos: p.destinoPropio, ruta: [], posIcono: null }; origen = 'posición final del paso'; }
    else if (p.elementoId && locs.get(p.elementoId)) { destino = locs.get(p.elementoId); origen = 'localización del componente'; }
    const flechas = p.flechas !== false, icono = p.icono !== false; // por defecto, sí
    p.diagnostico = destino ? `destino: ${describir(deG(destino.pos))} desde el QR (${origen})` : null;
    p.sinFlechas = !!destino && !flechas;
    p._destinoAR = destino;
    if (destino && (flechas || icono)) {
      capa.mostrar(destino, {
        conFlechas: flechas, conIcono: icono,
        titulo: p.elemento ? p.elemento.nombre : (p.titulo || `Paso ${paso + 1}`),
        subtitulo: p.elemento ? `${p.elemento.referencia} · ${p.elemento.id}` : '',
        descripcion: p.elemento && guia.tipo === 'localizacion' ? p.elemento.descripcion || '' : '',
        alTocar: p.elemento ? () => abrirDetalle(p.elemento.id) : null,
      });
      p.sinLocalizacion = false;
    } else {
      capa.ocultar();
      p.sinLocalizacion = !!p.elementoId && !destino;
    }
    pintarPaso();
  }

  function finalizar() {
    terminada = true;
    capa.ocultar();
    panel.classList.remove('plegado');
    panel.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'rec-titulo';
    t.textContent = `🏁 Guía finalizada: ${guia.nombre}`;
    panel.appendChild(t);
    const p = document.createElement('p');
    p.className = 'nota';
    p.textContent = `Has completado los ${guia.pasos.length} pasos.`;
    panel.appendChild(p);
    const b = document.createElement('button');
    b.className = 'boton';
    b.textContent = 'Volver';
    b.addEventListener('click', alSalir);
    panel.appendChild(b);
  }

  esperarAncla();
  panel.hidden = false;

  return {
    actualizar(dt, arriba, ahora) {
      if (terminada) return;
      const sa = seguidos.get(guia.anclaId);
      capa.actualizarEjes(arriba, sa);
      // Cómo está colocado el QR del ancla (pared, mesa…): se mide con el sensor la primera vez que se ve
      if (sa && sa.visible && !guia.anclaGravedad) {
        const gL = gravedadEnQR(sa.rot, arriba);
        guia.anclaGravedad = [gL.x, gL.y, gL.z];
      }
      if (!iniciada && sa && sa.visible && sa.tipo === 'ancla-activa') {
        iniciada = true;
        localizacionesDeAncla(maquinaId, guia.anclaId).then((l) => {
          locs = new Map(l.map((x) => [x.elementoId, x]));
          cargarPaso();
        });
      }
      if (!iniciada || !infoAR) return;
      const p = guia.pasos[paso];
      const est = capa.actualizar(dt, arriba, ahora, sa);
      if (p.sinFlechas) {
        infoAR.className = 'nota guia-ar aviso-recalibrar';
        infoAR.textContent = '⚠️ Este paso tiene las flechas desactivadas: márcalas en el editor de la guía (casilla "Mostrar flechas 3D").';
      } else if (p.sinLocalizacion) {
        infoAR.textContent = 'Este componente no tiene localización respecto al ancla de la guía (ni posición final propia en el paso).';
      } else if (!est) {
        infoAR.textContent = p.elementoId || p.diagnostico ? '' : 'Este paso no tiene destino: solo instrucciones.';
      } else if (est.esperandoAncla) {
        infoAR.textContent = 'Apunta al QR del ancla para ver el recorrido.';
      } else {
        infoAR.className = 'nota guia-ar' + (est.fiable ? '' : ' aviso-recalibrar');
        infoAR.textContent = est.fiable
          ? `🧭 Sigue las flechas · a ${fmtM(est.distancia)} m${p.diagnostico ? ' · ' + p.diagnostico : ''}`
          : '⚠️ Precisión perdida: vuelve a apuntar al QR del ancla para recalibrar.';
      }
    },
    etiquetas(g) { capa.etiquetas(g); },
    tocado(raycaster) { return capa.tocado(raycaster); },
    detener() {
      capa.ocultar();
      urls.forEach((u) => URL.revokeObjectURL(u));
    },
  };
}
