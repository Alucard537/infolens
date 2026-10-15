// Zoom con dos dedos (pellizcar), arrastrar con un dedo y doble toque para acercar/restablecer.
// "marco" es la ventana visible; "contenido" es lo que se amplía (imagen o página de PDF).

const MAX_ZOOM = 6;

export function hacerZoomable(marco, contenido) {
  let s = 1, x = 0, y = 0;
  const dedos = new Map();
  let inicio = null;
  let ultimoToque = 0;

  marco.style.touchAction = 'none';
  contenido.style.transformOrigin = '0 0';

  const aplicar = () => { contenido.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };

  // Mantener el contenido dentro del marco (centrado si es más pequeño)
  function limitar() {
    const mw = marco.clientWidth, mh = marco.clientHeight;
    const cw = contenido.offsetWidth * s, ch = contenido.offsetHeight * s;
    x = cw <= mw ? (mw - cw) / 2 : Math.min(0, Math.max(mw - cw, x));
    y = ch <= mh ? (mh - ch) / 2 : Math.min(0, Math.max(mh - ch, y));
  }

  function foto() {
    const p = [...dedos.values()];
    if (p.length >= 2) {
      inicio = {
        s, x, y,
        d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y),
        mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2,
      };
    } else if (p.length === 1) {
      inicio = { s, x, y, px: p[0].x, py: p[0].y };
    } else {
      inicio = null;
    }
  }

  const local = (e) => {
    const r = marco.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function zoomEn(px, py, nuevaS) {
    // El punto (px, py) del marco se queda quieto mientras cambia el zoom
    const cxp = (px - x) / s, cyp = (py - y) / s;
    s = nuevaS;
    x = px - cxp * s; y = py - cyp * s;
    limitar(); aplicar();
  }

  marco.addEventListener('pointerdown', (e) => {
    marco.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, local(e));
    foto();
    // Doble toque
    if (dedos.size === 1) {
      const ahora = Date.now();
      if (ahora - ultimoToque < 300) {
        const p = local(e);
        zoomEn(p.x, p.y, s > 1.05 ? 1 : 2.5);
        ultimoToque = 0;
      } else {
        ultimoToque = ahora;
      }
    }
  });

  marco.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId) || !inicio) return;
    dedos.set(e.pointerId, local(e));
    const p = [...dedos.values()];
    if (p.length >= 2 && inicio.d) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const mx = (p[0].x + p[1].x) / 2, my = (p[0].y + p[1].y) / 2;
      const nuevaS = Math.min(MAX_ZOOM, Math.max(1, (inicio.s * d) / inicio.d));
      const cxp = (inicio.mx - inicio.x) / inicio.s, cyp = (inicio.my - inicio.y) / inicio.s;
      s = nuevaS;
      x = mx - cxp * s; y = my - cyp * s;
    } else if (p.length === 1 && inicio.px !== undefined) {
      x = inicio.x + (p[0].x - inicio.px);
      y = inicio.y + (p[0].y - inicio.py);
    }
    limitar(); aplicar();
  });

  const soltar = (e) => { dedos.delete(e.pointerId); foto(); };
  marco.addEventListener('pointerup', soltar);
  marco.addEventListener('pointercancel', soltar);
  // Evitar que Safari amplíe la página entera
  marco.addEventListener('gesturestart', (e) => e.preventDefault());

  const restablecer = () => { s = 1; x = 0; y = 0; limitar(); aplicar(); };
  restablecer();
  return { restablecer };
}
