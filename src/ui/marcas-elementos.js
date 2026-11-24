/** Rótulos y flechas situados sobre los puntos de la guía que proyecta la cámara. */
export function crearMarcasElementos(panel) {
  const capa = document.createElement('div');
  capa.className = 'marcas-elementos';
  panel.before(capa);
  const nodos = new Map();

  function mostrar(marcas) {
    capa.replaceChildren();
    nodos.clear();
    for (const { id, nombre } of marcas) {
      const marca = document.createElement('div');
      marca.className = 'marca-elemento';
      marca.hidden = true;
      marca.innerHTML = '<span class="flecha-elemento" aria-hidden="true"></span><span class="nombre-elemento"></span>';
      marca.lastElementChild.textContent = nombre;
      capa.appendChild(marca);
      nodos.set(id, marca);
    }
  }

  function proyectar(puntos) {
    const visibles = new Map(puntos.map((p) => [p.id, p]));
    const W = capa.clientWidth;
    const H = capa.clientHeight;
    const arriba = (capa.parentElement.querySelector('.esc-barra')?.getBoundingClientRect().bottom ?? 0) - capa.getBoundingClientRect().top + 4;
    const abajo = panel.offsetTop || H;
    const rectangulos = [];
    const limitar = (n, min, max) => Math.max(min, Math.min(n, max));
    for (const [id, marca] of nodos) {
      const p = visibles.get(id);
      marca.hidden = !Number.isFinite(p?.x) || !Number.isFinite(p?.y) || !W || !H;
      if (marca.hidden) continue;
      const x = Math.round(p.x * W), y = Math.round(p.y * H);
      const nombre = marca.lastElementChild;
      const w = nombre.offsetWidth, h = nombre.offsetHeight;
      const tx = limitar(x - w / 2, 4, W - w - 4);
      const ty = limitar(y - h - 21, arriba, abajo - h - 4);
      const disponible = (rx, ry) => rectangulos.every((r) =>
        rx + w + 3 <= r.x || r.x + r.w + 3 <= rx || ry + h + 3 <= r.y || r.y + r.h + 3 <= ry);
      let lugar = [tx, ty];
      if (!disponible(tx, ty)) {
        const opciones = [[tx, ty - h - 4], [x - w - 10, y - 17], [x + 10, y - 17], [tx, y + 3]];
        lugar = opciones.find(([rx, ry]) => rx >= 4 && rx + w <= W - 4 && ry >= arriba && ry + h <= abajo && disponible(rx, ry)) || lugar;
      }
      const [rx, ry] = lugar;
      rectangulos.push({ x: rx, y: ry, w, h });
      marca.style.transform = `translate(${x}px, ${y}px)`;
      nombre.style.transform = `translate(${Math.round(rx - x)}px, ${Math.round(ry - y)}px)`;
    }
  }

  return { mostrar, proyectar, cerrar: () => capa.remove() };
}
