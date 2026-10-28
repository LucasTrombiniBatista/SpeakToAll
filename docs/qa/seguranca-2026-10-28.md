# Auditoria de segurança — 2026-10-28

Feita pelo agente `security-auditor`, somente leitura, na branch `test/qa-seguranca`. Nenhum achado crítico.

| Sev. | Arquivo:linha | Problema | Correção sugerida |
|---|---|---|---|
| Alta | `src/main/plugins/index.js:93-98` | O `main.js` do plugin roda com `require` no processo main, com Node completo; `Object.freeze` e `SAFE_SETTINGS` não isolam nada (dá para ler a `aiApiKey` e executar comandos) | Rodar os plugins em `utilityProcess` com API só por mensagens; no mínimo, avisar que plugin tem acesso total |
| Alta | `src/main/plugins/store.js:92-111` | Instalação e update baixam a "latest release" sem hash, assinatura nem versão fixada | sha256 por versão no catálogo, conferido antes de gravar |
| Média | `src/main/main.js:43`, `src/main/config.js:51-60` | `settings:set` aceita qualquer chave e tipo: um XSS no renderer troca `pluginCatalogUrl`, `aiBaseUrl` ou `obsidianVault` | Lista de chaves permitidas + validação de tipo; `pluginCatalogUrl` fora do alcance do renderer |
| Média | `src/main/config.js:12`, `src/main/main.js:42` | `aiApiKey` fica em texto puro e vai inteira ao renderer | `safeStorage`; mandar ao renderer só se ela existe (mascarada) |
| Média | `src/main/windows.js:13-14` | Permissões de mídia liberadas sem checar a origem | Liberar só para `file://` das janelas conhecidas |
| Média | `src/main/windows.js:16-19` | Captura de tela e áudio loopback concedida sem checar a origem | Checar a origem e conceder só durante reunião iniciada pelo usuário |
| Baixa | `src/main` | Sem `will-navigate` / `setWindowOpenHandler` | Bloquear navegação; `window.open` → `shell.openExternal` |
| Baixa | `src/main/windows.js:28,49` | `sandbox` implícito | Declarar `sandbox: true` |
| Baixa | `src/main/integrations/obsidian.js:91,93` | `source`/`language` sem aspas no YAML | Usar `yamlStr()` |

Pontos bons: `contextIsolation` ligado e `nodeIntegration` desligado nas duas janelas; CSP sem `unsafe-inline` em script; injector via base64 + SendInput; `safeFolder` e a flag `wx` no Obsidian; ids de nota validados; `open-external` só aceita http(s).

Ainda não revisado a fundo: preloads, `engine:install`, `transcribe:start`/`meeting:done` (`meta`), `plugins:run-command`.
