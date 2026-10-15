# Especificación: App web de Realidad Aumentada con QR (iPhone, gratis, sin Mac)

> Documento de definición para desarrollar la app desde VS Code (en Windows) con Claude.
> **Sustituye a la versión Android anterior.**
> Instrucción para Claude: lee este documento entero antes de empezar, trabaja por fases
> (sección 10) y no pases a la siguiente hasta que la actual funcione en el iPhone.
> El usuario tiene pocos conocimientos de programación y usa Windows: explica cada paso en
> español, de forma sencilla, y dile exactamente qué comandos ejecutar y qué debe ver.

---

## 1. Resumen

App de uso personal que, al apuntar la cámara del móvil a un **código QR grande** pegado
en un elemento industrial (válvulas, cuerpos de válvulas y otros elementos variados),
muestra **en realidad aumentada** información flotando sobre él. Tocando un botón **"+"**
se abre una pantalla con más detalle (imagen o PDF).

- **Tipo:** aplicación web instalable (**PWA**). Se abre en Safari y se añade a la pantalla
  de inicio del iPhone, donde funciona como una app normal.
- **Móvil principal:** iPhone 15 Pro Max (Safari / iOS). Debe funcionar también en Android (Chrome).
- **Ordenador del usuario:** Windows, sin Mac. Desarrollo en VS Code.
- **Coste:** cero. Nada de cuentas de pago.
- **Conexión:** una vez instalada, debe funcionar **100 % sin internet**.
- **Datos:** se guardan **solo en el móvil**. El servidor web solo aloja el código de la app.
- **Usuario:** uso propio (una sola persona).
- **Nombre:** pendiente de decidir (provisional: `InfoLens`). Debe ser fácil de cambiar.

### Limitaciones aceptadas (por no usar ARKit nativo)
- El icono 3D se muestra **mientras la cámara ve el QR**. Si el QR sale de la imagen, el icono desaparece.
- El anclaje se calcula a partir de las 4 esquinas del QR: es bueno, pero algo menos preciso que ARKit.

---

## 2. Funcionamiento

### 2.1 Elemento sencillo (por ejemplo, una válvula)
1. El usuario apunta la cámara al QR del elemento.
2. Aparece sobre el QR un **círculo 3D azul claro, semitransparente, con una "i" en el centro**,
   colocado en 3D según la posición e inclinación del QR (no un simple dibujo plano en pantalla).
3. Junto al icono se muestra el **nombre** y la **referencia** del elemento.
4. Hay un botón **"+"**. Al tocarlo (o al tocar el icono) se abre la **pantalla de detalle**.

### 2.2 Elemento compuesto (por ejemplo, un cuerpo de válvulas)
1. El usuario apunta al QR del conjunto.
2. Aparece sobre el QR la **representación 3D del conjunto**:
   - Si existe modelo 3D (`.glb`), se muestra el modelo.
   - Si solo hay foto, se muestra la foto como **panel flotante** en 3D.
3. Junto a ella, el **nombre**, la **referencia** y el botón **"+"**.

### 2.3 Pantalla de detalle
- Nombre, referencia, tipo y descripción.
- **Imagen** con zoom (pellizcar) y **PDF** con paso de páginas y zoom, todo dentro de la app y sin internet.
- Botones *Editar* e *Imprimir QR*.

### 2.4 Gestión de elementos (dentro de la app)
Habrá unos **500 elementos** que se irán añadiendo poco a poco, sin tocar el código:

- **Añadir elemento:** nombre, referencia, tipo (sencillo / compuesto), descripción opcional,
  foto (cámara o galería), PDF (desde Archivos), modelo 3D `.glb` opcional.
- **Editar y borrar.**
- **Lista y buscador** por nombre o referencia.
- **Generar QR** de cada elemento, en tamaño grande con nombre y referencia debajo; y una hoja
  con varios QR para imprimir de golpe (descargable en PDF o imprimible desde el iPhone).
- **Copia de seguridad:** exportar e importar todo (datos + archivos) en un único `.zip`.
  **Muy importante:** los datos solo viven en el móvil, así que la app debe recordar al usuario
  hacer copia de seguridad (por ejemplo, un aviso si lleva más de 2 semanas sin hacerla).

---

## 3. Tecnología propuesta

