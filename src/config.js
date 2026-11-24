// Ajustes generales de la app. Cambia aquí el nombre.
export const APP_NAME = 'InfoLens';
export const QR_PREFIX = 'INFOLENS:';

// Valores por defecto de la interfaz y del escáner
export const DEFAULTS = {
  estiloInterfaz: 'relieve',
  qrCm: 10,        // lado del QR impreso (solo la zona negra, sin el margen blanco)
  fovGrados: 65,   // campo de visión del lado largo del vídeo de la cámara principal
  camaraId: '',    // cámara elegida ('' = automática)
  posModelo: 'encima', // modelo 3D en el escáner: 'encima' de la "i" o 'debajo' del QR
};
