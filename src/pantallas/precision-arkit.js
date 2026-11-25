import { leerAjustes } from '../ajustes.js';
import { aG, deG, describir } from '../coordenadas.js';
import { listarAnclas, maquinaActiva } from '../maquinas.js';
import { ladoPrincipalValido, ladoQRAncla, subanclasDe } from '../subanclas.js';
import { enviarARKit, referenciasDelAncla, tieneARKitIntegrado } from '../ar/visor-nativo.js';
import { puntoDeGuiaValido } from '../ar/guia-recorrido.js';

const ejes = [
  ['adelante', 'atrás', 'Profundidad'],
  ['derecha', 'izquierda', 'Desplazamiento lateral'],
  ['arriba', 'abajo', 'Altura'],
];
const formato = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const cm = (n) => `${formato.format(Math.abs(n))} cm`;

export function montarPrecisionARKit(cont, elegirMaquina) {
  let activo = true;
  let anclas = [];
  let pendiente = null;
  const pruebas = new Map();
  cont.className = 'bloque-archivo formulario precision-arkit';
  cont.innerHTML = `
    <h2>Medir precisión de ARKit</h2>
    <p class="nota precision-estado" role="status">Cargando anclas…</p>
    <button type="button" class="boton secundario precision-maquina" hidden>Elegir máquina</button>
    <form hidden novalidate>
      <fieldset>
        <label>QR principal<select name="principal"></select></label>
        <label>Subancla de comprobación<select name="subancla"></select></label>
        <div class="precision-medidas">
          <label>Ancho del QR principal (cm)<input name="anchoPrincipal" inputmode="decimal" maxlength="16"></label>
          <label>Ancho del QR de la subancla (cm)<input name="anchoSubancla" inputmode="decimal" maxlength="16"></label>
        </div>
        <p class="nota">Mide el ancho impreso de cada código, sin el margen blanco.</p>
        <h3>Medidas de referencia</h3>
        <p class="nota">Con una cinta métrica, mide del centro del QR principal al centro de la subancla por cada eje.
          Usa los mismos sentidos que en la guía. Deja en blanco los ejes sin desplazamiento.</p>
        <div class="precision-ejes">
          ${ejes.map(([positivo, negativo, titulo]) => `
            <div>
              <label>${titulo}<select aria-label="Dirección de ${titulo.toLowerCase()}" name="${positivo}Sentido">
                <option value="1">${positivo}</option><option value="-1">${negativo}</option>
              </select></label>
              <label>Distancia (cm)<input aria-label="${titulo} en centímetros" name="${positivo}" inputmode="decimal" maxlength="16" placeholder="0"></label>
            </div>`).join('')}
        </div>
        <button type="submit" class="boton grande precision-medir">Medir con ARKit</button>
      </fieldset>
    </form>
    <p class="error-form precision-error" role="alert" hidden></p>
    <section class="precision-resultado" aria-label="Resultados de precisión" aria-live="polite" hidden>
      <h3>Última medición</h3>
      <p class="precision-error-total"></p>
      <dl>
        <div><dt>Distancia de referencia</dt><dd class="precision-referencia"></dd></div>
        <div><dt>Distancia medida por ARKit</dt><dd class="precision-distancia"></dd></div>
        <div><dt>Desvío por dirección</dt><dd class="precision-desvio"></dd></div>
      </dl>
      <p class="nota precision-resumen"></p>
    </section>`;

  const $ = (s) => cont.querySelector(s);
  const formulario = $('form');
  const campos = formulario.elements;
  const medir = $('.precision-medir');
  const estado = $('.precision-estado');
  const resultado = $('.precision-resultado');
  const botonMaquina = $('.precision-maquina');
  const error = $('.precision-error');
  const principal = () => anclas.find((a) => a.id === campos.principal.value);
  const subancla = () => subanclasDe(principal() ?? {}).find((s) => s.id === campos.subancla.value);
  const errorVisible = (mensaje = '') => { error.textContent = mensaje; error.hidden = !mensaje; };
  const numero = (campo, defecto = NaN) => {
    const texto = campo.value.trim();
    if (!texto) return defecto;
    return /^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(texto) ? Number(texto.replace(',', '.')) : NaN;
  };

  function configuracion() {
    const a = principal(), s = subancla();
    const anchoPrincipal = numero(campos.anchoPrincipal), anchoSubancla = numero(campos.anchoSubancla);
    if (!a || !s) throw new Error('Elige el QR principal y una subancla.');
    if (!ladoPrincipalValido(anchoPrincipal) || !(anchoSubancla >= 2 && anchoSubancla <= 16)) {
      throw new Error('Revisa el ancho impreso. El QR principal admite 1 a 200 cm y el de la subancla admite 2 a 16 cm.');
    }
    const medidas = Object.fromEntries(ejes.map(([eje]) => [eje, numero(campos[eje], 0) * Number(campos[eje + 'Sentido'].value)]));
    const pos = aG(medidas);
    if (!puntoDeGuiaValido(pos) || !pos.some((n) => n !== 0)) {
      throw new Error('Introduce una distancia de referencia distinta de cero, en centímetros y sin signos.');
    }
    return { a, s, anchoPrincipal, anchoSubancla, pos, clave: JSON.stringify([a.id, s.id, anchoPrincipal, anchoSubancla, pos]) };
  }

  function pintarPruebas(datos) {
    const medidas = pruebas.get(datos?.clave);
    resultado.hidden = !medidas?.length;
    medir.textContent = resultado.hidden ? 'Medir con ARKit' : 'Repetir prueba';
    if (resultado.hidden) return;
    const ultima = medidas.at(-1);
    const desvio = ultima.map((n, i) => n - datos.pos[i]);
    const errores = medidas.map((pos) => Math.hypot(...pos.map((n, i) => n - datos.pos[i])) * 100);
    const promedio = errores.reduce((total, n) => total + n, 0) / errores.length;
    $('.precision-error-total').textContent = `Error de posición: ${cm(errores.at(-1))}`;
    $('.precision-referencia').textContent = cm(Math.hypot(...datos.pos) * 100);
    $('.precision-distancia').textContent = cm(Math.hypot(...ultima) * 100);
    const direcciones = deG(desvio);
    $('.precision-desvio').textContent = Object.values(direcciones).some(Boolean) ? describir(direcciones) : '0 cm';
    $('.precision-resumen').textContent =
      `${medidas.length} ${medidas.length === 1 ? 'prueba' : 'pruebas'} · Error medio: ${cm(promedio)} · Mayor error: ${cm(Math.max(...errores))}`;
  }

  function cambiarMedidas() {
    errorVisible();
    let datos;
    try { datos = configuracion(); } catch { /* Se valida al iniciar. */ }
    pintarPruebas(datos);
  }

  function cambiarSubancla() {
    const s = subancla();
    campos.anchoSubancla.value = s ? String(s.ladoCm).replace('.', ',') : '';
    for (const [eje] of ejes) {
      campos[eje].value = '';
      campos[eje + 'Sentido'].value = '1';
    }
    cambiarMedidas();
  }

  function cambiarPrincipal() {
    const a = principal();
    campos.anchoPrincipal.value = String(ladoQRAncla(a, leerAjustes().qrCm)).replace('.', ',');
    campos.subancla.replaceChildren(...subanclasDe(a ?? {}).map((s) => new Option(s.nombre, s.id)));
    cambiarSubancla();
  }

  async function preparar() {
    if (!tieneARKitIntegrado()) {
      estado.textContent = 'Abre InfoLens en el iPhone para realizar esta prueba con ARKit.';
      return;
    }
    const maquina = await maquinaActiva();
    if (!activo) return;
    if (!maquina) {
      estado.textContent = 'Elige la máquina cuyos QR quieres comprobar.';
      botonMaquina.hidden = false;
      return;
    }
    anclas = (await listarAnclas(maquina.id)).filter((a) => subanclasDe(a).length);
    if (!activo) return;
    botonMaquina.hidden = false;
    if (!anclas.length) {
      estado.textContent = `${maquina.nombre} necesita un QR principal y al menos una subancla configurada. Puedes añadirla en Gestión de anclas.`;
      return;
    }
    estado.textContent = maquina.nombre;
    campos.principal.replaceChildren(...anclas.map((a) => new Option(a.nombre, a.id)));
    cambiarPrincipal();
    formulario.hidden = false;
  }

  botonMaquina.addEventListener('click', elegirMaquina);
  campos.principal.addEventListener('change', cambiarPrincipal);
  campos.subancla.addEventListener('change', cambiarSubancla);
  formulario.addEventListener('input', (event) => {
    if (event.target !== campos.principal && event.target !== campos.subancla) cambiarMedidas();
  });
  formulario.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pendiente) return;
    try {
      const datos = configuracion();
      const { a, s, anchoPrincipal, anchoSubancla } = datos;
      const anclasDePrueba = referenciasDelAncla({ ...a, ladoCm: anchoPrincipal }, anchoPrincipal, [{ ...s, ladoCm: anchoSubancla }]);
      const solicitud = crypto.randomUUID();
      pendiente = { solicitud, datos };
      formulario.querySelector('fieldset').disabled = true;
      botonMaquina.disabled = true;
      errorVisible();
      enviarARKit({ accion: 'calibrarSubancla', solicitud, anclas: anclasDePrueba, diagnostico: true });
    } catch (e) {
      desbloquear();
      errorVisible(e.message);
    }
  });

  function desbloquear() {
    pendiente = null;
    formulario.querySelector('fieldset').disabled = false;
    botonMaquina.disabled = false;
  }

  function recibir({ detail }) {
    if (!pendiente || detail?.solicitud !== pendiente.solicitud) return;
    const { datos } = pendiente;
    desbloquear();
    if (detail.error) { errorVisible(detail.error); return; }
    if (detail.medicion == null) return;
    if (!puntoDeGuiaValido(detail.medicion.pos)) { errorVisible('ARKit devolvió una medición inválida. Repite la prueba.'); return; }
    const medidas = pruebas.get(datos.clave) ?? [];
    medidas.push(detail.medicion.pos);
    pruebas.set(datos.clave, medidas);
    pintarPruebas(datos);
    resultado.scrollIntoView({ block: 'nearest' });
  }

  window.addEventListener('infolens:calibracion', recibir);
  preparar().catch((e) => { if (activo) errorVisible(e.message); });
  return () => {
    activo = false;
    window.removeEventListener('infolens:calibracion', recibir);
    if (pendiente) enviarARKit({ accion: 'cancelarCalibracion', solicitud: pendiente.solicitud });
  };
}
