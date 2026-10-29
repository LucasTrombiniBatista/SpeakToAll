<p align="center">
  <img src="assets/icon.svg" width="88" alt="Logo de SpeakToAll">
</p>

<h1 align="center">SpeakToAll</h1>

<p align="center"><a href="README.md">English</a> · <a href="README.pt-BR.md">Português</a> · <strong>Español</strong></p>

<p align="center"><strong>Habla. Se vuelve texto. En cualquier lugar.</strong></p>

<p align="center">
  <a href="https://github.com/LucasTrombiniBatista/SpeakToAll/releases/latest">Descargar para Windows</a> ·
  <a href="docs/arquitetura.md">Cómo funciona</a> ·
  <a href="docs/plugins.md">Plugins</a>
</p>

<p align="center">
  <img src="docs/media/ditado.gif" width="760" alt="Manteniendo F9: la píldora graba, transcribe y el texto aparece en el editor">
</p>

Aplicación de escritorio para Windows que transcribe tu voz **sin conexión** y escribe el resultado en cualquier programa. Mantén pulsada una tecla (<kbd>F9</kbd> por defecto), habla, suelta — el texto aparece donde esté el cursor y queda guardado como nota.

Stack: Electron + JavaScript puro como base, reconocimiento de voz con los binarios de [whisper.cpp](https://github.com/ggml-org/whisper.cpp), inserción de texto con `SendInput` de Win32.

## Funcionalidades

- **Dictado global** — mantener para hablar, toque rápido para grabar con manos libres, <kbd>Esc</kbd> cancela.
- **Notas** — cada dictado se convierte en una nota con búsqueda; exporta a `.txt`, `.md` y `.srt`.
- **Importar audio** — MP3/WAV/M4A/video transcritos en cola, con el texto apareciendo en vivo.
- **Reuniones** — graba el audio del sistema (Teams/Meet/Zoom) + micrófono y lo transcribe.
- **IA opcional** — resumen y chat sobre la nota mediante cualquier API compatible con OpenAI: local (Ollama, LM Studio) o en la nube con clave (OpenAI, OpenRouter, Groq).
- **Integración con Obsidian** — envía la nota a tu vault con título, carpeta y etiquetas sugeridos por la IA; tú revisas y confirmas.
- **Plugins** — amplían el dictado y la bandeja; consulta [docs/plugins.md](docs/plugins.md).
- **Sin conexión por defecto** — el audio nunca sale de tu computadora; el texto solo sale si eliges una IA en la nube.

<p align="center">
  <img src="docs/media/tour.gif" width="760" alt="Recorriendo las pestañas: notas, importar audio, reunión, plugins y configuración">
</p>

### Notas

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/notes-dark.png">
  <img src="docs/media/notes-light.png" alt="Lista de notas con la nota abierta al lado">
</picture>

### Importar audio y reuniones

<table>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/import-dark.png"><img src="docs/media/import-light.png" alt="Importar audio"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/meeting-dark.png"><img src="docs/media/meeting-light.png" alt="Grabar reunión"></picture></td>
  </tr>
</table>

### Plugins y configuración

<table>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/plugins-dark.png"><img src="docs/media/plugins-light.png" alt="Plugins"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/settings-dark.png"><img src="docs/media/settings-light.png" alt="Configuración"></picture></td>
  </tr>
</table>

### Tema claro y oscuro

Sigue a Windows o queda fijo; la barra de título lo acompaña. En Configuración → Ventana puedes abrirla en ventana, maximizada o a pantalla completa (<kbd>F11</kbd> alterna).

<p align="center">
  <img src="docs/media/tema.gif" width="760" alt="Alternando entre tema oscuro y claro">
</p>

> Por ahora la interfaz de la aplicación está en portugués.

## Instalar

Descarga `SpeakToAll Setup <versión>.exe` en [Releases](https://github.com/LucasTrombiniBatista/SpeakToAll/releases/latest). Requisitos: Windows 10/11 x64 y ~200 MB libres para el motor + modelo `base` (hasta ~600 MB con `large-v3-turbo`).

**Actualizaciones:** las nuevas versiones se descargan en segundo plano. Cuando están listas aparece un aviso discreto; al reiniciar (o al salir de la aplicación) la instalación ocurre en silencio, sin abrir el instalador de nuevo. La comprobación automática se puede desactivar en Configuración.

## Desarrollo

Requiere Node.js 20+ (el proyecto usa 24, ver `.nvmrc`).

```bash
npm install
npm start
```

En la primera ejecución el asistente detecta el hardware y descarga whisper.cpp y el modelo en `%APPDATA%\speaktoall`.

Para ver solo la interfaz en el navegador (sin Electron, con datos falsos), abre `src/renderer/main/index.html`.

```
SpeakToAll/
├── assets/                 # iconos de la app, la bandeja y el instalador (SVG + generados)
├── build/                  # recursos del instalador (ICO, barra lateral)
├── docs/                   # documentación (docs/media: capturas del README)
├── examples/plugins/       # plugin de ejemplo
├── scripts/                # generar iconos y capturas del README
├── src/
│   ├── main/               # proceso principal (Node) — backend
│   ├── preload/            # puentes seguros main ↔ renderer (window.wp)
│   ├── renderer/
│   │   ├── common/         # tokens.css, audio.js, pcm-worklet.js, wp-mock.js
│   │   ├── main/           # ventana principal (notas, importar, reunión, configuración, onboarding)
│   │   └── overlay/        # píldora de grabación
│   └── common/locales/     # traducciones
└── test/                   # pruebas (node --test)
```

## Documentación

Por ahora la documentación técnica está escrita en portugués.

| Documento | Contenido |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Visión general, procesos, flujo de un dictado, dónde se guardan los datos |
| [docs/modulos.md](docs/modulos.md) | Cada módulo del backend y del front-end, su API y eventos |
| [docs/ipc.md](docs/ipc.md) | Contrato `window.wp`: canales, eventos, comandos del overlay, formatos |
| [docs/design-system.md](docs/design-system.md) | Identidad visual, tokens, componentes, iconos, barra de título |
| [docs/integracoes.md](docs/integracoes.md) | Integración con Obsidian y cómo añadir nuevas |
| [docs/plugins.md](docs/plugins.md) | Cómo escribir e instalar plugins |
| [docs/desenvolvimento.md](docs/desenvolvimento.md) | Pruebas, distribución, problemas conocidos, pendientes |

## Licencia

Consulta [LICENSE](LICENSE).
