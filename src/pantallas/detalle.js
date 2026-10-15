// Pantalla de detalle de un elemento (datos de la base de datos del móvil).
import { obtenerElemento, obtenerArchivo, obtenerHuella } from '../db.js';
import { esAdmin } from '../permisos.js';

// El visor (con pdf.js, que es grande) se carga solo cuando hace falta
const visor = () => import('../ui/visor.js');

export function pantallaDetalle(app, id, { volver, editar, darDeAlta, imprimirQR, huella }) {
  let activo = true;
  const urls = [];
  app.innerHTML = '<div class="pagina"><p class="nota">Cargando…</p></div>';

  (async () => {
    const el = await obtenerElemento(id);
    if (!activo) return;
    if (!el) {
      app.innerHTML = `<div class="pagina"><button class="volver">‹ Volver</button>
        <h1>Elemento no registrado</h1><p class="det-ref"></p>
        ${esAdmin() ? '<button class="boton grande" data-accion="alta">➕ Dar de alta con este ID</button>' : '<p class="nota">Avisa al administrador para que lo dé de alta.</p>'}</div>`;
      app.querySelector('.det-ref').textContent = 'ID: ' + id;
      app.querySelector('.volver').addEventListener('click', volver);
      app.querySelector('[data-accion="alta"]')?.addEventListener('click', () => darDeAlta(id));
      return;
    }

    const [foto, pdf, conexion, modelo, hu] = await Promise.all([
      obtenerArchivo(el.imagenId), obtenerArchivo(el.pdfId), obtenerArchivo(el.pdfConexionId), obtenerArchivo(el.modelo3dId), obtenerHuella(el.id),
    ]);
    if (!activo) return;

    app.innerHTML = `
      <div class="pagina">
        <button class="volver">‹ Volver</button>
        <h1 class="det-nombre"></h1>
        <p class="det-ref"></p>
        <p class="det-tipo"></p>
        <p class="det-desc"></p>
        ${foto ? '<button class="det-imagen" aria-label="Ver imagen ampliada"><img alt=""></button>' : ''}
        ${pdf ? '<button class="boton" data-accion="pdf">📄 Ficha técnica</button>' : ''}
        ${conexion ? '<button class="boton" data-accion="conexion">🔌 Conexión</button>' : ''}
        ${!foto && !pdf && !conexion ? '<p class="nota">Este elemento no tiene foto ni PDF.</p>' : ''}
        ${modelo ? '<p class="nota">🧊 Tiene modelo 3D: se ve en el escáner encima de su QR.</p><div class="hueco-lidar"></div>' : ''}
        ${esAdmin() ? `<div class="det-botones">
          <button class="boton secundario" data-accion="editar">✏️ Editar</button>
          <button class="boton secundario" data-accion="qr">🖨️ Imprimir QR</button>
        </div>
        <button class="boton secundario" data-accion="huella">🎯 Reconocer sin QR ${hu ? '(huella: ' + hu.n + ' imágenes)' : '(sin huella)'}</button>` : ''}
        <p class="nota">ID: <b class="det-id"></b> · Su QR contiene el texto <b class="det-qr"></b></p>
      </div>`;
    const $ = (s) => app.querySelector(s);
    $('.det-nombre').textContent = el.nombre;
    $('.det-ref').textContent = 'Referencia: ' + el.referencia;
    $('.det-tipo').textContent = 'Tipo: ' + (el.tipo === 'COMPUESTO' ? 'Compuesto' : 'Sencillo');
    // Descripción: respeta los saltos de línea y convierte las direcciones web en enlaces
    const desc = $('.det-desc');
    for (const trozo of String(el.descripcion || '').split(/(https?:\/\/[^\s]+)/)) {
      if (/^https?:\/\//.test(trozo)) {
        const a = document.createElement('a');
        a.href = trozo; a.textContent = trozo; a.target = '_blank'; a.rel = 'noopener';
        desc.appendChild(a);
      } else desc.appendChild(document.createTextNode(trozo));
    }
    $('.det-id').textContent = el.id;
    $('.det-qr').textContent = 'INFOLENS:' + el.id;
    $('.volver').addEventListener('click', volver);
    $('[data-accion="editar"]')?.addEventListener('click', () => editar(el.id));
    $('[data-accion="qr"]')?.addEventListener('click', () => imprimirQR(el.id));
    $('[data-accion="huella"]')?.addEventListener('click', () => huella(el.id));

    if (foto) {
      const u = URL.createObjectURL(foto.blob);
      urls.push(u);
      $('.det-imagen img').src = u;
      $('.det-imagen').addEventListener('click', async () => (await visor()).abrirImagen(u, el.nombre));
    }
    // Los dos PDF posibles: ficha técnica y conexión
    for (const [archivo, accion, titulo] of [[pdf, 'pdf', 'Ficha técnica'], [conexion, 'conexion', 'Conexión']]) {
      if (!archivo) continue;
      const u = URL.createObjectURL(archivo.blob);
      urls.push(u);
      $(`[data-accion="${accion}"]`).addEventListener('click', async () => (await visor()).abrirPdf(u, `${titulo} · ${el.nombre}`));
    }
    // Ver el modelo con AR de Apple (LiDAR), si el iPhone lo permite
    if (modelo) {
      import('../ar/quicklook.js').then((m) => {
        const b = activo && m.botonQuickLook(el);
        if (b) $('.hueco-lidar').appendChild(b);
      });
    }
    visor(); // ir cargando el visor en segundo plano para que abra rápido
  })();

  return () => {
    activo = false;
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
}
