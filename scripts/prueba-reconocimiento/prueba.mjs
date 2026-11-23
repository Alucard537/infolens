import { cargarReconocedor, capturarImagen, huellaDe } from '../../src/reconocer/huella.js';
import { cargarSegmentador } from '../../src/reconocer/recorte-objeto.js';
import { anadirAHuella, comparar, coincidenciaClara, RECORTE_OBJETO } from '../../src/reconocer/vectores.js';

const terminar = (resultado) => window.webkit.messageHandlers.pruebaReconocimiento.postMessage(resultado);
const assert = (condicion, error) => { if (!condicion) throw new Error(error); };
try {
  let primera = true;
  const append = document.body.appendChild;
  document.body.appendChild = function (nodo) {
    if (primera && nodo.tagName === 'SCRIPT' && nodo.src.includes('/mediapipe/')) {
      primera = false;
      queueMicrotask(() => nodo.dispatchEvent(new Event('error')));
      return nodo;
    }
    return append.call(this, nodo);
  };
  const embedder = await cargarReconocedor();
  assert(!primera, 'No se ejercitó el reintento del cargador');
  document.body.appendChild = append;
  const segmentador = await cargarSegmentador();

  const dibujo = new Image();
  dibujo.src = '/ejemplo/valvula.svg';
  await dibujo.decode();
  const imagen = document.createElement('canvas');
  imagen.width = imagen.height = 520;
  const ctx = imagen.getContext('2d');
  const cuadro = (fondo) => {
    ctx.fillStyle = fondo;
    ctx.fillRect(0, 0, 520, 520);
    ctx.drawImage(dibujo, 110, 149, 300, 225);
  };
  cuadro('#29291e');
  const registro = capturarImagen(embedder, segmentador, imagen, 520, 520);
  assert(registro.v?.length > 0 && registro.v.every(Number.isFinite), 'La muestra no produjo huella: ' + registro.motivo);
  const guardada = anadirAHuella(null, 'TEST', [{v:registro.v, mini:await registro.mini}], 'fotos', RECORTE_OBJETO);
  cuadro('#4f6673');
  const consulta = huellaDe(embedder, imagen, 520, 520, {segmentador, conRecuadro:true});
  const candidatos = comparar(consulta, [guardada]);
  assert(coincidenciaClara(candidatos) === 'TEST', 'No reconoció la pieza con el fondo cambiado: ' + JSON.stringify(candidatos));
  terminar({ok:true, dimensiones:registro.v.length, parecido:candidatos[0].parecido, reintento:true});
} catch (error) {
  terminar({ok:false, error:error?.stack || String(error), causa:error?.cause?.message || ''});
}
