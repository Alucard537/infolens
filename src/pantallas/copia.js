// Pantalla "Copia de seguridad": exportar e importar todo en un .zip.
import { exportarCopia, importarCopia, nombreArchivoCopia, espacioUsado } from '../copia.js';
import { contarElementos } from '../db.js';
import { leerAjustes } from '../ajustes.js';
import { guardarOCompartir } from '../ui/descargar.js';
import { esAdmin } from '../permisos.js';

const fmtMB = (b) => (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
const fmtFecha = (t) => new Date(t).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });

export function pantallaCopia(app, { volver, irImportarExcel }) {
  let activo = true;
  let operacionEnCurso = false;
  let copiaLista = null;
  const admin = esAdmin();

  app.innerHTML = `
    <div class="pagina">
      <button class="volver">‹ Inicio</button>
      <h1>${admin ? 'Copia de seguridad' : 'Recibir actualización'}</h1>
      <div class="tarjeta-info">
        <div>Elementos: <b class="n-elementos">…</b></div>
        <div>Espacio usado: <b class="espacio">…</b></div>
        <div>Última copia: <b class="ultima">…</b></div>
      </div>

      ${admin ? `
      <h2>📤 Exportar</h2>
      <p class="nota">Guarda todos los elementos con sus fotos, PDF, modelos 3D y huellas en un único archivo .zip.
        Sirve como copia de seguridad y para pasar el catálogo a otros dispositivos.</p>
      <button class="boton" data-accion="preparar">📦 Crear copia (.zip)</button>
      <button class="boton" data-accion="guardar" hidden>💾 Guardar / enviar la copia</button>

      <h2>📥 Importar</h2>
      <p class="nota">Elige un .zip creado con "Exportar" (en este dispositivo o en otro).</p>
      <fieldset class="tipo">
        <label class="opcion"><input type="radio" name="modo" value="combinar" checked> Añadir y actualizar</label>
        <label class="opcion"><input type="radio" name="modo" value="sustituir"> Sustituir todo</label>
      </fieldset>` : `
      <p class="nota">Elige el archivo .zip que te ha enviado el administrador (por ejemplo desde iCloud Drive,
        WhatsApp o el correo). Este teléfono quedará igual que el del administrador.</p>
      <input type="radio" name="modo" value="sustituir" checked hidden>`}
      <p class="nota modo-ayuda"></p>
      <label class="boton">📂 Elegir copia .zip e importar
        <input type="file" accept=".zip,application/zip,application/x-zip-compressed" class="entrada-oculta" data-entrada="zip"></label>

      <div class="progreso" hidden><div class="progreso-texto"></div><div class="barra"><div class="barra-relleno"></div></div></div>
      <p class="error-form" hidden></p>
      <p class="ok-form" hidden></p>

      ${admin ? `<h2>🖥️ Desde el PC</h2>
      <p class="nota">¿Tienes los datos en un Excel? En el PC puedes importarlos todos de golpe y luego pasar la copia al iPhone.</p>
      <button class="boton secundario" data-accion="excel">📊 Importar desde Excel</button>` : ''}
    </div>`;

  const $ = (s) => app.querySelector(s);
  $('.volver').addEventListener('click', volver);
  $('[data-accion="excel"]')?.addEventListener('click', irImportarExcel);

  const ayudaModo = () => {
    const m = app.querySelector('[name="modo"]:checked').value;
    if (!admin) return;
    $('.modo-ayuda').textContent = m === 'combinar'
      ? 'Añade elementos y actualiza los que tengan el mismo ID, incluidos sus archivos y huellas.'
      : '⚠️ Sustituye el catálogo completo, con sus guías, archivos y huellas.';
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
    if (!activo) return;
    $('.progreso').hidden = false;
    $('.progreso-texto').textContent = texto;
    $('.barra-relleno').style.width = Math.round((frac || 0) * 100) + '%';
  };
  const mensaje = (ok, error) => {
    if (!activo) return;
    $('.ok-form').hidden = !ok; $('.ok-form').textContent = ok || '';
    $('.error-form').hidden = !error; $('.error-form').textContent = error || '';
  };
  const ocupado = (si) => {
    operacionEnCurso = si;
    if (activo) app.querySelectorAll('button.boton, input[data-entrada], input[name="modo"]').forEach((campo) => { campo.disabled = si; });
  };

  $('[data-accion="preparar"]')?.addEventListener('click', async () => {
    if (operacionEnCurso) return;
    mensaje(); ocupado(true);
    $('[data-accion="guardar"]').hidden = true;
    try {
      const r = await exportarCopia(progreso);
      if (!activo) return;
      copiaLista = { blob: r.zip, nombre: nombreArchivoCopia() };
      progreso(`Copia lista: ${r.elementos} elementos, ${r.archivos} archivos, ${fmtMB(r.zip.size)}.`, 1);
      $('[data-accion="guardar"]').hidden = false;
      refrescarInfo();
    } catch (e) {
      mensaje(null, 'No se pudo crear la copia: ' + e.message);
    } finally { ocupado(false); }
  });

  $('[data-accion="guardar"]')?.addEventListener('click', async () => {
    if (!copiaLista) return;
    const r = await guardarOCompartir(copiaLista.blob, copiaLista.nombre, 'application/zip');
    if (r === 'descargado') mensaje(`Copia descargada: ${copiaLista.nombre} (mírala en la carpeta Descargas).`);
    if (r === 'compartido') mensaje('Copia enviada. Comprueba que se ha guardado donde elegiste (p. ej. en Archivos o iCloud Drive).');
  });

  app.querySelector('[data-entrada="zip"]').addEventListener('change', async (e) => {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!archivo || operacionEnCurso) return;
    const modo = app.querySelector('[name="modo"]:checked').value;
    if (modo === 'sustituir' && !confirm('Se sustituirá el catálogo de este dispositivo por el de la copia. ¿Continuar?')) return;
    mensaje(); ocupado(true);
    try {
      const r = await importarCopia(archivo, modo, progreso);
      progreso('Importación terminada.', 1);
      mensaje(`✅ Importados ${r.elementos} elementos y ${r.archivos} archivos.`);
      if (activo) refrescarInfo();
    } catch (err) {
      mensaje(null, 'No se pudo importar: ' + (err.name === 'QuotaExceededError' ? 'no queda espacio en el dispositivo.' : err.message));
    } finally { ocupado(false); }
  });

  return () => { activo = false; };
}
