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

Quatro barras arredondadas (forma de onda); a última é mais alta e em cobalto (vermelho na versão "gravando"). Está como `<symbol id="logo-mark">` em `index.html`, em `assets/*.svg` e desenhado em bitmap em `tray.js`.

```svg
<svg viewBox="0 0 56 56">
  <rect x="2"  y="20" width="8" height="16" rx="4"/>
  <rect x="15" y="12" width="8" height="32" rx="4"/>
  <rect x="28" y="18" width="8" height="20" rx="4"/>
  <rect x="43" y="4"  width="6" height="48" rx="3" fill="#2346FF"/>
</svg>
```

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
