# Testes de combinação — 2026-10-28

Feitos pelo agente `combination-tester` com módulos puros em Node (`uiohook-napi` substituído por um stub, `Date.now` controlado). O app não foi aberto.

## Resultado

- **Passaram:** atalho F9 em hold, toggle, tap-to-lock, auto-repeat, Esc, guarda de relock, Ctrl+F9, Shift extra, Ctrl sozinho e hotkey desabilitada; `safeFolder`, títulos duplicados, pasta inexistente e tags do Obsidian; `cleanTranscript` e `postProcess` (zh); config corrompida; `srtTime`.
- **Não testável sem o app:** ditado e reunião com áudio real, provedor de IA com rede, bandeja, vários monitores, DPI, injector, pasta sem permissão.

## Bugs

| # | Onde | Problema | Status |
|---|---|---|---|
| 1 | `src/main/hotkeys.js` (`configure`, `_finishCapture`) | Alterar o atalho durante uma gravação travada zerava o estado sem avisar o ditado; a gravação ficava órfã | **Corrigido**: emite `cancel` (`_abort()`) |
| 2 | `src/main/integrations/obsidian.js` (`buildMarkdown`) | Título com quebra de linha partia o H1 | **Corrigido** |
| 3 | `src/main/ai.js` (`extractJson`) | Desistia no primeiro `{` inválido (`'{x} {"a":1}'` → `null`) | **Corrigido**: tenta o próximo `{` |
| 4 | `src/main/config.js:44` | Merge raso: `hotkeyModifiers` parcial chega ao renderer sem `alt`/`shift`/`meta` | Aberto (impacto baixo) |

Observação: `obsidian:open` monta o link `obsidian://` mesmo quando a pasta não é um vault.

Testes de regressão: `test/` (`npm test`).
