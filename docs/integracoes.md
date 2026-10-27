# Integrações

Integrações enviam notas do SpeakToAll para outros aplicativos. Ficam em **Configurações > Integrações**. Hoje existe só a do **Obsidian**. Notion e outros devem entrar no mesmo lugar, seguindo o padrão descrito em [Adicionar uma integração](#adicionar-uma-integração).

## Obsidian

Um vault do Obsidian é só uma pasta de arquivos `.md` com uma subpasta `.obsidian/`. Por isso a integração lê e grava direto no disco: não precisa instalar nada no Obsidian, e funciona com ele aberto ou fechado.

O destino pode ser **qualquer pasta**. Recomendamos seguir o padrão de vault do Obsidian para ter a melhor experiência: com `.obsidian/`, você pode abrir a pasta como vault no Obsidian e usar o link `obsidian://` para a nota. Sem essa subpasta, os `.md` são gravados da mesma forma, e a tela de configurações mostra só um aviso.

### Configurar

1. **Configurações > Integrações > Pasta do Obsidian (vault) > Escolher pasta.** Qualquer pasta é aceita. Um vault do Obsidian (com `.obsidian/`) é o recomendado.
2. **Pasta padrão**: para onde a nota vai quando a IA não sugere outra pasta. Vazio = raiz do vault.
3. **Categorias prévias** (opcional): uma por linha, por exemplo `Trabalho/Reuniões`. A IA dá preferência a elas.
4. **Detectar categorias novas**: com essa opção desligada, a IA usa só as categorias prévias.

A IA é opcional. Sem ela, a tela de revisão abre com o título da nota e a pasta padrão para você preencher.

### Enviar uma nota

Abra a nota e clique em **Obsidian**.

1. O app lê as pastas do vault (até 3 níveis) e as tags que já existem no frontmatter das notas (até 2000 arquivos).
2. A IA recebe o texto, essas pastas e tags e as categorias prévias. Ela devolve título, pasta, de 1 a 5 tags e o texto organizado em Markdown, sem acrescentar nem tirar informações.
3. A tela de revisão mostra tudo editável: a pasta e as tags são sugeridas a partir do que já existe no vault.
4. **Salvar no vault** grava o arquivo. A nota recebe `obsidianPath`, e o botão passa a mostrar ✓.

### Arquivo gerado

`<vault>/<pasta>/<título>.md`. O app nunca sobrescreve um arquivo: se o nome já existir, acrescenta ` 2`, ` 3`…

```markdown
---
tags:
  - "cliente"
  - "prazo"
created: 2026-10-27T15:46:40.000Z
source: speaktoall
origin: dictation
duration: 8
language: pt
---
# Reunião com cliente

> [!summary] Resumo
> • Entrega combinada para sexta.

Combinamos a entrega para sexta.
```

- O bloco `[!summary]` só aparece se a nota tiver um resumo gerado pela IA.
- `origin` é `dictation`, `import` ou `meeting`. `duration` está em segundos.
- Tags são normalizadas: sem `#`, com espaços trocados por `-` e em minúsculas.
- Caracteres proibidos em nomes de arquivo, `..` e caminhos absolutos são removidos. Assim, nada é gravado fora da pasta escolhida.

### Provedores de IA

A integração usa a mesma configuração de **Configurações > IA**, que serve qualquer API compatível com OpenAI:

| Provedor | Endpoint | Chave |
|---|---|---|
| Ollama (local) | `http://localhost:11434/v1` | — |
| LM Studio (local) | `http://localhost:1234/v1` | — |
| OpenAI | `https://api.openai.com/v1` | obrigatória |
| OpenRouter | `https://openrouter.ai/api/v1` | obrigatória |
| Groq | `https://api.groq.com/openai/v1` | obrigatória |

**Listar modelos** chama `GET /models` e preenche as sugestões do campo Modelo. A chave (`aiApiKey`) fica em `settings.json`, em texto puro, e não é exposta aos plugins. Com um provedor na nuvem, o texto da nota é enviado a esse serviço. O áudio, por outro lado, nunca sai do computador.

## Adicionar uma integração

Use a do Obsidian como modelo:

1. **Backend**: um módulo em `src/main/integrations/<nome>.js`, em Node puro (sem Electron), para ser testável. Ele deve validar o destino e nunca sobrescrever dados do usuário.
2. **IA**: se precisar de sugestões, reaproveite `completeJson` de `src/main/ai.js`, como faz o `categorize`.
3. **IPC**: crie canais `<nome>:*` em `src/main/main.js`, exponha-os em `src/preload/main-preload.js`, implemente-os no mock (`src/renderer/common/wp-mock.js`) e documente-os em [ipc.md](ipc.md).
4. **Configurações**: crie as chaves em `DEFAULTS` (`src/main/config.js`) com o prefixo do nome da integração e adicione um bloco no grupo **Integrações** de `index.html`. Campos com `data-setting` são ligados automaticamente.
5. **Docs**: uma seção neste arquivo.
