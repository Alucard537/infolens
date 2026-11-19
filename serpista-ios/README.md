# Serpista para iPhone · IPA

Aplicación iOS instalada desde Windows con PlumeImpactor, con identidad propia `com.serpista.diagnostico.ios`. Usa WKWebView dentro de su propia ventana y conecta con el servidor Serpista existente. El usuario abre el icono SERPISTA; no necesita abrir Safari. Las cuentas, permisos, máquinas y formación siguen en el servidor. El centro hereda la sesión de Serpista sin otro acceso independiente.

El proyecto contiene únicamente la carcasa nativa, iconos y configuración de compilación. No contiene bases de usuarios, credenciales, el bot del servidor ni una copia del código privado de la aplicación. No convierte en funciones iOS los programas exclusivos de Windows o el módulo WiFi de Android.

## Compilación

El esquema reproduce el método del visor InfoLens: un Mac de GitHub Actions compila un ejecutable iPhone arm64 sin firma; PlumeImpactor firma e instala la IPA en el PC con el Apple ID del propietario. InfoLens conserva su identidad y archivos.

La estructura remota prevista es `serpista-ios/ios/...` y `.github/workflows/serpista-ios.yml` en una rama independiente `serpista-ios`. No se modifica la rama principal de InfoLens ni se crea una publicación Releases automática.

En un Mac: entrar en `ios`, ejecutar `xcodegen generate` y compilar el esquema Serpista para `generic/platform=iOS` con firma deshabilitada. La workflow guarda `SERPISTA-iPhone-1.0.0.ipa` como artefacto. Un ZIP de fuentes no es una IPA compilada.

## Instalación desde Windows

1. Conectar el iPhone por USB, desbloquearlo y confiar en el ordenador si lo solicita.
2. Abrir PlumeImpactor, seleccionar el iPhone e importar la IPA compilada.
3. Firmar e instalar usando el mismo proceso y Apple ID que para InfoLens. Introducir los datos únicamente en la herramienta; no enviarlos al chat.
4. Si iOS lo pide, confiar en el perfil y habilitar Modo de desarrollador en Ajustes → Privacidad y seguridad.
5. Abrir SERPISTA y entrar con su cuenta habitual. Tailscale debe estar conectado si la red del servidor lo requiere.

Con una cuenta gratuita, la documentación de Impactor indica siete días de validez y un máximo de tres aplicaciones simultáneas. Renovar la firma con la misma identidad y Apple ID preserva la posibilidad de actualizar; no es necesario borrar InfoLens para preparar esta aplicación. La instalación y renovación se completan en el teléfono/PC del usuario.

## Funcionamiento

La vista nativa conserva los datos web de la sesión, permite vídeos dentro de la aplicación, giro de pantalla, volver/actualizar, PDF y enlaces con ventana nueva dentro de la app y exportación mediante la hoja de compartir. Cámara y micrófono se solicitan solo para el origen de Serpista y respetan la confirmación de iOS. No se omite la validación TLS ni se configura una excepción global HTTP. Los errores de red ofrecen reintento sin borrar la sesión.

Fuentes: [WKWebView de Apple](https://developer.apple.com/documentation/webkit/wkwebview) y [FAQ de Impactor](https://impactor.claration.dev/docs/troubleshooting/faq/).

Estado inicial: fuentes preparadas; pendiente compilar en macOS y verificar la IPA. Las validaciones locales de archivos no son una compilación Xcode ni una prueba física.
