# Design system

Fonte: arquivo **Page_Portifolio** no Paper, página **SpeakToAll**, artboard "Brand — Identidade". Implementado em `src/renderer/common/tokens.css`.

## Cores

| Token CSS | Valor | Uso |
|---|---|---|
| `--sta-ink` | `#0E0F13` | Texto, botão escuro |
| `--sta-bg` | `#FFFFFF` | Fundo ("Papel") |
| `--sta-muted` | `#6B6F7B` | Texto secundário ("Grafite") |
| `--sta-line` | `#E6E7EB` | Bordas |
| `--sta-soft` | `#F4F5F7` | Sidebar, superfícies suaves |
| `--sta-panel` | `#14161C` | Pílula do overlay, toast |
| `--sta-cobalt` | `#2346FF` | **Ação e destaque** (botão primário, foco, seleção) |
| `--sta-onair` | `#FF3B30` | **Só gravação** (ponto ON AIR, reunião ativa, bandeja gravando) |
| `--sta-ok` | `#16A34A` | Motor pronto, ditado concluído |

Regra da marca: vermelho **só** aparece quando algo está gravando.

Tema escuro: ativado por `prefers-color-scheme` ou `data-theme="dark"` em `<html>` (configuração **Tema**); redefine fundo, texto, linhas e superfícies.

## Tipografia

- **Geist** — interface. Títulos em ExtraBold 800 com `letter-spacing: -0.035em` (classe `.display`).
- **Geist Mono** — hotkey, timers, nome do modelo, rótulos técnicos (classes `.mono`, `.eyebrow`).

## Raios

`--r-sm: 8px` (botões, campos) · `--r-md: 14px` (cartões) · `--r-pill: 999px` (pílulas).

## Logo

Balão de fala com ondas sonoras dentro de um círculo preto: a voz (ondas azuis) virando mensagem (balão branco). Na bandeja as ondas ficam vermelhas enquanto grava. Fonte em `assets/icon.svg` (também como `<symbol id="logo-mark">` em `index.html`); a bandeja usa `assets/tray.svg` / `tray-rec.svg`, com traço mais grosso para ler em 16–32 px.

```svg
<svg viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="#0B0B0D"/>
  <path d="M30 28h40a9 9 0 0 1 9 9v22a9 9 0 0 1-9 9H48l-13 11V68h-5a9 9 0 0 1-9-9V37a9 9 0 0 1 9-9z" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linejoin="round"/>
  <path d="M38 44v8M46 39v18M54 42v12M62 46v4" stroke="#3B7BFF" stroke-width="4.5" stroke-linecap="round"/>
</svg>
```

Os PNG/ICO (instalador, executável, janela, bandeja) saem dos SVGs; depois de mudar um SVG, regenere e versione:

```bash
npx electron scripts/gerar-icones.js   # build/icon.ico, build/icon.png, assets/icon.png, assets/tray*.png
```

## Movimento

- Só animar `transform` e `opacity` (e `stroke-dashoffset` em SVG): fica na composição da GPU, sem layout/repaint.
- Troca de aba: a view que entra faz fade + sobe 6 px em 220 ms (`cubic-bezier(.2,.7,.2,1)`); a que sai some na hora.
- Lobby de abertura: em todo arranque a frio a logo se monta enquanto o app carrega — disco, balão desenhado, ondas em cascata (que pulsam até o app ficar pronto) e o nome letra a letra — em ~3,5 s, com um jingle sintetizado em Web Audio (`src/renderer/main/jingle.js`, sem arquivo de áudio). Sai quando a montagem terminou e o init acabou (teto de 6 s); clique ou tecla pula e corta o som. Reabrir do tray não mostra o lobby e volta para a aba Notas (`window:shown`).
- `prefers-reduced-motion: reduce` desliga o lobby (e o jingle) e as transições.

## Componentes (`tokens.css`)

| Classe | Descrição |
|---|---|
| `.btn` · `.btn-primary` · `.btn-ink` · `.btn-onair` · `.btn-ghost` · `.btn-danger` · `.btn-sm` · `.btn-lg` | Botões |
| `.pill` (+ `.ok`, `.onair`, `.cobalt`) com `.dot` | Status (motor, origem da nota, ON AIR) |
| `kbd` | Teclas |
| `.card` · `.input` · `.select` · `.textarea` | Superfícies e campos |
| `.toggle` | Interruptor (`<span class="toggle"><input type="checkbox"><span></span></span>`) |
| `.seg` | Controle segmentado (botões com `aria-pressed`) |
| `.progress > i` | Barra de progresso (largura em `%`) |

Layout da janela principal (`main.css`): sidebar de 232 px + conteúdo; notas em duas colunas (lista + detalhe); painel de IA à direita; responsivo abaixo de 1100 px e 760 px.
