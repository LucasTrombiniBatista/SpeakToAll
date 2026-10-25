# SpeakToAll

**Fale. Vira texto. Em qualquer lugar.**

App desktop para Windows que transcreve sua voz **offline** e digita o resultado em qualquer programa. Segure uma tecla (padrão <kbd>F9</kbd>), fale, solte — o texto aparece onde o cursor estiver e fica salvo como nota.

Baseado na arquitetura do [WhisperPress](https://github.com/b84330808/whisperpress) (veja `whisperpress-explicacao.md`): Electron + JavaScript puro como casca, reconhecimento de voz pelos binários do [whisper.cpp](https://github.com/ggml-org/whisper.cpp), injeção de texto pelo `SendInput` do Win32.

## Funcionalidades

- **Ditado global** — segurar para falar, toque rápido para gravar com as mãos livres, <kbd>Esc</kbd> cancela.
- **Notas** — todo ditado vira nota pesquisável; exporta `.txt`, `.md` e `.srt`.
- **Importar áudio** — MP3/WAV/M4A/vídeo transcritos em fila, com o texto aparecendo ao vivo.
- **Reunião** — grava o áudio do sistema (Teams/Meet/Zoom) + microfone e transcreve.
- **IA local opcional** — resumo e chat sobre a nota via API compatível com OpenAI (Ollama, LM Studio).
- **100% offline** — o áudio nunca sai do computador.

## Requisitos

- Windows 10/11 x64
- Node.js 20+ (o projeto usa 24, veja `.nvmrc`)
- ~200 MB livres para motor + modelo `base` (até ~600 MB com `large-v3-turbo`)

## Como rodar

```bash
npm install
npm start
```

Na primeira execução o assistente detecta o hardware e baixa o whisper.cpp e o modelo para `%APPDATA%\speaktoall`.

Para ver só a interface no navegador (sem Electron, com dados falsos), abra `src/renderer/main/index.html`.

## Estrutura

```
SpeakToAll/
├── assets/                 # ícone do app e da bandeja (SVG)
├── docs/                   # documentação
├── src/
│   ├── main/               # processo principal (Node) — backend
│   ├── preload/            # pontes seguras main ↔ renderer (window.wp)
│   ├── renderer/
│   │   ├── common/         # tokens.css, audio.js, pcm-worklet.js, wp-mock.js
│   │   ├── main/           # janela principal (notas, importar, reunião, config, onboarding)
│   │   └── overlay/        # pílula de gravação
│   └── common/locales/     # traduções
└── whisperpress-explicacao.md   # referência de arquitetura original
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Visão geral, processos, fluxo de um ditado, onde ficam os dados |
| [docs/modulos.md](docs/modulos.md) | Cada módulo do backend e do front-end, API e eventos |
| [docs/ipc.md](docs/ipc.md) | Contrato `window.wp`: canais, eventos, comandos do overlay, formatos |
| [docs/design-system.md](docs/design-system.md) | Identidade visual (Paper), tokens, componentes |
| [docs/desenvolvimento.md](docs/desenvolvimento.md) | Como testar, armadilhas conhecidas, pendências |
