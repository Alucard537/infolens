// Pantalla "Administrador": crear la contraseña, entrar, cambiarla o salir.
import {
  hayContrasena, esAdmin, crearContrasena, entrarComoAdmin, salirDeAdmin, cambiarContrasena, MIN_LARGO,
} from '../permisos.js';

const campo = (nombre, texto, autocompletar) => `
  <label>${texto}
    <span class="campo-clave">
      <input type="password" name="${nombre}" autocomplete="${autocompletar}" autocapitalize="off" autocorrect="off" spellcheck="false">
      <button type="button" class="ver-clave" aria-label="Mostrar u ocultar">👁️</button>
    </span>
  </label>`;

export function pantallaAdmin(app, { volver, alEntrar, alSalir, destino }) {
  function pintar() {
    const admin = esAdmin();
    const hay = hayContrasena();
    let html = '<div class="pagina formulario"><button class="volver">‹ Inicio</button>';
    if (admin) {
      html += `
        <h1>🔑 Administrador</h1>
        <div class="tarjeta-info">Estás en <b>modo administrador</b>: puedes añadir, editar y borrar elementos,
          importar, imprimir QR, grabar huellas y crear copias. Sigue así hasta que pulses <b>Salir</b>.</div>
        <button class="boton grande" data-accion="salir">🚪 Salir del modo administrador</button>
        <h2>Cambiar la contraseña</h2>
        <form data-form="cambiar" novalidate>
          ${campo('actual', 'Contraseña actual', 'current-password')}
          ${campo('nueva', `Contraseña nueva (mínimo ${MIN_LARGO} caracteres)`, 'new-password')}
          ${campo('repetir', 'Repite la contraseña nueva', 'new-password')}
          <p class="error-form" hidden></p><p class="ok-form" hidden></p>
          <button class="boton" type="submit">Cambiar contraseña</button>
        </form>
        <p class="nota">Después de cambiarla, crea una copia nueva y pásala a los teléfonos de los operarios
          para que también usen la contraseña nueva.</p>`;
    } else if (hay) {
      html += `
        <h1>🔒 Entrar como administrador</h1>
        <form data-form="entrar" novalidate>
          ${campo('clave', 'Contraseña de administrador', 'current-password')}
          <p class="error-form" hidden></p>
          <button class="boton grande" type="submit">Entrar</button>
        </form>
        <p class="nota">¿Has olvidado la contraseña? No se puede recuperar desde la app. Importa una copia .zip creada
          en un dispositivo donde sí la recuerdes, o con otra contraseña que conozcas.</p>`;
    } else {
      html += `
        <h1>🔑 Crear contraseña de administrador</h1>
        <p class="nota">Este dispositivo aún no tiene administrador. Quien cree la contraseña será el administrador.
          En los teléfonos de los operarios no hace falta: la contraseña llega dentro de tu copia .zip.</p>
        <form data-form="crear" novalidate>
          ${campo('nueva', `Contraseña (mínimo ${MIN_LARGO} caracteres)`, 'new-password')}
          ${campo('repetir', 'Repite la contraseña', 'new-password')}
          <p class="error-form" hidden></p>
          <button class="boton grande" type="submit">Crear y entrar</button>
        </form>
        <p class="nota">⚠️ Apúntala en un sitio seguro: no se puede recuperar.</p>`;
    }
    html += '</div>';
    app.innerHTML = html;

    app.querySelector('.volver').addEventListener('click', volver);
    app.querySelectorAll('.ver-clave').forEach((b) => b.addEventListener('click', () => {
      const i = b.previousElementSibling;
      i.type = i.type === 'password' ? 'text' : 'password';
    }));
    const form = app.querySelector('form');
    const error = (m) => { const e = form.querySelector('.error-form'); e.hidden = !m; e.textContent = m || ''; };
    app.querySelector('[data-accion="salir"]')?.addEventListener('click', () => { salirDeAdmin(); alSalir(); });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      error('');
      const f = form.elements;
      const boton = form.querySelector('[type="submit"]');
      boton.disabled = true;
      try {
        if (form.dataset.form === 'entrar') {
          if (await entrarComoAdmin(f.clave.value)) { alEntrar(destino); return; }
          error('Contraseña incorrecta.');
          f.clave.select();
        } else if (form.dataset.form === 'crear') {
          if (f.nueva.value !== f.repetir.value) throw new Error('Las dos contraseñas no coinciden.');
          await crearContrasena(f.nueva.value);
          alEntrar(destino);
          return;
        } else if (form.dataset.form === 'cambiar') {
          if (f.nueva.value !== f.repetir.value) throw new Error('Las dos contraseñas nuevas no coinciden.');
          await cambiarContrasena(f.actual.value, f.nueva.value);
          form.reset();
          const ok = form.querySelector('.ok-form');
          ok.hidden = false;
          ok.textContent = '✅ Contraseña cambiada.';
        }
      } catch (err) {
        error(err.message);
      }
      boton.disabled = false;
    });
    form?.querySelector('input')?.focus();
  }
  pintar();
}
