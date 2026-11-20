import { botonVisor, direccionVisor, tieneVisorNativo } from './visor-nativo.js';
import { leerAjustes, guardarAjustes } from '../ajustes.js';

export function bloquePasoLidar({ puntos, info, anclaId, ladoCm, vista }) {
  const div = document.createElement('div');
  div.className = 'bloque-lidar-guia';
  if (!tieneVisorNativo() || !anclaId) {
    const nota = document.createElement('p');
    nota.className = 'nota';
    nota.textContent = !anclaId
      ? 'Abre el paso en InfoLens para cargar su QR de anclaje.'
      : 'Usa el iPhone con InfoLens Visor para abrir este recorrido.';
    div.appendChild(nota);
    return div;
  }
  div.innerHTML = `
    <label class="lidar-vista">Qué mostrar
      <select><option value="flechas">Ancla y flechas</option><option value="linea">Ancla y línea</option></select></label>
    <div class="lidar-nativo"></div>
    <p class="nota">Apunta al QR del ancla hasta que se fije el recorrido. Las flechas siguen la orientación del QR.</p>`;
  const selector = div.querySelector('select');
  selector.value = (vista ?? leerAjustes().lidarVista) === 'linea' ? 'linea' : 'flechas';
  const datosVisor = () => ({ puntos, info, anclaId, ladoCm, vista: selector.value });
  const enlace = botonVisor(datosVisor(), '📱 Abrir en el visor nativo');
  enlace.classList.remove('secundario');
  enlace.classList.add('grande', 'boton-lidar');
  div.querySelector('.lidar-nativo').appendChild(enlace);

  if (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches) {
    const safari = document.createElement('a');
    safari.className = 'boton secundario enlace-boton';
    safari.target = '_blank';
    safari.rel = 'noopener';
    safari.textContent = 'Abrir en Safari';
    const actualizarSafari = () => {
      const datos = JSON.stringify({ p: puntos, i: info, a: anclaId, l: ladoCm, v: selector.value });
      const base = import.meta.env?.BASE_URL ?? './';
      safari.href = new URL(`${base}#/ar?d=${encodeURIComponent(datos)}`, location.href).href;
    };
    actualizarSafari();
    selector.addEventListener('change', actualizarSafari);
    div.appendChild(safari);
  }

  selector.addEventListener('change', () => {
    guardarAjustes({ lidarVista: selector.value });
    enlace.href = direccionVisor(datosVisor());
  });
  return div;
}
