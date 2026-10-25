# Contrato IPC (`window.wp`)

Os renderers nunca acessam Node. Tudo passa por `window.wp`, criado no preload com `contextBridge`. O mock (`src/renderer/common/wp-mock.js`) implementa a mesma interface.

## Janela principal — chamadas (`ipcRenderer.invoke`)

| `window.wp.` | Canal | Retorno |
|---|---|---|
| `i18n()` | `i18n:get` | dicionário do idioma da interface |
| `getSettings()` | `settings:get` | objeto de configurações |
| `setSettings(patch)` | `settings:set` | configurações atualizadas |
| `engineStatus()` | `engine:status` | `{installed, ready, model, flavor}` |
| `detectHardware()` | `engine:hardware` | `{cpu, ramGb, gpu, recommendedFlavor, recommendedModel}` |
| `installEngine({flavor, model})` | `engine:install` | status após instalar e subir o servidor |
| `cancelInstall()` | `engine:cancel` | — |
| `listNotes()` | `notes:list` | notas sem `segments` |
| `getNote(id)` | `notes:get` | nota completa |
| `updateNote(id, patch)` | `notes:update` | nota |
| `deleteNote(id)` | `notes:delete` | — |
| `exportNote(id, fmt)` | `notes:export` | abre diálogo "Salvar como"; `true` se salvou |
| `transcribeFile(name, wav, durationMs)` | `transcribe:start` | id do job/nota |
| `meetingDone(wav, {title, durationMs})` | `meeting:done` | id do job/nota |
| `summarize(id)` | `ai:summarize` | `{title, summary}` (já salvo na nota) |
| `chat(id, messages)` | `ai:chat` | — (resposta chega por `ai:chunk`) |
| `captureHotkey()` | `hotkey:capture` | rótulo da tecla (ex.: `"Ctrl+Shift+K"`) ou `null` |
| `previewOverlay(state)` | `overlay:preview` | mostra o overlay no estado pedido |
| `openExternal(url)` | `open-external` | só `http(s)://` |
| `on(event, cb)` | — | função para remover o listener |

## Janela principal — eventos (`wp.on`)

Só os eventos desta lista são aceitos (allowlist no preload).

| Evento | Payload |
|---|---|
| `settings:changed` | configurações completas |
| `engine:progress` | `{stage: 'engine' \| 'model' \| 'starting', percent, totalMb}` |
| `engine:status` | `{installed, ready, model, flavor}` |
| `jobs:update` | `{id, name, status: 'queued' \| 'running' \| 'done' \| 'error', progress, segments, error?}` |
| `notes:changed` | — |
| `ai:chunk` | `{delta}` · `{error}` · `{done: true}` |
| `dictation:state` | `{state: 'idle' \| 'recording' \| 'transcribing' \| 'needs-setup'}` |

## Overlay

| Direção | Canal | Conteúdo |
|---|---|---|
| main → overlay | `overlay:command` | `{type: 'start', sounds, micDevice}` · `stop` · `cancel` · `lock` · `transcribing` · `done` · `error` (+ `message`) |
| overlay → main | `overlay:audio` | `ArrayBuffer` WAV PCM 16-bit mono 16 kHz |
| overlay → main | `overlay:hide` | — |

O overlay **sempre** devolve o áudio ao parar; quem descarta gravações < 350 ms é o `dictation.js`.

## Formatos

**Nota** (`%APPDATA%\speaktoall\notes\<id>.json`)

```json
{
  "id": "mvn4whwn-rdybkw",
  "createdAt": 1793000000000,
  "title": "Olá, este é um teste de ditado…",
  "text": "Olá, este é um teste de ditado…",
  "segments": [{ "t0": 0, "t1": 4200, "text": "…" }],
  "durationMs": 9156,
  "language": "pt",
  "source": "dictation",
  "audioFile": null,
  "summary": null
}
```

`source`: `dictation` · `import` · `meeting`. Tempos em milissegundos.

**Configurações** — chaves de `settings.json`: `hotkey`, `hotkeyCode`, `hotkeyModifiers`, `hotkeyMode`, `tapToLock`, `micDevice`, `language`, `model`, `engineFlavor`, `threads`, `initialPrompt`, `injectMode`, `sounds`, `saveDictationNotes`, `saveAudio`, `aiBaseUrl`, `aiModel`, `theme`, `uiLanguage`, `startWithWindows`, `closeToTray`, `onboarded`, `chineseVariant`.
