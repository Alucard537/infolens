// Conserva la silueta que contiene el punto de mira y elimina las islas del fondo.
export function aislarMascara(pixeles, ancho, alto, alfa, cola) {
  const centroX = Math.floor(ancho / 2), centroY = Math.floor(alto / 2);
  const radio = Math.max(1, Math.round(Math.min(ancho, alto) * 0.025));
  let inicio = -1, menorDistancia = radio * radio + 1;
  for (let y = Math.max(0, centroY - radio); y <= Math.min(alto - 1, centroY + radio); y++) {
    for (let x = Math.max(0, centroX - radio); x <= Math.min(ancho - 1, centroX + radio); x++) {
      const i = y * ancho + x;
      const distancia = (x - centroX) ** 2 + (y - centroY) ** 2;
      if (pixeles[i] === 0 && distancia < menorDistancia) {
        inicio = i;
        menorDistancia = distancia;
      }
    }
  }
  if (inicio < 0) return null;

  let izquierda = ancho, arriba = alto, derecha = 0, abajo = 0;
  let area = 0;
  function marcar(i) {
    const canal = i * 4 + 3;
    if (pixeles[i] !== 0 || alfa[canal]) return;
    alfa[canal] = 255;
    cola[area++] = i;
  }
  marcar(inicio);
  for (let leidos = 0; leidos < area; leidos++) {
    const i = cola[leidos];
    const x = i % ancho, y = Math.floor(i / ancho);
    izquierda = Math.min(izquierda, x);
    arriba = Math.min(arriba, y);
    derecha = Math.max(derecha, x);
    abajo = Math.max(abajo, y);
    if (x > 0) marcar(i - 1);
    if (x < ancho - 1) marcar(i + 1);
    if (y > 0) marcar(i - ancho);
    if (y < alto - 1) marcar(i + ancho);
  }
  return { izquierda, arriba, derecha, abajo, area };
}
