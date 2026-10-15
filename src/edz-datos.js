// Lectura de los datos de artículo de EPLAN (sin dependencias, para poder probarla aparte).

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desescapar = (t) => t.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTIDADES[e] ?? m;
});

/** Atributos de la primera etiqueta <part ...> del XML de EPLAN. */
export function atributosPart(xml) {
  const m = /<part\s([^>]*)>/.exec(xml);
  if (!m) return null;
  const attrs = {};
  for (const a of m[1].matchAll(/([\w.:-]+)="([^"]*)"/g)) attrs[a[1]] = desescapar(a[2]);
  return attrs;
}

/**
 * Textos multidioma de EPLAN: "de_DE@Hallo;en_EN@Hello;es_ES@Hola;" (";;" es un ";" dentro del texto).
 * Devuelve el texto en español si existe; si no, en inglés; si no, el primero.
 */
export function textoIdioma(valor, preferidos = ['es_ES', 'en_EN', 'en_US']) {
  if (!valor) return '';
  if (!/^[a-z]{2}_[A-Z]{2}@/.test(valor)) return valor.replace(/;;/g, ';').trim();
  const partes = {};
  let primero = null;
  for (const trozo of valor.replace(/;;/g, '\u0000').split(';')) {
    const m = /^([a-z]{2}_[A-Z]{2})@([\s\S]*)$/.exec(trozo);
    if (!m) continue;
    const texto = m[2].replace(/\u0000/g, ';').trim();
    partes[m[1]] = texto;
    if (primero === null) primero = texto;
  }
  for (const p of preferidos) if (partes[p]) return partes[p];
  return primero || '';
}

/** Convierte los atributos del artículo en datos de un elemento de la app. */
export function datosDesdeEplan(a) {
  const pedido = a.P_ARTICLE_ORDERNR || '';
  const numero = a.P_ARTICLE_PARTNR || '';
  const fabricante = a.P_ARTICLE_MANUFACTURER || '';
  const referencia = pedido || numero.replace(new RegExp('^' + fabricante + '\\.'), '') || numero;
  const tipoArticulo = textoIdioma(a.P_ARTICLE_DESCR1) || 'Artículo';
  const nombre = `${tipoArticulo} ${referencia}`.trim();

  const lineas = [];
  if (fabricante) lineas.push(`Fabricante: ${fabricante}`);
  if (numero) lineas.push(`Nº de artículo EPLAN: ${numero}`);
  if (a.P_ARTICLE_TYPENR) lineas.push(`Tipo: ${a.P_ARTICLE_TYPENR}`);
  const d2 = textoIdioma(a.P_ARTICLE_DESCR2);
  if (d2) lineas.push(d2);
  const nota = textoIdioma(a.P_ARTICLE_NOTE);
  if (nota) lineas.push('', nota.replace(/:\s*\n/g, ': '));
  // Enlaces a fichas técnicas (preferir la de español)
  const docs = Object.keys(a).filter((k) => /^P_ARTICLE_EXTERNAL_DOCUMENT_\d+$/.test(k)).sort()
    .map((k) => { const [url, etiqueta] = a[k].split('\n'); return { url: url.trim(), etiqueta: textoIdioma(etiqueta || '') }; })
    .filter((d) => /^https?:\/\//.test(d.url));
  const enEspanol = docs.filter((d) => /\((ES|es)\)/.test(d.etiqueta));
  const elegidos = enEspanol.length ? enEspanol : docs.slice(0, 1);
  if (elegidos.length) {
    lineas.push('');
    for (const d of elegidos) lineas.push(`${d.etiqueta || 'Documento'}: ${d.url}`);
  }
  return { nombre, referencia: referencia || nombre, descripcion: lineas.join('\n').trim(), fabricante, numero };
}
