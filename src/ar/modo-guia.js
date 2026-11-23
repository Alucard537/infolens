import { obtenerArchivo } from '../db.js';
import { localizacionesDeAncla } from '../maquinas.js';
import { destinoDelPaso, textoTramo } from './guia-recorrido.js';

export function crearModoGuia({ capa, panel, seguidos, guia, maquinaId, abrirDetalle, abrirImagen, alSalir, pasoInicial = 0 }) {
  const total = guia.pasos.length;
  let paso = Math.min(Math.max(0, pasoInicial), total - 1);
  let activo = true;
  let iniciada = false;
  let terminada = false;
  let localizaciones = new Map();
  let detalle = null;
  let urls = [];
  let turnoMedios = 0;
  const cumplido = new Map();

  function estadoDe(indice) {
    if (!cumplido.has(indice)) cumplido.set(indice, { advertencia: false, comprobaciones: new Set(), confirmado: false });
    return cumplido.get(indice);
  }

  function puedeAvanzar() {
    const p = guia.pasos[paso], e = estadoDe(paso);
    return (!p.advertencia || e.advertencia) &&
      (p.comprobaciones || []).every((_, i) => e.comprobaciones.has(i)) &&
      (!p.confirmar || e.confirmado);
  }

  function limpiarMedios() {
    turnoMedios++;
    urls.forEach((url) => URL.revokeObjectURL(url));
    urls = [];
  }

  async function cargarMedios(ids, contenedor, tipo, titulo, turno) {
    for (const fid of ids || []) {
      const archivo = await obtenerArchivo(fid);
      if (!activo || turno !== turnoMedios) return;
      if (!archivo) continue;
      const url = URL.createObjectURL(archivo.blob);
      urls.push(url);
      if (tipo === 'imagen') {
        const b = document.createElement('button');
        b.className = 'guia-foto';
        b.setAttribute('aria-label', 'Ampliar foto del paso');
        const img = document.createElement('img');
        img.alt = '';
        img.src = url;
        b.appendChild(img);
        b.addEventListener('click', () => abrirImagen(url, titulo));
        contenedor.appendChild(b);
      } else {
        const video = document.createElement('video');
        video.className = 'guia-video';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = url;
        contenedor.appendChild(video);
      }
      contenedor.hidden = false;
    }
  }

  function pintarPaso() {
    limpiarMedios();
    const p = guia.pasos[paso];
    const e = estadoDe(paso);
    const elemento = guia.elementos.get(p.elementoId);
    const titulo = p.titulo || elemento?.nombre || `Paso ${paso + 1}`;
    const destino = destinoDelPaso(p, localizaciones);
    panel.innerHTML = `
      <div class="guia-cab">
        <div class="guia-contexto"><span class="guia-nombre"></span><span class="guia-paso"></span></div>
        <button class="boton-mini" data-g="plegar" aria-controls="guia-instrucciones"></button>
      </div>
      <h2 class="guia-titulo"></h2>
      <p class="guia-referencia"></p>
      <p class="nota guia-ar"></p>
      <div id="guia-instrucciones" class="guia-cuerpo"></div>
      <div class="guia-nav">
        <button class="boton secundario" data-g="ant">‹ Anterior</button>
        <button class="boton" data-g="sig"></button>
      </div>`;
    const $ = (selector) => panel.querySelector(selector);
    $('.guia-nombre').textContent = guia.nombre;
    $('.guia-paso').textContent = `Paso ${paso + 1} de ${total}`;
    $('.guia-titulo').textContent = titulo;
    const ref = $('.guia-referencia');
    ref.textContent = elemento ? [elemento.nombre === titulo ? '' : elemento.nombre, elemento.referencia].filter(Boolean).join(' · ') : '';
    ref.hidden = !ref.textContent;
    const mostrarMarcas = p.flechas !== false || p.icono !== false;
    const avisoFijo = !destino
      ? (elemento ? `Falta la posición de este elemento para «${guia.anclaNombre || guia.anclaId}». Añádela en Localizaciones o en los tramos del paso.` : 'Paso de instrucciones')
      : (!mostrarMarcas ? 'Activa las flechas o el icono en la edición de este paso.' : null);
    detalle = { avisoFijo, conIcono: p.icono !== false, info: $('.guia-ar') };
    detalle.info.textContent = avisoFijo ?? 'Preparando la marca del elemento…';

    const cuerpo = $('.guia-cuerpo');
    const plegar = $('[data-g="plegar"]');
    function instrucciones(abiertas) {
      cuerpo.hidden = !abiertas;
      plegar.setAttribute('aria-expanded', String(abiertas));
      plegar.textContent = abiertas ? 'Ocultar' : 'Detalles';
    }
    plegar.addEventListener('click', () => instrucciones(cuerpo.hidden));
    const ant = $('[data-g="ant"]'), sig = $('[data-g="sig"]');
    ant.disabled = paso === 0;
    sig.textContent = paso === total - 1 ? 'Finalizar guía' : 'Siguiente ›';
    function actualizarBoton() {
      sig.disabled = !puedeAvanzar();
      sig.title = sig.disabled ? 'Completa las comprobaciones de este paso' : '';
    }
    ant.addEventListener('click', () => { if (paso > 0) { paso--; pintarPaso(); } });
    sig.addEventListener('click', () => {
      if (!puedeAvanzar()) return;
      if (paso === total - 1) finalizar();
      else { paso++; pintarPaso(); }
    });

    if (p.texto) {
      const texto = document.createElement('p');
      texto.className = 'guia-texto';
      texto.textContent = p.texto;
      cuerpo.appendChild(texto);
    }
    if (elemento) {
      const ficha = document.createElement('div');
      ficha.className = 'guia-ficha';
      if (elemento.descripcion) {
        const desc = document.createElement('p');
        desc.className = 'nota';
        desc.textContent = elemento.descripcion;
        ficha.appendChild(desc);
      }
      const b = document.createElement('button');
      b.className = 'boton-mini';
      b.textContent = 'Ver ficha completa';
      b.addEventListener('click', () => abrirDetalle(elemento.id));
      ficha.appendChild(b);
      cuerpo.appendChild(ficha);
    }
    if (p.advertencia) {
      const a = document.createElement('div');
      a.className = 'guia-advertencia';
      a.innerHTML = '<div class="guia-adv-titulo">⚠️ Seguridad</div><p></p><label class="fila check"><input type="checkbox"> He leído y aplico estas medidas de seguridad</label>';
      a.querySelector('p').textContent = p.advertencia;
      const cb = a.querySelector('input');
      cb.checked = e.advertencia;
      cb.addEventListener('change', () => { e.advertencia = cb.checked; actualizarBoton(); });
      cuerpo.appendChild(a);
    }
    if (p.comprobaciones?.length) {
      const c = document.createElement('div');
      c.className = 'guia-comprobaciones';
      c.innerHTML = '<div class="guia-adv-titulo">Comprobaciones</div>';
      p.comprobaciones.forEach((texto, i) => {
        const label = document.createElement('label');
        label.className = 'fila check';
        label.innerHTML = '<input type="checkbox"><span></span>';
        label.querySelector('span').textContent = texto;
        const cb = label.querySelector('input');
        cb.checked = e.comprobaciones.has(i);
        cb.addEventListener('change', () => {
          if (cb.checked) e.comprobaciones.add(i); else e.comprobaciones.delete(i);
          actualizarBoton();
        });
        c.appendChild(label);
      });
      cuerpo.appendChild(c);
    }
    if (p.confirmar) {
      const b = document.createElement('button');
      b.className = 'boton boton-fijar';
      const pintar = () => { b.textContent = e.confirmado ? '✓ Paso completado' : 'Marcar el paso como completado'; };
      pintar();
      b.addEventListener('click', () => { e.confirmado = !e.confirmado; pintar(); actualizarBoton(); });
      cuerpo.appendChild(b);
    }
    for (const [ids, tipo] of [[p.imagenes, 'imagen'], [p.videos, 'video']]) {
      if (!ids?.length) continue;
      const medios = document.createElement('div');
      medios.className = tipo === 'imagen' ? 'guia-medios' : 'guia-videos';
      medios.hidden = true;
      cuerpo.appendChild(medios);
      cargarMedios(ids, medios, tipo, titulo, turnoMedios).catch((error) => console.warn('Medios de la guía:', error));
    }
    plegar.hidden = !cuerpo.children.length;
    instrucciones(!!(p.texto || p.advertencia || p.comprobaciones?.length || p.confirmar));
    actualizarBoton();

    if (destino && mostrarMarcas) {
      capa.mostrar(destino, {
        conFlechas: p.flechas !== false, conIcono: p.icono !== false,
        nombre: elemento?.nombre || titulo,
        fotos: [elemento?.miniaturaId, elemento?.imagenId, p.imagenes?.[0]].filter(Boolean),
        alTocar: elemento ? () => instrucciones(true) : null,
      });
    } else capa.ocultar();
  }

  function finalizar() {
    terminada = true;
    limpiarMedios();
    capa.ocultar();
    panel.innerHTML = '<div class="rec-titulo"></div><p class="nota"></p><button class="boton">Volver</button>';
    panel.querySelector('.rec-titulo').textContent = `Guía finalizada · ${guia.nombre}`;
    panel.querySelector('p').textContent = pasoInicial > 0 ? 'Has llegado al final de la guía.' : `Has completado los ${total} pasos.`;
    panel.querySelector('button').addEventListener('click', alSalir);
  }

  panel.classList.add('tarjeta-recorrido');
  panel.innerHTML = '<p class="rec-msg"></p>';
  panel.querySelector('p').textContent = `Apunta al QR del ancla «${guia.anclaNombre || guia.anclaId}».`;
  panel.hidden = false;

  return {
    get anclaActivaId() { return guia.anclaId; },
    actualizar(_dt, arriba, ahora) {
      if (terminada) return;
      const sa = seguidos.get(guia.anclaId);
      capa.actualizarEjes(arriba, sa);
      if (!iniciada && sa?.visible && sa.tipo === 'ancla-activa') {
        iniciada = true;
        localizacionesDeAncla(maquinaId, guia.anclaId).then((locs) => {
          if (!activo) return;
          localizaciones = new Map(locs.map((l) => [l.elementoId, l]));
          pintarPaso();
        }).catch((error) => {
          if (activo) panel.querySelector('p').textContent = 'No se pudieron cargar las localizaciones.';
          console.warn('Localizaciones de la guía:', error);
        });
      }
      if (!detalle || detalle.avisoFijo !== null) return;
      const { info, conIcono } = detalle;
      const est = capa.actualizar(arriba, ahora, sa);
      let texto = '';
      if (est?.error) texto = est.error;
      else if (est?.pendiente) texto = 'Preparando la marca del elemento…';
      else if (est?.fiable) {
        texto = textoTramo(est);
        if (!conIcono) texto += ' · Icono del elemento desactivado';
        else if (est.fueraDeCamara) texto += ' · Marca fuera de cámara';
      } else if (est) texto = est.esperandoAncla ? 'Apunta al QR del ancla' : 'Guía en pausa. Vuelve a enfocar el QR.';
      info.classList.toggle('aviso-recalibrar', !!(est?.error || est?.fiable === false));
      if (info.textContent !== texto) info.textContent = texto;
      info.hidden = !texto;
    },
    etiquetas(g) { capa.etiquetas(g); },
    tocado(raycaster) { return capa.tocado(raycaster); },
    detener() {
      activo = false;
      limpiarMedios();
      capa.ocultar();
    },
  };
}
