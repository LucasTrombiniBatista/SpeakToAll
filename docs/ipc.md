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
| `listModels()` | `ai:models` | ids de `GET /models` do endpoint configurado |
| `pickObsidianVault()` | `obsidian:pick-vault` | `{path, isVault}` (caminho já salvo em `obsidianVault`) ou `null`; qualquer pasta é aceita |
| `obsidianStatus()` | `obsidian:status` | `{exists, isVault}` da pasta configurada (`isVault` = tem `.obsidian/`) |
| `obsidianSuggest(id)` | `obsidian:suggest` | `{folders, tags, presets, suggestion: {title, folder, tags, body}, aiError}`: com a IA fora do ar, `suggestion` traz os padrões e `aiError` traz a mensagem |
| `obsidianWrite(id, {title, folder, tags, body})` | `obsidian:write` | `{path, uri}`: caminho relativo à pasta e link `obsidian://` (`null` se a pasta não for um vault) (o caminho fica salvo em `obsidianPath` na nota) |
| `openInObsidian(relPath)` | `obsidian:open` | abre a nota no Obsidian |
| `captureHotkey()` | `hotkey:capture` | rótulo da tecla (ex.: `"Ctrl+Shift+K"`) ou `null` |
| `previewOverlay(state)` | `overlay:preview` | mostra o overlay no estado pedido |
| `openExternal(url)` | `open-external` | só `http(s)://` |
| `listPlugins()` | `plugins:list` | `[{id, manifest, enabled, loaded, error, commands}]` |
| `enablePlugin(id)` / `disablePlugin(id)` | `plugins:enable` / `plugins:disable` | lista atualizada |
| `reloadPlugins()` | `plugins:reload` | lista atualizada |
| `runPluginCommand(pluginId, commandId)` | `plugins:run-command` | — |
| `openPluginsFolder()` | `plugins:open-folder` | — |
| `storeCatalog()` | `store:catalog` | `{plugins, offline}` |
| `installPlugin(id)` / `updatePlugin(id)` | `store:install` / `store:update` | manifest instalado |
| `uninstallPlugin(id)` | `store:uninstall` | lista atualizada |
| `checkPluginUpdates()` | `store:updates` | `[{id, name, current, latest, minAppVersion, compatible}]` |
| `updateStatus()` | `update:status` | `{state, version, percent, error}` |
| `update:notice` | `{kind: 'downloaded' | 'latest' | 'error', ...status}` — banner/toast no app (sem diálogo nativo) |
| `window:fullscreen` | `boolean` — esconde a faixa da barra de título em tela cheia |
| `window:shown` | — janela principal reaberta (tray/atalho); o app volta para a aba Notas |
| `checkUpdates()` / `downloadUpdate()` | `update:check` / `update:download` | status atual |
| `installUpdate()` | `update:install` | — (fecha, instala em silêncio e reabre) |
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
| `plugins:changed` | — |
| `plugins:notice` | `{pluginId, name, message}` |
| `update:status` | `{state: 'unsupported' \| 'idle' \| 'checking' \| 'latest' \| 'available' \| 'downloading' \| 'downloaded' \| 'error', version, percent, error}` |

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
  "summary": null,
  "obsidianPath": null
}
```

`source`: `dictation` · `import` · `meeting`. Tempos em milissegundos. `obsidianPath` só existe depois de enviar a nota ao Obsidian.

**Configurações** — chaves de `settings.json`: `hotkey`, `hotkeyCode`, `hotkeyModifiers`, `hotkeyMode`, `tapToLock`, `micDevice`, `language`, `model`, `engineFlavor`, `threads`, `initialPrompt`, `injectMode`, `sounds`, `saveDictationNotes`, `saveAudio`, `aiBaseUrl`, `aiModel`, `aiApiKey`, `obsidianVault`, `obsidianFolder`, `obsidianCategories` (uma por linha), `obsidianAutoDetect`, `theme`, `uiLanguage`, `startWithWindows`, `closeToTray`, `onboarded`, `chineseVariant`, `enabledPlugins`, `restrictedMode`, `pluginCatalogUrl`.
