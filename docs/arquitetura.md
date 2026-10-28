# Arquitetura

O Electron é só a casca. Quem reconhece a voz é o **whisper.cpp** (binários prontos baixados na primeira execução); o app orquestra tudo por processos filhos e HTTP local em `127.0.0.1`.

```
┌──────────────────────────── Processo MAIN (Node/Electron) ────────────────────────────┐
│                                                                                        │
│  hotkeys.js ──(uiohook-napi)──► estados idle / held / locked                            │
│       │ start · stop · lock · cancel                                                    │
│       ▼                                                                                │
│  dictation.js   idle → recording → transcribing → idle                                  │
│       │  overlay:command                    ▲ overlay:audio (WAV 16 kHz mono)            │
│       ▼                                     │                                           │
│  ┌──────────── Janela OVERLAY (renderer, focusable:false) ────────────┐                 │
│  │ getUserMedia → AudioWorklet (PCM) → encodeWav → pílula com níveis  │                 │
│  └────────────────────────────────────────────────────────────────────┘                 │
│       ▼                                                                                │
│  engine.js ── POST /inference ──► whisper-server.exe (modelo carregado, porta livre)     │
│       │      └─ arquivos longos ─► whisper-cli.exe (stdout em streaming)                │
│       ▼                                                                                │
│  cleanTranscript + postProcess (tags de silêncio, uma linha, OpenCC p/ chinês)           │
│       ▼                                                                                │
│  injector.js ──stdin──► powershell.exe persistente (injector.ps1) ──► SendInput          │
│       ▼                                                                                │
│  notes.js  (1 JSON por nota)      jobs.js (fila serial)      ai.js (OpenAI-compatível)   │
│  config.js · i18n.js · tray.js · windows.js                                              │
└────────────────────────────────────────────────────────────────────────────────────────┘
            ▲ IPC (contextBridge → window.wp)
┌───────── Janela PRINCIPAL (renderer, HTML/CSS/JS puro) ─────────┐
│ Notas · Importar áudio · Reunião · Configurações · Onboarding    │
└──────────────────────────────────────────────────────────────────┘
```

## Processos e janelas

| Peça | Onde | Papel |
|---|---|---|
| Processo main | `src/main/main.js` | Instância única, inicializa módulos, registra IPC |
| Janela principal | `src/renderer/main/` | Notas, importação, reunião, configurações, onboarding |
| Janela overlay | `src/renderer/overlay/` | Captura o microfone e mostra a pílula de gravação. Transparente (`backgroundColor: #00000000`, 360x110 para a sombra caber), sempre no topo, **sem foco**; só aparece depois do primeiro carregamento para não piscar um retângulo preto no Windows |
| `whisper-server.exe` | processo filho | Mantém o modelo na memória → ditado quase instantâneo |
| `whisper-cli.exe` | processo filho (sob demanda) | Arquivos longos, com progresso e segmentos em streaming |
| `powershell.exe` | processo filho persistente | Executa `SendInput` (Ctrl+V ou digitação Unicode) |

## Fluxo de um ditado

1. **Tecla** — `hotkeys.js` observa o teclado (hook passivo, não bloqueia a tecla) e emite `start`.
2. **Checagem** — `dictation.js` confere `engine.status()`. Sem motor: mostra erro no overlay e abre o onboarding.
3. **Gravação** — manda `{type:'start'}` ao overlay, que aparece com `showInactive()` (não rouba o foco do app de destino) e grava em 16 kHz.
4. **Soltar** — `stop` → overlay codifica WAV PCM 16-bit mono e envia por `overlay:audio`.
5. **Transcrição** — áudios < 350 ms são descartados; o resto vai para `engine.transcribe` (POST `/inference`).
6. **Limpeza** — `cleanTranscript` remove `[BLANK_AUDIO]`, `(música)`, `♪` e junta tudo numa linha (evita Enter acidental em chats). Em seguida o texto passa pelos processadores dos plugins ativos (`plugins.processText`).
7. **Injeção** — `injector.inject(text, mode)`:
   - `paste`: salva clipboard → escreve texto → 80 ms → Ctrl+V → restaura após 350 ms.
   - `type`: digita caractere a caractere com `KEYEVENTF_UNICODE`.
8. **Nota** — se `saveDictationNotes`, cria a nota (e guarda o WAV se `saveAudio`).
9. **Fim** — overlay mostra ✓ e some em 1 s; `hotkeys.reset()`.

## Importação e reunião

- **Importar**: o renderer decodifica o arquivo (`decodeAudioData`), reamostra para 16 kHz mono com `OfflineAudioContext` e envia o WAV → `jobs.enqueue` → `whisper-cli`. A nota é criada logo no início e recebe segmentos a cada ~4 s.
- **Reunião**: `getDisplayMedia` com `audio:'loopback'` (WASAPI do Windows = som do sistema) + microfone opcional, ligados ao **mesmo** AudioWorklet (o Web Audio soma as fontes). Limite de 4 h. Ao parar, vira job com áudio preservado.

## Onde ficam os dados

Tudo em `%APPDATA%\speaktoall\`:

| Caminho | Conteúdo |
|---|---|
| `settings.json` | Configurações (merge sobre `DEFAULTS` de `config.js`) |
| `notes/<id>.json` | Uma nota por arquivo |
| `audio/` | WAVs guardados (reuniões, ditados com `saveAudio`) |
| `bin/whisper/` | Binários do whisper.cpp + `flavor.txt` (cpu/cuda) |
| `models/ggml-<id>.bin` | Modelos baixados do Hugging Face |
| `tmp/` | WAVs temporários de jobs |
| `plugins/<id>/` | Plugins instalados (ver [plugins.md](plugins.md)) |
| `plugin-data/<id>.json` | Dados salvos por cada plugin |
| `plugins-catalog.json` | Último catálogo da loja |

Notas enviadas ao Obsidian são gravadas na pasta escolhida pelo usuário (de preferência um vault), fora desta pasta (ver [integracoes.md](integracoes.md)).

## Segurança

- `contextIsolation: true`, `nodeIntegration: false`; renderers só veem `window.wp`, com allowlist de eventos.
- Permissões de mídia liberadas só para `media`, `audioCapture`, `display-capture`.
- CSP nas páginas; `open-external` aceita apenas `http(s)://`.
- `aiApiKey` fica em `settings.json` em texto puro e não aparece em `getSettings()` dos plugins.
- A gravação no vault do Obsidian limpa os nomes, ignora `..` e confere se o destino está dentro da pasta escolhida.