| Necesidad | Tecnología |
|---|---|
| Proyecto y servidor de desarrollo | Vite + JavaScript (o TypeScript si Claude lo ve claro para un principiante) |
| App instalable y sin conexión | `vite-plugin-pwa` (service worker que guarda todo en caché) |
| Cámara | `getUserMedia` (cámara trasera) |
| Lectura de QR (con esquinas) | `zxing-wasm` (rápido; devuelve las 4 esquinas). Alternativa: `jsQR` |
| Posición 3D del QR | Pose a partir de las 4 esquinas y el tamaño real del QR (homografía / POSIT coplanar, p. ej. el de `js-aruco2`), con filtro de suavizado (One Euro filter) para que no tiemble |
| Dibujo 3D | three.js (+ `GLTFLoader` para `.glb`) |
| Base de datos local | IndexedDB con Dexie.js (guarda elementos y archivos como Blob) |
| Visor de PDF | pdf.js, **incluido en la app** (sin CDN) |
| Generar QR | librería `qrcode` |
| Hoja de QR en PDF | jsPDF |
| Copia de seguridad | JSZip |
| Alojamiento gratis con HTTPS | GitHub Pages (alternativas: Netlify o Cloudflare Pages) |

Reglas:
- **Todas las librerías van empaquetadas en la app** (nada cargado de internet en tiempo de
  ejecución), para que funcione en modo avión.
- Pedir almacenamiento persistente con `navigator.storage.persist()`.
- Safari en iOS **no** tiene `BarcodeDetector`: no depender de él.
- Interfaz en **español**, botones grandes (uso en taller, posiblemente con guantes).

### 3.1 Preparar el entorno (Windows)
Claude debe guiar al usuario para:
- Instalar **Node.js (LTS)** y **Git**.
- Crear el proyecto con Vite y arrancarlo con `npm run dev`.
- **Probar en el iPhone:** la cámara solo funciona con HTTPS. Opciones:
  - Durante el desarrollo: servidor de Vite con HTTPS en la red local (`@vitejs/plugin-basic-ssl`,
    `--host`) y abrir en Safari la IP del PC (aceptar el aviso de certificado). PC e iPhone en la misma wifi.
  - Para el uso real: publicar en **GitHub Pages** (crear cuenta gratis de GitHub y repositorio).
- **Instalar en el iPhone:** abrir la web en Safari → botón Compartir → *Añadir a pantalla de inicio*.
  Abrirla una vez con internet para que se guarde todo; después funciona sin conexión.

---

## 4. Contenido del QR

Cada QR contiene solo un identificador corto:

```
INFOLENS:<ID>
```

Ejemplo: `INFOLENS:V-0001`. La app busca ese ID en su base de datos local.
- Si el ID no existe: aviso "Elemento no registrado" con opción de **darlo de alta** con ese ID.
- Si el QR no tiene el prefijo: ignorarlo.
- Los QR se imprimen a un **tamaño fijo conocido** (por defecto **10 × 10 cm**, configurable en
  ajustes), porque ese tamaño se usa para calcular la posición 3D.

---

## 5. Modelo de datos (IndexedDB)

Tabla `elementos`:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string (clave) | El que va en el QR, p. ej. `V-0001` |
| `nombre` | string | Obligatorio |
| `referencia` | string | Obligatorio |
| `tipo` | `"SENCILLO"` \| `"COMPUESTO"` | |
| `descripcion` | string? | Opcional |
| `imagenId` / `pdfId` / `modelo3dId` | string? | Apuntan a la tabla `archivos` |
| `creado` / `modificado` | number (timestamp) | |

Tabla `archivos`: `id`, `nombre`, `tipoMime`, `blob`.

Tabla `ajustes`: tamaño del QR impreso, fecha de la última copia de seguridad, etc.

IDs automáticos (`V-0001`, `V-0002`…) o escritos a mano.

---

## 6. Realidad aumentada: cómo colocar el icono

1. Vídeo de la cámara trasera a pantalla completa, con un `<canvas>` de three.js transparente encima.
2. Leer QR cada pocos fotogramas (en un **Web Worker** para no bloquear la imagen), obteniendo el texto y las 4 esquinas.
3. Con las esquinas y el tamaño real del QR, estimar la **pose** (posición + giro) respecto a la cámara.
   Estimar la distancia focal a partir de la resolución del vídeo (campo de visión aproximado de la
   cámara principal del iPhone, ajustable en ajustes para afinar).
