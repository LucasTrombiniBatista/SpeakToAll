# Plugins

Plugins estendem o SpeakToAll sem mexer no código do app. O modelo segue o do Obsidian: cada plugin é uma pasta com um manifest e um `main.js`, recebe uma API controlada e tudo que ele registra é desfeito ao ser desativado. A loja é só um índice JSON que aponta para as releases do GitHub de cada autor.

## Onde ficam

| Caminho (`%APPDATA%\speaktoall\`) | Conteúdo |
|---|---|
| `plugins/<id>/manifest.json` | Metadados |
| `plugins/<id>/main.js` | Código (CommonJS, roda no processo main) |
| `plugin-data/<id>.json` | Dados do plugin (`loadData`/`saveData`); sobrevive a atualizações |
| `plugins-catalog.json` | Último catálogo baixado (cache offline e kill switch) |

## Manifest

```json
{
  "id": "maiuscula-inicial",
  "name": "Maiúscula inicial",
  "version": "1.0.0",
  "minAppVersion": "0.1.0",
  "author": "SpeakToAll",
  "description": "Começa cada frase ditada com letra maiúscula.",
  "permissions": ["text"]
}
```

- `id`: minúsculas, números e `-`, e precisa ser igual ao nome da pasta.
- `minAppVersion`: plugins que pedem uma versão mais nova que a do app são recusados.
- `permissions`: obrigatórias e aplicadas pela API (menor privilégio). Uma permissão desconhecida recusa o manifest; usar algo não declarado lança `plugin X não declarou a permissão "..."`.

| Permissão | Libera |
|---|---|
| `text` | `addTextProcessor` e o evento `dictation:text` |
| `notes:read` | `app.notes.list/get` e o evento `note:created` |
| `notes:write` | `app.notes.create/update` |
| `network` | Só declarativa (aparece na Loja); ainda não é bloqueada, ver Segurança |

`notes` (formato antigo) vale `notes:read` + `notes:write`. Sem permissão nenhuma, o plugin ainda pode usar `addCommand`, `notify`, `loadData/saveData`, `registerInterval`, os eventos `dictation:state`/`settings:changed` e `app.getSettings()` (só configurações não sensíveis).

## Código

```js
module.exports = ({ Plugin }) => class MeuPlugin extends Plugin {
  async onload() {
    this.addTextProcessor((text, { source, language }) => text.replace(/\bjava script\b/gi, 'JavaScript'));
    this.addCommand({ id: 'ola', name: 'Dizer olá', run: () => this.notify('Olá!') });
    this.registerEvent('note:created', (note) => console.log('nova nota', note.id));
  }
  onunload() {}
};
```

O host injeta a classe base pela factory. Exportar direto uma classe que estende `Plugin` também funciona, mas exige importar a classe por conta própria.

### API da classe `Plugin`

| Método | O que faz |
|---|---|
| `addTextProcessor(fn)` | `fn(text, {source, language})` → texto (sync ou async). Roda no ditado antes de inserir o texto e no texto final de importações e reuniões. Os processadores são encadeados na ordem de carregamento |
| `addCommand({id, name, run})` | Botão na aba Plugins e item no submenu "Plugins" da bandeja |
| `registerEvent(name, fn)` | `dictation:state` `{state}` · `dictation:text` `{text, language}` · `note:created` (nota) · `settings:changed` (configurações seguras) |
| `registerInterval(fn, ms)` | `setInterval` limpo automaticamente |
| `loadData()` / `saveData(obj)` | JSON isolado por plugin |
| `notify(msg)` | Toast na janela principal |

### `this.app`

`version`, `notes.{list, get, create, update}` e `getSettings()`. Este último devolve só `uiLanguage`, `language`, `injectMode`, `theme`, `hotkey` e `hotkeyMode`. A API só cresce: remover algo quebra plugins publicados.

## Ciclo de vida e falhas

- Na inicialização, o app lê `plugins/*`, valida os manifests e carrega os que estão em `enabledPlugins` (em `settings.json`).
- Se o `onload` lançar um erro, o plugin é descarregado e o erro aparece na aba Instalados. O app continua funcionando.
- Erros em processadores, eventos e comandos são registrados no plugin, e o texto segue sem alteração.
- Ao desativar o plugin (ou ao sair do app), o `onunload` roda e depois tudo que foi registrado é desfeito.
- **Modo restrito** (`restrictedMode`): nenhum plugin é carregado.

## Loja

O catálogo fica em `pluginCatalogUrl`, por padrão `https://raw.githubusercontent.com/speaktoall/plugins/main/plugins.json`:

```json
{
  "plugins": [
    {
      "id": "maiuscula-inicial",
      "name": "Maiúscula inicial",
      "author": "SpeakToAll",
      "description": "…",
      "repo": "autor/repositorio",
      "version": "1.0.0",
      "sha256": { "manifest.json": "<64 hex>", "main.js": "<64 hex>" },
      "category": "Texto",
      "permissions": ["text"]
    }
  ],
  "blocked": []
}
```

- O catálogo só é baixado quando a aba Loja é aberta. Sem rede, a loja usa o cache.
- **Entradas sem `version` e `sha256` de cada arquivo são ignoradas** (não aparecem na Loja).
- **Instalar**: o app lê a release da versão fixada (`GET /repos/<repo>/releases/tags/<version>`, nunca a `latest`) e baixa `manifest.json` e `main.js`. Confere o sha256 de cada arquivo com o catálogo; se algum não bater, a instalação é recusada. Depois valida o manifest e só então substitui a pasta. O plugin entra desativado.
- **Atualizações**: só existem quando o catálogo sobe a `version` (com novos hashes), ou seja, toda atualização passa pela revisão do catálogo.
- **Kill switch**: os ids em `blocked` são descarregados e não carregam mais. Na inicialização, vale o `blocked` do último catálogo salvo, sem acessar a rede.

### Publicar um plugin

1. Crie uma release no GitHub com `manifest.json` e `main.js` como assets. A tag precisa ser igual à `version`.
2. Calcule os hashes (`certutil -hashfile main.js SHA256` ou `sha256sum`) e abra um PR no repositório do catálogo com a entrada, `version` e `sha256`.
3. Depois da revisão e do merge, o plugin aparece na Loja.

## Segurança

Modelo parecido com o do Obsidian, endurecido com menor privilégio: permissões aplicadas na API, downloads com versão fixada e sha256, kill switch e Modo restrito.

**Limitação conhecida:** plugins ainda rodam no processo main, com Node. Um plugin malicioso pode contornar as permissões chamando `require('fs')` direto; por isso a revisão do catálogo continua sendo a defesa principal. O isolamento real (sandbox do Chromium, sem Node e sem rede) está nos próximos passos. Os textos vindos de manifests e do catálogo são renderizados com `textContent`.

## Exemplo

`examples/plugins/maiuscula-inicial/`: copie a pasta para `%APPDATA%\speaktoall\plugins\` e ative o plugin na aba Plugins.

## Próximos passos

- Repositório do catálogo com uma GitHub Action que valide os PRs (manifest válido, id único e igual ao do catálogo, release com os arquivos).
- Sandbox: rodar cada plugin num renderer isolado, com a API só por mensagens e `network` bloqueada de fato.
- `styles.css` e pontos de extensão de interface.
- Sandbox (processo utilitário/Worker) com permissões aplicadas de fato.
