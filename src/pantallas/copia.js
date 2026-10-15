// Pantalla "Copia de seguridad": exportar e importar todo en un .zip.
import { exportarCopia, importarCopia, nombreArchivoCopia, espacioUsado } from '../copia.js';
import { contarElementos } from '../db.js';
import { leerAjustes } from '../ajustes.js';
import { guardarOCompartir } from '../ui/descargar.js';

const fmtMB = (b) => (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
const fmtFecha = (t) => new Date(t).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });

export function pantallaCopia(app, { volver, irImportarExcel }) {
  let activo = true;
  let copiaLista = null;

  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>Copia de seguridad</h1>
      <div class="tarjeta-info">
        <div>Elementos: <b class="n-elementos">…</b></div>
        <div>Espacio usado: <b class="espacio">…</b></div>
        <div>Última copia: <b class="ultima">…</b></div>
      </div>

      <h2>📤 Exportar</h2>
      <p class="nota">Guarda todos los elementos con sus fotos, PDF y modelos 3D en un único archivo .zip.
        Sirve como copia de seguridad y para pasar los datos del PC al iPhone (o al revés).</p>
      <button class="boton" data-accion="preparar">📦 Crear copia (.zip)</button>
      <button class="boton" data-accion="guardar" hidden>💾 Guardar / enviar la copia</button>

      <h2>📥 Importar</h2>
      <p class="nota">Elige un .zip creado con "Exportar" (en este dispositivo o en otro).</p>
      <fieldset class="tipo">
        <label class="opcion"><input type="radio" name="modo" value="combinar" checked> Añadir y actualizar</label>
        <label class="opcion"><input type="radio" name="modo" value="sustituir"> Sustituir todo</label>
      </fieldset>
      <p class="nota modo-ayuda"></p>
      <label class="boton">📂 Elegir copia .zip e importar
        <input type="file" accept=".zip,application/zip,application/x-zip-compressed" class="entrada-oculta" data-entrada="zip"></label>

      <div class="progreso" hidden><div class="progreso-texto"></div><div class="barra"><div class="barra-relleno"></div></div></div>
      <p class="error-form" hidden></p>
      <p class="ok-form" hidden></p>

      <h2>🖥️ Desde el PC</h2>
      <p class="nota">¿Tienes los datos en un Excel? En el PC puedes importarlos todos de golpe y luego pasar la copia al iPhone.</p>
      <button class="boton secundario" data-accion="excel">📊 Importar desde Excel</button>
    </div>`;

  const $ = (s) => app.querySelector(s);
  $('.volver').addEventListener('click', volver);
  $('[data-accion="excel"]').addEventListener('click', irImportarExcel);

  const ayudaModo = () => {
    const m = app.querySelector('[name="modo"]:checked').value;
    $('.modo-ayuda').textContent = m === 'combinar'
      ? 'Añade los elementos nuevos y actualiza los que tengan el mismo ID. No borra nada de lo que ya tienes.'
      : '⚠️ Este dispositivo quedará exactamente igual que la copia: se borrarán los elementos que no estén en ella.';
  };
  app.querySelectorAll('[name="modo"]').forEach((r) => r.addEventListener('change', ayudaModo));
  ayudaModo();

  async function refrescarInfo() {
    const [n, esp] = await Promise.all([contarElementos(), espacioUsado()]);
    if (!activo) return;
    $('.n-elementos').textContent = n;
    $('.espacio').textContent = esp ? fmtMB(esp.usado) : 'desconocido';
    const u = leerAjustes().ultimaCopia;
    $('.ultima').textContent = u ? fmtFecha(u) : 'nunca';
  }
  refrescarInfo();

  const progreso = (texto, frac) => {
    $('.progreso').hidden = false;
    $('.progreso-texto').textContent = texto;
    $('.barra-relleno').style.width = Math.round((frac || 0) * 100) + '%';
  };
  const mensaje = (ok, error) => {
    $('.ok-form').hidden = !ok; $('.ok-form').textContent = ok || '';
    $('.error-form').hidden = !error; $('.error-form').textContent = error || '';
  };
  const ocupado = (si) => app.querySelectorAll('.boton').forEach((b) => b.classList.toggle('desactivado', si));

  $('[data-accion="preparar"]').addEventListener('click', async () => {
    mensaje(); ocupado(true);
    $('[data-accion="guardar"]').hidden = true;
    try {
      const r = await exportarCopia(progreso);
      copiaLista = { blob: r.zip, nombre: nombreArchivoCopia() };
      progreso(`Copia lista: ${r.elementos} elementos, ${r.archivos} archivos, ${fmtMB(r.zip.size)}.`, 1);
      $('[data-accion="guardar"]').hidden = false;
      refrescarInfo();
    } catch (e) {
      mensaje(null, 'No se pudo crear la copia: ' + e.message);
    }
    ocupado(false);
  });

  $('[data-accion="guardar"]').addEventListener('click', async () => {
    if (!copiaLista) return;
    const r = await guardarOCompartir(copiaLista.blob, copiaLista.nombre, 'application/zip');
    if (r === 'descargado') mensaje(`Copia descargada: ${copiaLista.nombre} (mírala en la carpeta Descargas).`);
    if (r === 'compartido') mensaje('Copia enviada. Comprueba que se ha guardado donde elegiste (p. ej. en Archivos o iCloud Drive).');
  });

  app.querySelector('[data-entrada="zip"]').addEventListener('change', async (e) => {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    const modo = app.querySelector('[name="modo"]:checked').value;
    if (modo === 'sustituir' && !confirm('Se borrarán los elementos de este dispositivo que no estén en la copia. ¿Continuar?')) return;
    mensaje(); ocupado(true);
    try {
      const r = await importarCopia(archivo, modo, progreso);
      progreso('Importación terminada.', 1);
      mensaje(`✅ Importados ${r.elementos} elementos y ${r.archivos} archivos.`
        + (r.faltan ? ` Faltaban ${r.faltan} archivos dentro del .zip.` : ''));
      refrescarInfo();
    } catch (err) {
      mensaje(null, 'No se pudo importar: ' + (err.name === 'QuotaExceededError' ? 'no queda espacio en el dispositivo.' : err.message));
    }
    ocupado(false);
  });

  return () => { activo = false; };
}
