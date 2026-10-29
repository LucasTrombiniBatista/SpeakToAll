<p align="center">
  <img src="assets/icon.svg" width="88" alt="SpeakToAll logo">
</p>

<h1 align="center">SpeakToAll</h1>

<p align="center"><strong>English</strong> · <a href="README.pt-BR.md">Português</a> · <a href="README.es.md">Español</a></p>

<p align="center"><strong>Speak. It becomes text. Anywhere.</strong></p>

<p align="center">
  <a href="https://github.com/LucasTrombiniBatista/SpeakToAll/releases/latest">Download for Windows</a> ·
  <a href="docs/arquitetura.md">How it works</a> ·
  <a href="docs/plugins.md">Plugins</a>
</p>

<p align="center">
  <img src="docs/media/ditado.gif" width="760" alt="Holding F9: the pill records, transcribes and the text appears in the editor">
</p>

A Windows desktop app that transcribes your voice **offline** and types the result into any program. Hold a key (<kbd>F9</kbd> by default), speak, release — the text appears wherever your cursor is and is saved as a note.

Stack: Electron + plain JavaScript as the shell, speech recognition by the [whisper.cpp](https://github.com/ggml-org/whisper.cpp) binaries, text injection through Win32 `SendInput`.

## Features

- **Global dictation** — hold to talk, quick tap for hands-free recording, <kbd>Esc</kbd> cancels.
- **Notes** — every dictation becomes a searchable note; export to `.txt`, `.md` and `.srt`.
- **Import audio** — MP3/WAV/M4A/video transcribed in a queue, with text appearing live.
- **Meetings** — records system audio (Teams/Meet/Zoom) + microphone and transcribes it.
- **Optional AI** — summary and chat about a note through any OpenAI-compatible API: local (Ollama, LM Studio) or cloud with an API key (OpenAI, OpenRouter, Groq).
- **Obsidian integration** — sends the note to your vault with a title, folder and tags suggested by the AI; you review and confirm.
- **Plugins** — extend dictation and the tray; see [docs/plugins.md](docs/plugins.md).
- **Offline by default** — audio never leaves your computer; text only leaves if you pick a cloud AI.

<p align="center">
  <img src="docs/media/tour.gif" width="760" alt="Browsing the tabs: notes, import audio, meeting, plugins and settings">
</p>

### Notes

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/media/notes-dark.png">
  <img src="docs/media/notes-light.png" alt="Note list with the open note beside it">
</picture>

### Import audio and meetings

<table>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/import-dark.png"><img src="docs/media/import-light.png" alt="Import audio"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/meeting-dark.png"><img src="docs/media/meeting-light.png" alt="Record a meeting"></picture></td>
  </tr>
</table>

### Plugins and settings

<table>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/plugins-dark.png"><img src="docs/media/plugins-light.png" alt="Plugins"></picture></td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="docs/media/settings-dark.png"><img src="docs/media/settings-light.png" alt="Settings"></picture></td>
  </tr>
</table>

### Light and dark theme

Follows Windows or stays fixed; the title bar follows along. In Settings → Window you can open it windowed, maximized or full screen (<kbd>F11</kbd> toggles).

<p align="center">
  <img src="docs/media/tema.gif" width="760" alt="Switching between dark and light theme">
</p>

> The app interface is currently in Portuguese.

## Install

Download `SpeakToAll Setup <version>.exe` from [Releases](https://github.com/LucasTrombiniBatista/SpeakToAll/releases/latest). Requirements: Windows 10/11 x64 and ~200 MB free for the engine + `base` model (up to ~600 MB with `large-v3-turbo`).

**Updates:** new versions download in the background. When ready, a discreet notice appears; on restart (or when you quit the app) the install happens silently, without opening the installer again. Automatic checks can be turned off in Settings.

## Development

Requires Node.js 20+ (the project uses 24, see `.nvmrc`).

```bash
npm install
npm start
```

On first run the setup wizard detects your hardware and downloads whisper.cpp and the model to `%APPDATA%\speaktoall`.

To see just the interface in a browser (no Electron, fake data), open `src/renderer/main/index.html`.

```
SpeakToAll/
├── assets/                 # app, tray and installer icons (SVG + generated)
├── build/                  # installer resources (ICO, sidebar)
├── docs/                   # documentation (docs/media: README screenshots)
├── examples/plugins/       # example plugin
├── scripts/                # generate icons and README screenshots
├── src/
│   ├── main/               # main process (Node) — backend
│   ├── preload/            # safe main ↔ renderer bridges (window.wp)
│   ├── renderer/
│   │   ├── common/         # tokens.css, audio.js, pcm-worklet.js, wp-mock.js
│   │   ├── main/           # main window (notes, import, meeting, settings, onboarding)
│   │   └── overlay/        # recording pill
│   └── common/locales/     # translations
└── test/                   # tests (node --test)
```

## Documentation

The technical docs are currently written in Portuguese.

| Document | Contents |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Overview, processes, the flow of a dictation, where data lives |
| [docs/modulos.md](docs/modulos.md) | Each backend and front-end module, its API and events |
| [docs/ipc.md](docs/ipc.md) | The `window.wp` contract: channels, events, overlay commands, formats |
| [docs/design-system.md](docs/design-system.md) | Visual identity, tokens, components, icons, title bar |
| [docs/integracoes.md](docs/integracoes.md) | Obsidian integration and how to add new ones |
| [docs/plugins.md](docs/plugins.md) | How to write and install plugins |
| [docs/desenvolvimento.md](docs/desenvolvimento.md) | Testing, distribution, known pitfalls, open issues |

## License

See [LICENSE](LICENSE).
