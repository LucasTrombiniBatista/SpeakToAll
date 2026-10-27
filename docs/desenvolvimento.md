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
- **Não declarar `const wp`** nos scripts do renderer: colide com o global `window.wp` do contextBridge (por isso `main.js` usa `api`).
- **Elementos com `display:flex` ignoram `hidden`** — `tokens.css` força `[hidden]{display:none!important}`.

## Pendências

- Caminho **CUDA** não testado (sem GPU NVIDIA na máquina de desenvolvimento).
- Cancelamento de download no meio não testado.
- **Empacotamento**: falta a seção `build` do `electron-builder` (NSIS + portable, `npmRebuild: false`) com `asarUnpack` para `node_modules/uiohook-napi/**` e `src/main/injector.ps1`.
- Traduções: os textos da interface estão em português direto no HTML; `locales/*.json` cobrem só a navegação.
- Integrações: só Obsidian por enquanto; Notion e outros estão planejados (ver [integracoes.md](integracoes.md)).
- Binários do whisper.cpp não são assinados — o SmartScreen pode pedir "Executar assim mesmo".
