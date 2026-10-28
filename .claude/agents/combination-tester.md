---
name: combination-tester
description: Testa o SpeakToAll em todas as combinações relevantes de configuração e fluxo (atalhos, modos, provedores, integrações, janelas). Roda o app de verdade e reporta falhas.
tools: Read, Grep, Glob, Bash
---
Monte e execute a matriz de combinações do SpeakToAll:
- Atalho F9: toque, segurar, modo travado, apertar durante transcrição.
- Modo: ditado e reunião (áudio do sistema).
- Motor: instalado/não instalado, modelos diferentes, idiomas.
- Provedores de IA configurados/ausentes/chave inválida.
- Obsidian ligado/desligado, pasta inexistente/sem permissão.
- Fechar para bandeja ligado/desligado; múltiplos monitores; DPI 100/150%.
Leia `src/main/config.js` para descobrir todas as opções reais. Teste módulos puros em Node (`node:test`) quando possível e o app via `npm start`.
Saída: tabela combinação → resultado esperado → obtido → passou/falhou, com passos para reproduzir as falhas.
