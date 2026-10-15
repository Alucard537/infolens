// Filtro "One Euro": suaviza mucho cuando algo está quieto y poco cuando se mueve rápido.
function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.01, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0; this.t = 0;
  }
  reset() { this.x = null; }
  filter(valor, tiempoMs) {
    if (this.x === null) { this.x = valor; this.dx = 0; this.t = tiempoMs; return valor; }
    const dt = Math.max((tiempoMs - this.t) / 1000, 1e-3);
    this.t = tiempoMs;
    const dxNuevo = (valor - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (dxNuevo - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (valor - this.x);
    return this.x;
  }
}
