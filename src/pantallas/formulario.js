// Formulario para añadir o editar un elemento.
import {
  obtenerElemento, guardarElemento, borrarElemento, siguienteId, normalizarId, obtenerArchivo,
} from '../db.js';
import { prepararFoto } from '../imagenes.js';

const MB = 1024 * 1024;

export function pantallaFormulario(app, { id, idSugerido, alGuardar, alBorrar, volver }) {
  const esNuevo = !id;
  let activo = true;
  const urls = [];
  const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  // Cambios pendientes de archivos (undefined = sin cambios, null = quitar, objeto = nuevo)
  const cambios = { imagenId: undefined, miniaturaId: undefined, pdfId: undefined, modelo3dId: undefined };
  let actual = null; // elemento guardado (al editar)

  app.innerHTML = `
    <div class="pagina formulario">
      <button class="volver">‹ Cancelar</button>
      <h1>${esNuevo ? 'Añadir elemento' : 'Editar elemento'}</h1>
      <form novalidate>
        <div class="bloque-archivo">
          <div class="titulo-archivo">📦 ¿Tienes el .edz de EPLAN?</div>
          <p class="nota">Rellena solos el nombre, la referencia, la descripción y la foto.</p>
          <label class="boton secundario">Rellenar desde .edz
            <input type="file" data-entrada="edz" class="entrada-oculta"></label>
        </div>
        <label>ID (el que va en el QR)
          <input name="id" required autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false">
          <small class="ayuda">${esNuevo ? 'Se propone uno automático. Puedes cambiarlo (letras, números y guiones).' : 'El ID no se puede cambiar porque ya puede estar impreso en un QR.'}</small>
        </label>
        <label>Nombre *
          <input name="nombre" required autocomplete="off">
        </label>
        <label>Referencia *
          <input name="referencia" required autocomplete="off" autocapitalize="characters">
        </label>
        <fieldset class="tipo">
          <legend>Tipo</legend>
          <label class="opcion"><input type="radio" name="tipo" value="SENCILLO" checked> ℹ️ Sencillo</label>
          <label class="opcion"><input type="radio" name="tipo" value="COMPUESTO"> 🧩 Compuesto</label>
        </fieldset>
        <label>Descripción (opcional)
          <textarea name="descripcion" rows="4"></textarea>
        </label>

        <div class="bloque-archivo" data-campo="foto">
          <div class="titulo-archivo">📷 Foto</div>
          <img class="vista-foto" alt="" hidden>
          <div class="botones-archivo">
            <label class="boton secundario">Hacer foto
              <input type="file" accept="image/*" capture="environment" data-entrada="foto" class="entrada-oculta"></label>
            <label class="boton secundario">Galería
              <input type="file" accept="image/*" data-entrada="foto" class="entrada-oculta"></label>
          </div>
          <button type="button" class="quitar" data-quitar="foto" hidden>Quitar foto</button>
        </div>

        <div class="bloque-archivo" data-campo="pdf">
          <div class="titulo-archivo">📄 PDF</div>
          <div class="nombre-archivo" data-nombre="pdf">Sin PDF</div>
          <label class="boton secundario">Elegir PDF (Archivos)
            <input type="file" accept="application/pdf,.pdf" data-entrada="pdf" class="entrada-oculta"></label>
          <button type="button" class="quitar" data-quitar="pdf" hidden>Quitar PDF</button>
        </div>

        <div class="bloque-archivo" data-campo="modelo">
          <div class="titulo-archivo">🧊 Modelo 3D (opcional)</div>
          <div class="nombre-archivo" data-nombre="modelo">Sin modelo 3D</div>
          <label class="boton secundario">Elegir modelo 3D (Archivos)
            <input type="file" data-entrada="modelo" class="entrada-oculta"></label>
          <p class="nota">Acepta .glb, STEP (.stp), IGES (.igs) y STL: se convierten solos a .glb. Los .sat no se pueden convertir (descarga el STEP del fabricante).</p>
          <button type="button" class="quitar" data-quitar="modelo" hidden>Quitar modelo</button>
        </div>

        <p class="error-form" hidden></p>
        <button type="submit" class="boton grande">💾 Guardar</button>
        ${esNuevo ? '' : '<button type="button" class="boton peligro" data-accion="borrar">🗑️ Borrar elemento</button>'}
      </form>
    </div>`;

  const $ = (s) => app.querySelector(s);
  const form = $('form');
  const campoId = form.elements.id;
  const errorForm = $('.error-form');
  $('.volver').addEventListener('click', volver);

  const mostrarError = (msg) => {
    errorForm.textContent = msg;
    errorForm.hidden = !msg;
    if (msg) errorForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  function verFoto(blob) {
    const img = $('.vista-foto');
    img.hidden = !blob;
    if (blob) img.src = blobUrl(blob);
    $('[data-quitar="foto"]').hidden = !blob;
  }
  function verNombre(tipo, nombre, tamano) {
    const vacio = tipo === 'pdf' ? 'Sin PDF' : 'Sin modelo 3D';
    $(`[data-nombre="${tipo}"]`).textContent = nombre ? `${nombre}${tamano ? ` (${(tamano / MB).toFixed(1)} MB)` : ''}` : vacio;
    $(`[data-quitar="${tipo}"]`).hidden = !nombre;
  }

  // ---------- cargar datos ----------
  (async () => {
    if (esNuevo) {
      campoId.value = idSugerido ? normalizarId(idSugerido) : await siguienteId();
      return;
    }
    actual = await obtenerElemento(id);
    if (!activo) return;
    if (!actual) { mostrarError('Este elemento ya no existe.'); return; }
    campoId.value = actual.id;
    campoId.readOnly = true;
    form.elements.nombre.value = actual.nombre || '';
    form.elements.referencia.value = actual.referencia || '';
    form.elements.tipo.value = actual.tipo || 'SENCILLO';
    form.elements.descripcion.value = actual.descripcion || '';
    const [foto, pdf, modelo] = await Promise.all([
      obtenerArchivo(actual.imagenId), obtenerArchivo(actual.pdfId), obtenerArchivo(actual.modelo3dId),
    ]);
    if (!activo) return;
    if (foto) verFoto(foto.blob);
    if (pdf) verNombre('pdf', pdf.nombre, pdf.blob.size);
    if (modelo) verNombre('modelo', modelo.nombre, modelo.blob.size);
  })();

  // ---------- elegir archivos ----------
  form.addEventListener('change', async (e) => {
    const tipo = e.target.dataset.entrada;
    if (!tipo) return;
    const archivo = e.target.files && e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!archivo) return;
    mostrarError('');
    try {
      if (tipo === 'edz') {
        const { leerEdz } = await import('../edz.js');
        const { datos, foto } = await leerEdz(archivo);
        const f = form.elements;
        const hayDatos = f.nombre.value || f.referencia.value || f.descripcion.value;
        if (hayDatos && !confirm('¿Sustituir el nombre, la referencia y la descripción por los del .edz?')) return;
        f.nombre.value = datos.nombre;
        f.referencia.value = datos.referencia;
        f.descripcion.value = datos.descripcion;
        if (foto) {
          const { imagen, miniatura } = await prepararFoto(foto);
          cambios.imagenId = { blob: imagen, nombre: 'foto.jpg' };
          cambios.miniaturaId = { blob: miniatura, nombre: 'foto-mini.jpg' };
          verFoto(imagen);
        }
      } else if (tipo === 'foto') {
        $('.vista-foto').hidden = true;
        const { imagen, miniatura } = await prepararFoto(archivo);
        cambios.imagenId = { blob: imagen, nombre: 'foto.jpg' };
        cambios.miniaturaId = { blob: miniatura, nombre: 'foto-mini.jpg' };
        verFoto(imagen);
      } else if (tipo === 'pdf') {
        const cabecera = new Uint8Array(await archivo.slice(0, 5).arrayBuffer());
        if (String.fromCharCode(...cabecera) !== '%PDF-') throw new Error('El archivo elegido no es un PDF.');
        cambios.pdfId = { blob: new Blob([archivo], { type: 'application/pdf' }), nombre: archivo.name };
        verNombre('pdf', archivo.name, archivo.size);
      } else if (tipo === 'modelo') {
        const nombreModelo = $('[data-nombre="modelo"]');
        const guardar = form.querySelector('[type="submit"]');
        guardar.disabled = true; // no guardar a medias mientras se convierte
        try {
          const { prepararModelo } = await import('../modelo3d.js');
          const m = await prepararModelo(archivo, (t) => { nombreModelo.textContent = '⏳ ' + t; });
          cambios.modelo3dId = { blob: m.blob, nombre: m.nombre };
          verNombre('modelo', m.nombre, m.blob.size);
          if (m.aviso) nombreModelo.textContent += ' · ' + m.aviso;
        } catch (err) {
          verNombre('modelo', null);
          throw err;
        } finally {
          guardar.disabled = false;
        }
      }
    } catch (err) {
      mostrarError(err.message);
    }
  });

  form.addEventListener('click', (e) => {
    const quitar = e.target.dataset.quitar;
    if (!quitar) return;
    if (quitar === 'foto') { cambios.imagenId = null; cambios.miniaturaId = null; verFoto(null); }
    if (quitar === 'pdf') { cambios.pdfId = null; verNombre('pdf', null); }
    if (quitar === 'modelo') { cambios.modelo3dId = null; verNombre('modelo', null); }
  });

  // ---------- guardar ----------
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    mostrarError('');
    const f = form.elements;
    const datos = {
      id: esNuevo ? normalizarId(f.id.value) : actual?.id,
      nombre: f.nombre.value.trim(),
      referencia: f.referencia.value.trim(),
      tipo: f.tipo.value === 'COMPUESTO' ? 'COMPUESTO' : 'SENCILLO',
      descripcion: f.descripcion.value.trim(),
    };
    if (!datos.id) return mostrarError('Escribe un ID.');
    if (!datos.nombre) return mostrarError('El nombre es obligatorio.');
    if (!datos.referencia) return mostrarError('La referencia es obligatoria.');
    const boton = form.querySelector('[type="submit"]');
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await guardarElemento(datos, cambios, esNuevo);
      alGuardar(datos.id);
    } catch (err) {
      mostrarError(err.name === 'QuotaExceededError'
        ? 'No queda espacio en el móvil para guardar estos archivos.'
        : err.message);
      boton.disabled = false;
      boton.textContent = '💾 Guardar';
    }
  });

  $('[data-accion="borrar"]')?.addEventListener('click', async () => {
    if (!actual) return;
    if (!confirm(`¿Borrar "${actual.nombre}" (${actual.id})?\n\nSe borrarán también su foto, PDF y modelo 3D. No se puede deshacer.`)) return;
    await borrarElemento(actual.id);
    alBorrar();
  });

  return () => {
    activo = false;
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
