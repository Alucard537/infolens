// Ajustes generales de la app. Cambia aquí el nombre.
export const APP_NAME = 'InfoLens';
export const QR_PREFIX = 'INFOLENS:';

// Valores por defecto (se pueden cambiar en la app, botón ⚙ del escáner)
export const DEFAULTS = {
  qrCm: 10,        // lado del QR impreso (solo la zona negra, sin el margen blanco)
  fovGrados: 65,   // campo de visión del lado largo del vídeo de la cámara principal
  camaraId: '',    // cámara elegida ('' = automática)
};