4. Colocar el icono/modelo unos centímetros por delante del QR y suavizar el movimiento.
5. Entre lecturas de QR, mantener la última pose unos instantes; si no se ve el QR durante ~1 s, ocultar el icono.
6. Soportar **varios QR a la vez**.
7. Botón de linterna si el navegador lo permite (si no, ocultarlo).

### 6.1 Aspecto visual
- **Icono:** disco 3D **azul claro** (aprox. `#7EC8F2`), **~50 % de transparencia**, con una **"i" blanca**
  en el centro; ligera animación de flotar.
- **Etiqueta:** tarjeta con nombre (grande) y referencia (más pequeño), fondo semitransparente.
- **Botón "+"**: grande y fácil de tocar.

---

## 7. Modelos 3D

- Formato en la app: **`.glb`**.
- Conversión gratis de los archivos de CAD del usuario (Claude debe explicarla paso a paso):
  - STEP → FreeCAD → exportar a OBJ/STL → Blender → exportar a `.glb`.
  - STL/OBJ → Blender → exportar a `.glb`.
- Reducir polígonos (Blender: *Decimate*) y tamaño de archivo para que vaya fluido.
- Escalar el modelo automáticamente a un tamaño razonable sobre el QR (~20–30 cm).

---

## 8. Pantallas

1. **Inicio:** *Escanear*, *Elementos*, *Añadir elemento*, *Copia de seguridad*, *Ajustes*.
2. **Escáner AR:** cámara a pantalla completa con los iconos.
3. **Detalle del elemento.**
4. **Lista de elementos** con buscador y miniaturas.
5. **Formulario añadir/editar.**
6. **Generar/imprimir QR** (uno o varios por hoja).
7. **Copia de seguridad:** exportar/importar `.zip`.
8. **Ajustes:** tamaño del QR impreso, ajuste fino de la cámara, nombre de la app.

---

## 9. Almacenamiento y seguridad de los datos

- Los datos están solo en el iPhone. Si se borra la app de la pantalla de inicio o los datos de Safari, **se pierden**.
- Por eso son obligatorios: almacenamiento persistente, exportar/importar `.zip` y el aviso de copia de seguridad.
- Mostrar en Ajustes cuánto espacio ocupan los datos.

---

## 10. Fases de desarrollo

Cada fase termina con la app probada en el iPhone 15 Pro Max.

### Fase 0 — Entorno
- Instalar Node.js y Git, crear el proyecto Vite y verlo en Safari del iPhone por HTTPS en la red local.

### Fase 1 — Prototipo AR
- Cámara + lectura del QR `INFOLENS:TEST-1` + **icono azul con la "i"** colocado en 3D sobre el QR,
  con nombre y referencia de prueba escritos en el código.
- Botón "+" que abre un detalle con una imagen y un PDF de ejemplo.

### Fase 2 — App instalable y publicada
- Configurar la PWA (icono, nombre, modo sin conexión) y publicar en GitHub Pages.
- Instalar en la pantalla de inicio y comprobar que funciona en modo avión.

### Fase 3 — Base de datos y gestión
- IndexedDB + formulario añadir/editar/borrar con foto, PDF y `.glb`; lista con buscador.
- El escáner usa los datos reales.

### Fase 4 — Elementos compuestos
- Modelo `.glb` o foto como panel flotante sobre el QR de los conjuntos. Guía de conversión desde CAD.

### Fase 5 — QR imprimibles
- QR individuales y hoja con varios, descargables en PDF / imprimibles.

### Fase 6 — Copia de seguridad y retoques
- Exportar/importar `.zip`, aviso de copia, ajustes, nombre e icono definitivos, rendimiento.

---

## 11. Criterios de aceptación

- Funciona en **modo avión** una vez instalada.
- Detecta un QR de 10 × 10 cm a 1–1,5 m con buena luz.
- El icono aparece en menos de 1 segundo y sigue al QR sin temblar demasiado.
- Abrir imagen o PDF tarda menos de 1 segundo.
- Soporta 500 elementos con sus archivos sin que la lista ni el escáner vayan lentos.

---

## 12. Pendiente de decidir

- Nombre definitivo de la app.
- Tamaño definitivo de impresión de los QR.
