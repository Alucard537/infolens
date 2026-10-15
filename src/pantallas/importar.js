// Pantalla "Importar desde Excel" (pensada para usarla en el PC):
// una hoja CSV con los datos + una carpeta con las fotos, PDF y modelos 3D.
import { decodificarTexto, parsearCSV, filasAElementos, plantillaCSV } from '../csv.js';
import { listarElementos, guardarElemento, normalizarId } from '../db.js';
import { prepararFoto } from '../imagenes.js';
import { descargar } from '../ui/descargar.js';

const EXT_FOTO = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif', 'bmp'];
const base = (ruta) => String(ruta || '').split(/[\\/]/).pop().toLowerCase();

export function pantallaImportar(app, { volver, irCopia }) {
  let filas = null;            // filas leídas de la hoja
  const archivos = new Map();  // nombre en minúsculas -> File

  app.innerHTML = `
    <div class="pagina pagina-ancha">
      <button class="volver">‹ Volver</button>
      <h1>Importar desde Excel</h1>
      <p class="nota">Pensado para hacerlo en el PC. Después crea una copia .zip y pásala al iPhone.</p>

      <h2>1. Prepara la hoja</h2>
      <p class="nota">Descarga la plantilla, ábrela con Excel y rellena una fila por elemento. Columnas:
        <b>id</b> (opcional: si lo dejas vacío se pone V-0001, V-0002…), <b>nombre</b>, <b>referencia</b>,
        <b>tipo</b> (sencillo o compuesto), <b>descripcion</b>, y los nombres de archivo de <b>foto</b>, <b>pdf</b> y <b>modelo3d</b>.
        Si dejas vacías las columnas de archivos, se buscan solos por el ID (por ejemplo V-0001.jpg, V-0001.pdf, V-0001.glb).
        Guárdala con "Guardar como" → <b>CSV (delimitado por comas)</b>.</p>
      <button class="boton secundario" data-accion="plantilla">⬇️ Descargar plantilla</button>

      <h2>2. Elige la hoja (.csv)</h2>
      <label class="boton">📊 Elegir hoja CSV
        <input type="file" accept=".csv,text/csv,text/plain" class="entrada-oculta" data-entrada="csv"></label>
      <p class="nota estado-csv"></p>

      <h2>3. Elige la carpeta con las fotos, PDF y modelos</h2>
      <div class="botones-archivo">
        <label class="boton secundario">📁 Elegir carpeta
          <input type="file" webkitdirectory multiple class="entrada-oculta" data-entrada="carpeta"></label>
        <label class="boton secundario">📄 Elegir archivos
          <input type="file" multiple class="entrada-oculta" data-entrada="archivos"></label>
      </div>
      <p class="nota estado-archivos">Ningún archivo elegido.</p>

      <h2>4. Revisa e importa</h2>
      <div class="resumen nota">Elige primero la hoja.</div>
      <button class="boton grande" data-accion="importar" disabled>📥 Importar</button>
      <div class="progreso" hidden><div class="progreso-texto"></div><div class="barra"><div class="barra-relleno"></div></div></div>
      <p class="error-form" hidden></p>
      <div class="ok-form" hidden></div>
    </div>`;

  const $ = (s) => app.querySelector(s);
  $('.volver').addEventListener('click', volver);
  $('[data-accion="plantilla"]').addEventListener('click', () => descargar(plantillaCSV(), 'plantilla-elementos.csv'));

  const error = (msg) => { $('.error-form').hidden = !msg; $('.error-form').textContent = msg || ''; };

  // Para cada fila, decide qué archivos le corresponden
  function buscarArchivo(valor, id, extensiones) {
    if (valor) return archivos.get(base(valor)) || null;
    if (!id) return null;
    for (const ext of extensiones) {
      const f = archivos.get(`${id.toLowerCase()}.${ext}`);
      if (f) return f;
    }
    return null;
  }

  let plan = [];
  async function revisar() {
    if (!filas) return;
    const existentes = new Map((await listarElementos()).map((e) => [e.id, e]));
    // IDs automáticos para filas sin ID
    let max = 0;
    for (const id of [...existentes.keys(), ...filas.map((f) => normalizarId(f.id))]) {
      const m = /^V-(\d+)$/.exec(id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const vistos = new Set();
    const avisos = [];
    plan = [];
    for (const f of filas) {
      let id = normalizarId(f.id);
      if (!id) id = 'V-' + String(++max).padStart(4, '0');
      if (!f.nombre || !f.referencia) { avisos.push(`Fila ${f.fila}: falta el nombre o la referencia (se salta).`); continue; }
      if (vistos.has(id)) { avisos.push(`Fila ${f.fila}: el ID ${id} está repetido en la hoja (se salta).`); continue; }
      vistos.add(id);
      const foto = buscarArchivo(f.foto, id, EXT_FOTO);
      const pdf = buscarArchivo(f.pdf, id, ['pdf']);
      const modelo = buscarArchivo(f.modelo3d, id, ['glb']);
      if (f.foto && !foto) avisos.push(`Fila ${f.fila} (${id}): no encuentro la foto "${f.foto}".`);
      if (f.pdf && !pdf) avisos.push(`Fila ${f.fila} (${id}): no encuentro el PDF "${f.pdf}".`);
      if (f.modelo3d && !modelo) avisos.push(`Fila ${f.fila} (${id}): no encuentro el modelo "${f.modelo3d}".`);
      plan.push({
        id, existe: existentes.has(id), foto, pdf, modelo,
        datos: {
          id, nombre: f.nombre, referencia: f.referencia,
          tipo: /^c/i.test(f.tipo || '') ? 'COMPUESTO' : 'SENCILLO',
          descripcion: f.descripcion || '',
        },
      });
    }
    const nuevos = plan.filter((p) => !p.existe).length;
    const conFoto = plan.filter((p) => p.foto).length;
    const conPdf = plan.filter((p) => p.pdf).length;
    const conModelo = plan.filter((p) => p.modelo).length;
    $('.resumen').innerHTML = `
      <div class="tarjeta-info">
        <div>Elementos a importar: <b>${plan.length}</b> (${nuevos} nuevos, ${plan.length - nuevos} se actualizarán)</div>
        <div>Con foto: <b>${conFoto}</b> · con PDF: <b>${conPdf}</b> · con modelo 3D: <b>${conModelo}</b></div>
      </div>
      ${avisos.length ? `<details class="avisos" open><summary>⚠️ ${avisos.length} avisos</summary><ul></ul></details>` : ''}`;
    const ul = $('.avisos ul');
    if (ul) avisos.slice(0, 200).forEach((a) => { const li = document.createElement('li'); li.textContent = a; ul.appendChild(li); });
    $('[data-accion="importar"]').disabled = plan.length === 0;
    $('[data-accion="importar"]').textContent = `📥 Importar ${plan.length} elementos`;
  }

  app.addEventListener('change', async (e) => {
    const tipo = e.target.dataset.entrada;
    if (!tipo) return;
    error('');
    const lista = [...(e.target.files || [])];
    if (tipo === 'csv') {
      const f = lista[0];
      e.target.value = '';
      if (!f) return;
      try {
        filas = filasAElementos(parsearCSV(decodificarTexto(await f.arrayBuffer())));
        $('.estado-csv').textContent = `✅ ${f.name}: ${filas.length} filas.`;
      } catch (err) {
        filas = null;
        $('.estado-csv').textContent = '';
        error(err.message);
        return;
      }
    } else {
      for (const f of lista) archivos.set(base(f.name), f);
      $('.estado-archivos').textContent = `✅ ${archivos.size} archivos elegidos.`;
    }
    revisar();
  });

  $('[data-accion="importar"]').addEventListener('click', async () => {
    const boton = $('[data-accion="importar"]');
    boton.disabled = true;
    error('');
    $('.progreso').hidden = false;
    let hechos = 0;
    const fallos = [];
    for (const p of plan) {
      $('.progreso-texto').textContent = `Importando ${hechos + 1} de ${plan.length}: ${p.datos.nombre}`;
      $('.barra-relleno').style.width = Math.round((hechos / plan.length) * 100) + '%';
      try {
        const cambios = {};
        if (p.foto) {
          try {
            const { imagen, miniatura } = await prepararFoto(p.foto);
            cambios.imagenId = { blob: imagen, nombre: 'foto.jpg' };
            cambios.miniaturaId = { blob: miniatura, nombre: 'foto-mini.jpg' };
          } catch {
            fallos.push(`${p.id}: no se pudo leer la foto "${p.foto.name}" (se guarda sin foto; usa JPG o PNG).`);
          }
        }
        if (p.pdf) cambios.pdfId = { blob: new Blob([p.pdf], { type: 'application/pdf' }), nombre: p.pdf.name };
        if (p.modelo) cambios.modelo3dId = { blob: new Blob([p.modelo], { type: 'model/gltf-binary' }), nombre: p.modelo.name };
        await guardarElemento(p.datos, cambios, false);
        hechos++;
      } catch (err) {
        fallos.push(`${p.id}: ${err.message}`);
      }
    }
    $('.barra-relleno').style.width = '100%';
    $('.progreso-texto').textContent = 'Terminado.';
    const ok = $('.ok-form');
    ok.hidden = false;
    ok.innerHTML = `<p>✅ Importados ${hechos} elementos.${fallos.length ? ` ${fallos.length} fallaron.` : ''}</p>
      <p>Siguiente paso: crea una copia .zip para pasarla al iPhone.</p>
      <button class="boton" data-accion="ir-copia">📦 Ir a Copia de seguridad</button>`;
    ok.querySelector('[data-accion="ir-copia"]').addEventListener('click', irCopia);
    if (fallos.length) error(fallos.slice(0, 20).join('\n'));
    boton.disabled = false;
  });
}
