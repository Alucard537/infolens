// Lectura de la hoja de elementos exportada desde Excel (formato CSV).
// Acepta separador ";" (Excel en español) o ",", y textos en UTF-8 o en la codificación de Windows.

export const COLUMNAS = ['id', 'nombre', 'referencia', 'tipo', 'descripcion', 'foto', 'pdf', 'pdfconexion', 'modelo3d', 'maquina'];

// Nombres alternativos de columnas que también se aceptan
const ALIAS = {
  id: 'id', codigo: 'id', qr: 'id',
  maquina: 'maquina', machine: 'maquina', maquinaid: 'maquina',
  nombre: 'nombre', name: 'nombre',
  referencia: 'referencia', ref: 'referencia', reference: 'referencia',
  tipo: 'tipo', type: 'tipo',
  descripcion: 'descripcion', description: 'descripcion', notas: 'descripcion',
  foto: 'foto', imagen: 'foto', image: 'foto', fotografia: 'foto',
  pdf: 'pdf', documento: 'pdf', ficha: 'pdf', fichatecnica: 'pdf', pdfficha: 'pdf',
  pdfconexion: 'pdfconexion', conexion: 'pdfconexion', conexiones: 'pdfconexion', esquema: 'pdfconexion', pdf2: 'pdfconexion',
  modelo3d: 'modelo3d', modelo: 'modelo3d', glb: 'modelo3d', '3d': 'modelo3d',
};

const simple = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

export function decodificarTexto(buffer) {
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    texto = new TextDecoder('windows-1252').decode(buffer); // CSV guardado por Excel "normal"
  }
  return texto.replace(/^﻿/, '');
}

/** Divide el texto CSV en filas y celdas (respeta comillas y saltos de línea dentro de comillas). */
export function parsearCSV(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const cuenta = (c) => primera.split(c).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];

  const filas = [];
  let fila = [], celda = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else comillas = false;
      } else celda += ch;
    } else if (ch === '"' && celda === '') comillas = true;
    else if (ch === sep) { fila.push(celda); celda = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda); filas.push(fila); fila = []; celda = '';
    } else celda += ch;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((c) => c.trim() !== ''));
}

/** Convierte las filas en objetos con las columnas conocidas. */
export function filasAElementos(filas) {
  if (filas.length < 2) throw new Error('La hoja está vacía (necesita una fila de títulos y al menos un elemento).');
  const cab = filas[0].map((c) => ALIAS[simple(c)] || null);
  if (!cab.includes('nombre') || !cab.includes('referencia')) {
    throw new Error('La primera fila debe tener los títulos de las columnas, al menos "nombre" y "referencia". Usa la plantilla.');
  }
  return filas.slice(1).map((f, i) => {
    const o = { fila: i + 2 };
    cab.forEach((campo, j) => { if (campo) o[campo] = (f[j] || '').trim(); });
    return o;
  });
}

/** Plantilla para abrir con Excel (con BOM para que Excel lea bien los acentos). */
export function plantillaCSV() {
  const filas = [
    'id;nombre;referencia;tipo;descripcion;foto;pdf;pdf_conexion;modelo3d',
    'V-0001;Válvula de bola DN50;REF-0001-A;sencillo;Válvula de entrada principal;V-0001.jpg;V-0001.pdf;V-0001-conexion.pdf;',
    'CV-0001;Cuerpo de válvulas línea 2;REF-CV-200;compuesto;Conjunto de 4 válvulas;cuerpo2.jpg;cuerpo2.pdf;;cuerpo2.stp',
  ];
  return new Blob(['﻿' + filas.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
