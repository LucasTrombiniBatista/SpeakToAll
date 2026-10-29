# Desenvolvimento

## Rodar

```bash
npm install     # Electron, uiohook-napi, opencc-js
npm start       # electron .
```

O hook de teclado (`uiohook-napi`) vem pré-compilado; não precisa de compilador C++.

## Só a interface (sem Electron)

Abra `src/renderer/main/index.html` no navegador. Sem preload, `wp-mock.js` cria um `window.wp` falso com notas de exemplo e download/transcrição/chat simulados.

Overlay isolado: `src/renderer/overlay/overlay.html?preview=recording` (também `transcribing`, `done`). Segurar Espaço grava do microfone de verdade.

Dentro do app: **Configurações → Pré-visualizar overlay**.

## Testar partes do backend

Módulos sem Electron rodam em Node puro:

```bash
# instalar motor + modelo na pasta do app e subir o servidor
node -e "
const engine=require('./src/main/engine');
engine.init({dataDir: process.env.APPDATA+'/speaktoall'});
engine.install({flavor:'cpu', model:'base'}, p=>console.log(p))
  .then(()=>engine.start({model:'base', language:'pt'}))
  .then(s=>{console.log(s); engine.stop();});
"
```

Gerar um WAV de teste com a voz do Windows (PowerShell):

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Maria Desktop')
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, 'Sixteen', 'Mono')
$s.SetOutputToWaveFile("$PWD\teste.wav", $f); $s.Speak('Olá, isto é um teste.'); $s.Dispose()
```

Testar o servidor direto:

```bash
curl 127.0.0.1:<porta>/inference -F file=@teste.wav -F response_format=json
```

O injetor pode ser testado sozinho: `powershell -File src/main/injector.ps1`, digite `PING` (→ `OK`) e `SIZE` (→ `OK 40`).

### Teste de ponta a ponta realizado

Com o modelo `base` em CPU (i7-1185G7), um WAV de 9 s gerado por TTS foi transcrito em **~1,7 s** e injetado corretamente nos modos `paste` e `type`; a nota foi salva em `%APPDATA%\speaktoall\notes`. Erros de nomes próprios (ex.: "SpeakToAll") melhoram colocando a palavra no **prompt inicial** ou usando um modelo maior.

### Testar a integração com o Obsidian

`src/main/integrations/obsidian.js` roda em Node puro:

```bash
mkdir -p /tmp/vault/.obsidian
node -e "
const o=require('./src/main/integrations/obsidian');
console.log(o.scanVault('/tmp/vault'));
console.log(o.writeNote('/tmp/vault',{title:'Teste',folder:'Ideias',tags:['ideia'],body:'texto'},{createdAt:Date.now()}));
"
```

Para testar a interface no Electron enquanto outra instância do app está aberta, use outra pasta de dados (o bloqueio de instância única vale por pasta): `npx electron . --user-data-dir=<pasta-temporária>`.

## Armadilhas conhecidas

- **Overlay precisa de `focusable:false`** e `showInactive()`, senão o foco sai do app de destino e o Ctrl+V cai no lugar errado.
- **`SendInput` com struct errada retorna 0 em silêncio** — a union de `INPUT` precisa de `MOUSEINPUT` (40 bytes em x64). Verifique com `SIZE`.
- **Servidor whisper em greedy perde pontuação** — usamos `-bs 5 -bo 5`.
- **O Whisper imita o estilo do prompt** — prompt sem pontuação gera texto sem pontuação.
- **Clipboard**: esperar ~350 ms antes de restaurar, senão o destino cola o conteúdo antigo.
- **Parar o servidor antes de reinstalar** — o Windows trava `.exe` em uso (`engine.install` já faz isso).
- **Trocar de flavor (CPU ↔ CUDA)** apaga `bin/whisper/`: `install()` espera o `whisper-server` sair (`stopAndWait`) antes, porque o Windows mantém o .exe/DLLs travados por alguns instantes após o kill (EPERM). Se ainda falhar, a pasta é renomeada para `whisper-old-*` e limpa no próximo `init()`.
- **Não declarar `const wp`** nos scripts do renderer: colide com o global `window.wp` do contextBridge (por isso `main.js` usa `api`).
- **Elementos com `display:flex` ignoram `hidden`** — `tokens.css` força `[hidden]{display:none!important}`.

## Pendências

- Caminho **CUDA** não testado (sem GPU NVIDIA na máquina de desenvolvimento).
- Cancelamento de download no meio não testado.
- **Empacotamento**: falta a seção `build` do `electron-builder` (NSIS + portable, `npmRebuild: false`) com `asarUnpack` para `node_modules/uiohook-napi/**` e `src/main/injector.ps1`.
- Traduções: os textos da interface estão em português direto no HTML; `locales/*.json` cobrem só a navegação.
- Integrações: só Obsidian por enquanto; Notion e outros estão planejados (ver [integracoes.md](integracoes.md)).
- Binários do whisper.cpp não são assinados — o SmartScreen pode pedir "Executar assim mesmo".

## Capturas do README

As imagens e GIFs de `docs/media/` saem dos renderers com o mock (`wp-mock.js`, só dados falsos). Depois de mudar a interface, regenere e versione:

```bash
npx electron scripts/capturar-midia.js   # docs/media/*.png e *.gif
```

## Pílula com fundo preto

Se aparecer um retângulo preto em volta da pílula sobre algum app, confira em `src/main/windows.js` que a janela overlay tem `transparent: true` + `backgroundColor: '#00000000'` e que `showOverlay()` espera o `did-finish-load`. Se persistir só sobre apps com aceleração de GPU, teste rodar com `--disable-direct-composition`.

## Distribuição e atualizações

O instalador é gerado pelo [electron-builder](https://www.electron.build/) (NSIS, instala por usuário em `%LOCALAPPDATA%`, sem pedir admin) e as atualizações vêm do [electron-updater](https://www.electron.build/auto-update), que lê o `latest.yml` do último **GitHub Release** do repositório.

```bash
npm run dist      # gera dist/SpeakToAll Setup <versão>.exe localmente (não publica)
```

**Publicar uma versão** (o CI faz o resto em `.github/workflows/release.yml`):

```bash
npm version patch   # ou minor/major: sobe a versão, cria commit e tag vX.Y.Z
git push --follow-tags
```

A tag dispara o workflow: testes, build e upload do instalador + `latest.yml` para o Release, que já sai publicado (`releaseType: "release"`; sem isso o electron-builder cria rascunho, e o app não enxerga rascunhos). Push comum na `main` **não** gera atualização. O repositório precisa ser público para o app ler os Releases.

**No app instalado:** checa no boot e a cada 6 h (desligável em Configurações). Se houver versão nova, baixa em segundo plano e mostra um aviso discreto no app (ou notificação do sistema, com a janela na bandeja); "Reiniciar agora" instala em modo silencioso (sem o assistente do NSIS) e reabre o app, e "Depois" instala ao sair. Também dá para checar pela bandeja ou pelo botão em Configurações. Com `npm start` o updater fica desligado.

Dados do usuário (configurações, notas, motor e modelos) ficam em `%APPDATA%\speaktoall` e sobrevivem às atualizações.

O ícone do instalador, desinstalador e executável é `build/icon.ico`, gerado de `assets/icon.svg` (veja [design-system.md](design-system.md#logo)).

Limitação atual: o instalador não é assinado (o SmartScreen mostra "editor desconhecido" na primeira instalação).

## Testes automatizados

```bash
npm test        # node --test, sem Electron
```

Ficam em `test/`. O `uiohook-napi` é substituído por um stub em `test/hotkeys.test.js`. Bons próximos alvos: `engine.cleanTranscript`/`postProcess`, `config` (com pasta temporária), `notes.srtTime`, `dictation` com fakes.

## Desempenho da transcrição

- **Velocidade** (Configurações → Motor): *Rápido* (greedy, padrão) ou *Preciso* (beam search 5, de 3 a 5x mais lento na CPU).
- **Threads**: o motor usa os núcleos físicos (`os.cpus().length / 2`, máximo 8). Valores maiores salvos em `settings.json` são limitados, porque o hyperthreading deixa o whisper mais lento.
- **Modelo**: em notebooks de 4 núcleos, `small` ou `medium-q5_0` são bem mais leves que `large-v3-turbo-q5_0`, com alguma perda de precisão.
- **Palavras cortadas**: os segmentos são juntados com o texto cru do whisper (`engine.joinSegments`) e o motor roda com `-sow`, para não aparecer "be m" no lugar de "bem".
- Flash attention já vem ligado por padrão no whisper.cpp.
