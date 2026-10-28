# SpeakToAll

**Fale. Vira texto. Em qualquer lugar.**

App desktop para Windows que transcreve sua voz **offline** e digita o resultado em qualquer programa. Segure uma tecla (padrão <kbd>F9</kbd>), fale, solte — o texto aparece onde o cursor estiver e fica salvo como nota.

Stack: Electron + JavaScript puro como casca, reconhecimento de voz pelos binários do [whisper.cpp](https://github.com/ggml-org/whisper.cpp), injeção de texto pelo `SendInput` do Win32.

## Funcionalidades

- **Ditado global** — segurar para falar, toque rápido para gravar com as mãos livres, <kbd>Esc</kbd> cancela.
- **Notas** — todo ditado vira nota pesquisável; exporta `.txt`, `.md` e `.srt`.
- **Importar áudio** — MP3/WAV/M4A/vídeo transcritos em fila, com o texto aparecendo ao vivo.
- **Reunião** — grava o áudio do sistema (Teams/Meet/Zoom) + microfone e transcreve.
- **IA opcional** — resumo e chat sobre a nota via API compatível com OpenAI: local (Ollama, LM Studio) ou na nuvem com chave (OpenAI, OpenRouter, Groq).
- **Integração com o Obsidian** — envia a nota ao seu vault com título, pasta e tags sugeridos pela IA; você revisa e confirma.
- **Offline por padrão** — o áudio nunca sai do computador; o texto só sai se você escolher uma IA na nuvem.

## Requisitos

- Windows 10/11 x64
- Node.js 20+ (o projeto usa 24, veja `.nvmrc`)
- ~200 MB livres para motor + modelo `base` (até ~600 MB com `large-v3-turbo`)

## Instalar

Baixe o `SpeakToAll Setup <versão>.exe` em [Releases](https://github.com/LucasTrombiniBatista/SpeakToAll/releases/latest). O app avisa quando sai versão nova e se atualiza com a sua permissão.

## Como rodar (desenvolvimento)

```bash
npm install
npm start
```

Na primeira execução o assistente detecta o hardware e baixa o whisper.cpp e o modelo para `%APPDATA%\speaktoall`.

Para ver só a interface no navegador (sem Electron, com dados falsos), abra `src/renderer/main/index.html`.

## Estrutura

```
SpeakToAll/
├── assets/                 # ícone do app e da bandeja (SVG + PNG gerados)
├── docs/                   # documentação
├── src/
│   ├── main/               # processo principal (Node) — backend
│   ├── preload/            # pontes seguras main ↔ renderer (window.wp)
│   ├── renderer/
│   │   ├── common/         # tokens.css, audio.js, pcm-worklet.js, wp-mock.js
│   │   ├── main/           # janela principal (notas, importar, reunião, config, onboarding)
│   │   └── overlay/        # pílula de gravação
│   └── common/locales/     # traduções
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Visão geral, processos, fluxo de um ditado, onde ficam os dados |
| [docs/modulos.md](docs/modulos.md) | Cada módulo do backend e do front-end, API e eventos |
| [docs/ipc.md](docs/ipc.md) | Contrato `window.wp`: canais, eventos, comandos do overlay, formatos |
| [docs/design-system.md](docs/design-system.md) | Identidade visual (Paper), tokens, componentes |
| [docs/integracoes.md](docs/integracoes.md) | Integração com o Obsidian e como adicionar novas |
| [docs/desenvolvimento.md](docs/desenvolvimento.md) | Como testar, armadilhas conhecidas, pendências |

## Atualizações

No app instalado, novas versões são baixadas em segundo plano. Quando ficam prontas aparece um aviso discreto; ao reiniciar (ou ao sair do app) a instalação acontece em silêncio, sem abrir o instalador de novo. Dá para desligar a verificação automática em Configurações.
