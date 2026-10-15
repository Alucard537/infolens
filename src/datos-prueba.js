// Datos escritos a mano solo para la Fase 1. En la Fase 3 vendrán de la base de datos.
const base = import.meta.env.BASE_URL;

const ELEMENTOS = {
  'TEST-1': {
    id: 'TEST-1',
    nombre: 'Válvula de prueba',
    referencia: 'REF-0001-A',
    tipo: 'SENCILLO',
    descripcion: 'Elemento de ejemplo para probar la realidad aumentada. Válvula de bola DN50, PN16, accionamiento manual.',
    imagenUrl: base + 'ejemplo/valvula.svg',
    pdfUrl: base + 'ejemplo/ficha.pdf',
  },
};

export function buscarElemento(id) {
  return ELEMENTOS[id] || null;
}
