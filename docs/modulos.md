# Módulos

## Backend — `src/main/`

Todos CommonJS. Os singletons são `EventEmitter`. Só `main.js`, `windows.js`, `tray.js` e `injector.js` dependem do Electron; o resto roda em Node puro (útil para testes).

### `main.js`
Bootstrap: `requestSingleInstanceLock`, inicializa os módulos com os diretórios de `userData`, registra todos os handlers IPC (ver [ipc.md](ipc.md)) e liga eventos dos módulos à UI.
- Mudança em `model`, `language`, `initialPrompt`, `threads`, `engineFlavor` → reinicia o `whisper-server` (exceto durante instalação).
- Mudança em `hotkeyCode`, `hotkeyModifiers`, `hotkeyMode`, `tapToLock` → reconfigura `hotkeys`.
- `startWithWindows` → `app.setLoginItemSettings`.

### `windows.js`
Cria a janela principal (fecha para a bandeja se `closeToTray`) e o overlay (`frame:false, transparent, alwaysOnTop, focusable:false, skipTaskbar`). `overlayCommand(cmd)` posiciona o overlay centralizado embaixo da tela do cursor e envia o comando. Configura permissões de mídia e o `setDisplayMediaRequestHandler` com `audio:'loopback'`.

### `config.js`
`init(userDataDir)`, `get()`, `set(patch)` → grava `settings.json` de forma atômica e emite `'changed', settings, changedKeys` só para chaves que realmente mudaram. `DEFAULTS` exportado.

### `engine.js`
| Função | O que faz |
|---|---|
| `init({dataDir})` | Define `bin/whisper` e `models/` |
| `MODELS` | `tiny`, `base`, `small`, `medium-q5_0`, `large-v3-turbo-q5_0` (recomendado) |
| `detectHardware()` | CPU/threads, RAM, GPU via `nvidia-smi` → flavor e modelo recomendados |
| `install({flavor, model}, onProgress)` | Baixa o zip do whisper.cpp v1.8.6 (blas ou cublas-12.4.0) e o modelo (`.part` → rename), extrai com `Expand-Archive`. Progresso a cada 150 ms. Troca de flavor apaga `bin/whisper` |
| `cancel()` | Aborta o download |
| `start(settings)` / `stop()` / `restart()` | Sobe `whisper-server.exe` numa porta livre com `-bs 5 -bo 5`, espera aceitar conexões (até 120 s) |
| `status()` | `{installed, ready, model, flavor}`; emite `'status'` quando muda |
| `transcribe(wav, {language})` | POST `/inference` (`verbose_json`) → `{text, segments, language}` |
| `transcribeFile(path, opts, onSegment, onProgress)` | `whisper-cli.exe -oj -pp -np`, lê `[hh:mm:ss --> ...]` e `progress = N%` do stdout → `{promise, cancel}` |
| `cleanTranscript(text)` | Remove tags `[...]` e sons entre parênteses conhecidos, `♪`, junta numa linha |
| `postProcess(text, lang, variant)` | Chinês: OpenCC (`cn`↔`twp`) + pontuação full-width |

### `hotkeys.js`
Hook passivo com `uiohook-napi`. Estados `idle → held → locked`.
- `configure({keycode, modifiers, mode:'hold'|'toggle', tapToLock})`, `start()`, `stop()`, `setEnabled()`, `reset()`.
- Eventos `start`, `stop`, `lock`, `cancel`. Toque < 350 ms com `tapToLock` trava; nova tecla após 300 ms para. Esc cancela.
- `captureNext()` → `{label, keycode, modifiers}` (ou `null` com Esc). Helpers `keycodeToLabel`, `comboLabel`. F9 = 67.

### `injector.js` + `injector.ps1`
PowerShell persistente, protocolo de uma linha por comando, resposta `OK`/`ERR`.
- Comandos: `PING`, `PASTE`, `TYPE <base64>`, `SIZE` (retorna `sizeof(INPUT)` — deve ser 40 em x64), `EXIT`.
- `inject(text, 'paste'|'type')` serializado em fila; reinicia o PowerShell se ele morrer; timeout de 30 s por comando.

### `dictation.js`
Máquina de estados do ditado (ver [arquitetura.md](arquitetura.md#fluxo-de-um-ditado)). `init({...módulos})`, `start()`, `stop()`, `cancel()`, `onAudio(wav)`. Emite `'state'` (usado pela bandeja) e envia `dictation:state` à UI.

### `notes.js`
Um `<id>.json` por nota. `create`, `get`, `list` (sem segmentos, mais recente primeiro), `update`, `delete` (apaga o áudio junto), `export(id, 'txt'|'md'|'srt')` → `{filename, content}`. Emite `'changed'`.

### `jobs.js`
Fila **serial** de transcrição de arquivos. `init({notes, transcribeFn, tmpDir})`, `enqueue({name, wavBuffer, durationMs, source, keepAudio, audioDir})` → id da nota (= id do job), `cancel(id)`. Emite `'update'` com `{id, name, status, progress, segments}`.

### `ai.js`
`summarize(note, settings)` → `{title, summary}` (JSON pedido ao modelo, extraído de forma robusta). `chat(note, messages, settings, onChunk, signal)` → streaming SSE; erros chegam como `onChunk({error})`.

### `tray.js`
Ícone desenhado em código (barras do logo; vermelho ao gravar). Menu: Abrir, Gravar/Parar, Plugins (comandos), Sair. `setRecording(bool)`, `setPluginCommands(cmds)`.

### `plugins/`
Sistema de plugins (ver [plugins.md](plugins.md)).
- `plugin.js`: classe base `Plugin` (`addTextProcessor`, `addCommand`, `registerEvent`, `registerInterval`, `loadData`/`saveData`, `notify`), com limpeza automática.
- `api.js`: `createApi()` monta o objeto `app` entregue aos plugins.
- `index.js`: singleton. `init`, `scan`, `enable`/`disable`/`reload`, `list`, `commands`, `runCommand`, `processText(text, ctx)`, `dispatch(event, payload)`, `setBlocked(ids)`. Emite `'changed'`. Exporta `validateManifest` e `cmpVersion`.
- `store.js`: `fetchCatalog` (com cache offline), `install`/`update`/`uninstall` a partir da última release do GitHub, `checkUpdates`.

### `i18n.js`
`load(lang)` lê `src/common/locales/<lang>.json` (fallback `en`), `t(key, vars)` com `{var}`.

## Front-end — `src/renderer/`

| Arquivo | Papel |
|---|---|
| `common/tokens.css` | Design system (ver [design-system.md](design-system.md)) |
| `common/audio.js` | `encodeWav`, `fileToWav` (reamostra 16 kHz), `createRecorder(streams, onLevel)`, `fmtClock` → `window.staAudio` |
| `common/pcm-worklet.js` | AudioWorklet que repassa blocos `Float32Array` |
| `common/wp-mock.js` | Implementação falsa de `window.wp` para abrir as páginas no navegador |
| `main/index.html · main.css · main.js` | Janela principal: notas, importar, reunião, configurações, onboarding, painel de IA |
| `overlay/overlay.html · overlay.js` | Pílula: estados gravando / transcrevendo / pronto / erro, barras RMS, bipes |

## Preloads — `src/preload/`
- `main-preload.js` expõe `window.wp` completo e filtra eventos por allowlist.
- `overlay-preload.js` expõe só `onCommand`, `sendAudio`, `hide`.
