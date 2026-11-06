import type {
  LegacySealName,
  Recipe,
  SealName,
  SenderSeal,
  StampName,
} from "./util";
import {
  buildDescription,
  escapeAttr,
  escapeHtml,
  formatDate,
  isLegacySealName,
  isStampName,
} from "./util";
import { renderMarkdown, toWhatsAppText } from "./markdown";
import { SEAL_IMAGES } from "./seals";
import { APP_ICON } from "./appIcon";

const SITE = "My Recipes";
const ANDROID_PACKAGE = "com.lunnaboo.myrecipes";

/* ------------------------------------------------------------------ *
 * Decorative inline SVG (no external assets, no data: images).
 * ------------------------------------------------------------------ */

const IVY_PATH = `<path d="M2,78 Q8,55 22,42 Q12,44 4,52 M22,42 Q30,22 48,12 Q36,16 28,26 M48,12 Q55,6 66,2" fill="none" stroke="#3A2A1A" stroke-width="2" stroke-linecap="round"/>
<ellipse cx="55" cy="18" rx="5" ry="8" fill="#8A9A5B" transform="rotate(-25 55 18)"/>
<ellipse cx="24" cy="46" rx="6" ry="9" fill="#8A9A5B" transform="rotate(-15 24 46)"/>
<circle cx="68" cy="8" r="2.5" fill="#D4A94A"/>
<circle cx="72" cy="12" r="2" fill="#6E2F3F"/>
<circle cx="14" cy="54" r="2" fill="#D4A94A"/>`;

function ivyCorner(position: "tl" | "br"): string {
  return `<svg class="ivy-corner ${position}" viewBox="0 0 80 80" aria-hidden="true" focusable="false">${IVY_PATH}</svg>`;
}

function flourish(flip = false): string {
  const cls = flip ? "flourish flip" : "flourish";
  return `<svg class="${cls}" viewBox="0 0 40 14" aria-hidden="true" focusable="false">
<path d="M38,7 Q28,2 20,7 Q12,12 2,7" fill="none" stroke="#6B5344" stroke-width="1"/>
<circle cx="4" cy="7" r="2" fill="#D4A94A"/>
<ellipse cx="14" cy="9" rx="4" ry="3" fill="#8A9A5B" transform="rotate(-15 14 9)"/>
</svg>`;
}

function sectionHeader(label: string, heading = false): string {
  const title = heading
    ? `<h1 class="web-section-title">${escapeHtml(label)}</h1>`
    : `<div class="web-section-title">${escapeHtml(label)}</div>`;
  return `<div class="section-header">
${flourish()}
${title}
${flourish(true)}
</div>`;
}

/* ------------------------------------------------------------------ *
 * Seals — photographic wax stamps by default; legacy line-art sigils
 * are still rendered for recipes created before the stamp art landed.
 * ------------------------------------------------------------------ */

const SIGILS: Record<LegacySealName, string> = {
  star: `<path d="M24,7 L28.2,18.2 L40,18.2 L30.4,26 L34.2,38 L24,30.6 L13.8,38 L17.6,26 L8,18.2 L19.8,18.2 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  owl: `<path d="M12,38 L12,22 C12,14 18,8 24,8 C30,8 36,14 36,22 L36,38 C36,40 34,42 32,42 L16,42 C14,42 12,40 12,38 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="19" cy="22" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="29" cy="22" r="5" fill="none" stroke="currentColor" stroke-width="2"/>
<circle cx="19" cy="22" r="1.5" fill="currentColor"/>
<circle cx="29" cy="22" r="1.5" fill="currentColor"/>
<path d="M24,26 L21,30 L27,30 Z" fill="currentColor"/>
<path d="M24,14 L24,10 M18,12 L20,16 M30,12 L28,16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  sun: `<circle cx="24" cy="24" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/>
<path d="M24,5 L24,10 M24,38 L24,43 M5,24 L10,24 M38,24 L43,24 M10.5,10.5 L14,14 M34,34 L37.5,37.5 M37.5,10.5 L34,14 M14,34 L10.5,37.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
};

function renderSigilSeal(
  name: LegacySealName,
  size: "sm" | "lg",
  hook: string,
): string {
  return `<span class="seal seal-${size}" data-seal="${escapeAttr(hook)}" aria-hidden="true">
<svg class="seal-svg" viewBox="0 0 80 80" focusable="false">
<circle cx="40" cy="40" r="39" fill="#2F3B52"/>
<g transform="translate(16 16)">${SIGILS[name]}</g>
<circle cx="40" cy="40" r="38" fill="none" stroke="#202B40" stroke-width="2"/>
</svg>
</span>`;
}

/**
 * Stamp seal: the bundled webp art is inlined as a data URI and scaled with
 * `object-fit: contain`, so irregular silhouettes are never cropped.
 */
function renderStampSeal(
  id: StampName,
  size: "sm" | "lg",
  hook: string,
): string {
  return `<span class="seal seal-${size}" data-seal="${escapeAttr(hook)}" aria-hidden="true"><img class="seal-stamp" src="${escapeAttr(SEAL_IMAGES[id])}" alt=""></span>`;
}

/**
 * Image seal: the decoded bytes are rebuilt as a data URI from the validated
 * mime, then clipped to the same navy circle. The rim sits on top so the
 * photo never paints over it.
 */
function renderImageSeal(
  seal: SenderSeal & { kind: "image" },
  size: "sm" | "lg",
): string {
  const src = `data:${seal.mime};base64,${seal.data}`;
  return `<span class="seal seal-${size} seal-image" data-seal="image" aria-hidden="true">
<img class="seal-photo" src="${escapeAttr(src)}" alt="">
<span class="seal-rim"></span>
</span>`;
}

/**
 * Render one seal. `size` is a preset, not a pixel value, so the seal stays
 * one consistent container at every call site. Stamps render their bundled
 * art, legacy ids keep the line-art sigil, photos keep the circular clip,
 * and anything unrecognised falls back to the cat stamp. The `data-seal`
 * hook is the seal id, `image`, or `default`.
 */
export function renderSeal(
  seal: SenderSeal | SealName | undefined,
  size: "sm" | "lg" = "lg",
): string {
  if (typeof seal === "string") {
    if (isStampName(seal)) return renderStampSeal(seal, size, seal);
    if (isLegacySealName(seal)) return renderSigilSeal(seal, size, seal);
    return renderStampSeal("cat", size, "default");
  }
  if (seal?.kind === "sigil") {
    if (isStampName(seal.id)) return renderStampSeal(seal.id, size, seal.id);
    if (isLegacySealName(seal.id)) return renderSigilSeal(seal.id, size, seal.id);
  }
  if (seal?.kind === "image") {
    return renderImageSeal(seal, size);
  }
  return renderStampSeal("cat", size, "default");
}

const ERROR_ORNAMENT = `<svg class="error-ornament" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
<path d="M40,8 C58,8 72,22 72,40 C72,58 58,72 40,72 C22,72 8,58 8,40 C8,22 22,8 40,8 Z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
<path d="M28,32 L52,56 M52,32 L28,56" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
<circle cx="40" cy="24" r="3" fill="currentColor"/>
</svg>`;

/* ------------------------------------------------------------------ *
 * Stylesheet — one inline response per page, CSP-friendly.
 * ------------------------------------------------------------------ */

const COMMON_CSS = `
:root {
  color-scheme: light;
  --parchment: #E8D9B8;
  --cream: #F0E6CF;
  --ink: #3A2A1A;
  --ink-light: #6B5344;
  --sage: #8A9A5B;
  --sage-light: #9CAB6E;
  --olive: #6B7A3A;
  --olive-dark: #4A5A28;
  --gold: #D4A94A;
  --leafy: #243320;
  --leafy-deep: #1A2616;
  --navy: #2F3B52;
  --navy-dark: #202B40;
  --maroon: #6E2F3F;
  --tan: #C4A87A;

  /* System serif stack mandated by CSP (no external fonts). */
  --font-serif: Georgia, "Iowan Old Style", "Times New Roman", serif;
  --font-ui-serif: ui-serif, Georgia, "Iowan Old Style", "Times New Roman", serif;
}
*, *::before, *::after { box-sizing: border-box; }
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body {
  margin: 0;
  padding: 10px;
  min-height: 100vh;
  min-height: 100dvh;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(36,51,32,0) 0%, rgba(26,38,22,0.9) 100%),
    linear-gradient(180deg, #2a3d25 0%, #1A2616 100%);
  background-attachment: fixed;
  font-family: var(--font-serif);
  color: var(--ink);
  font-size: 18px;
  line-height: 1.6;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}

/* Parchment panel */
.page-panel {
  position: relative;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  min-height: calc(100vh - 20px);
  min-height: calc(100dvh - 20px);
  background: var(--parchment);
  border-radius: 18px;
  box-shadow: 0 8px 24px rgba(26,38,22,0.25);
  display: flex;
  flex-direction: column;
}
.page-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
}
.page-scroll {
  flex: 1 0 auto;
  padding: 28px 20px 92px;
}
.page-scroll.centered {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

/* Ivy corners */
.ivy-corner {
  position: absolute;
  width: 72px;
  height: 72px;
  z-index: 2;
  pointer-events: none;
}
.ivy-corner.tl { top: 10px; left: 10px; }
.ivy-corner.br { bottom: 10px; right: 10px; transform: scaleX(-1) scaleY(-1); }

/* Typography */
.web-section-title {
  font-family: var(--font-ui-serif);
  font-size: 18px;
  line-height: 24px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink);
  text-align: center;
  margin: 0;
}
.web-recipe-title {
  font-family: var(--font-ui-serif);
  font-size: 22px;
  line-height: 28px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--ink);
  margin: 0 0 10px;
}
.web-meta {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--ink-light);
}
.web-body,
.recipe {
  font-family: var(--font-serif);
  font-size: 17px;
  line-height: 28px;
  color: var(--ink);
}
.web-small {
  font-size: 15px;
  line-height: 22px;
  color: var(--ink-light);
}
.web-caption {
  font-size: 12px;
  line-height: 18px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-light);
}

/* Flourished section header */
.section-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 4px 0 22px;
}
.flourish {
  width: 38px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.7;
}
.flourish.flip { transform: scaleX(-1); }

/* Rules */
.rule {
  border: 0;
  height: 1px;
  background: rgba(107,83,68,0.25);
  margin: 18px 0;
}
.rule-dotted {
  border: 0;
  height: 1px;
  background: repeating-linear-gradient(90deg, rgba(107,83,68,0.35), rgba(107,83,68,0.35) 4px, transparent 4px, transparent 8px);
  margin: 18px 0;
}

/* Seal */
.seal {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  vertical-align: middle;
}
.seal-lg { width: 92px; height: 92px; }
.seal-sm { width: 28px; height: 28px; }
.seal-stamp {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.seal-svg {
  display: block;
  width: 100%;
  height: 100%;
  color: var(--cream);
}
.seal-image {
  position: relative;
  overflow: hidden;
  border-radius: 50%;
  background: var(--navy);
}
.seal-photo {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}
.seal-rim {
  position: absolute;
  inset: 0;
  border: 2px solid var(--navy-dark);
  border-radius: 50%;
  box-sizing: border-box;
  pointer-events: none;
}

/* Share page */
.share-seal-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}
.share-from {
  text-align: center;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-light);
  margin-bottom: 14px;
}
.share-head {
  text-align: center;
  margin-bottom: 6px;
}
.share-meta {
  text-align: center;
  margin-bottom: 18px;
}

/* Recipe body */
.recipe > :first-child { margin-top: 0; }
.recipe > :last-child { margin-bottom: 0; }
.recipe p { margin: 0.8rem 0; }
.recipe h2, .recipe h3, .recipe h4, .recipe h5, .recipe h6 {
  font-family: var(--font-ui-serif);
  line-height: 1.3;
  color: var(--ink);
  margin: 1.5rem 0 0.5rem;
  letter-spacing: 0.01em;
}
.recipe a {
  color: var(--maroon);
  text-decoration-color: rgba(110,47,63,0.4);
  text-underline-offset: 2px;
}
.recipe ol, .recipe ul {
  margin: 0.8rem 0;
  padding-left: 1.5rem;
}
.recipe li {
  margin: 0.6rem 0;
  padding-left: 0.2rem;
}
.recipe ol > li::marker {
  color: var(--olive);
  font-weight: 700;
}
.recipe blockquote {
  margin: 1rem 0;
  padding: 0.1rem 0 0.1rem 1rem;
  border-left: 3px solid rgba(107,83,68,0.35);
  color: var(--ink-light);
}
.recipe hr {
  border: 0;
  border-top: 1px solid rgba(107,83,68,0.25);
  margin: 1.5rem 0;
}
.recipe code {
  background: rgba(107,83,68,0.12);
  border-radius: 4px;
  padding: 0.08em 0.3em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.88em;
}
.recipe pre {
  background: rgba(240,230,207,0.75);
  border: 1px solid rgba(107,83,68,0.25);
  border-radius: 10px;
  padding: 0.85rem;
  overflow-x: auto;
  line-height: 1.45;
}
.recipe pre code {
  background: transparent;
  padding: 0;
  font-size: 0.85rem;
}
.task-box { font-size: 1.05em; }

/* Copy status + noscript fallback */
.status {
  min-height: 1.2em;
  margin: 10px 0 0;
  color: var(--ink-light);
  font-size: 13px;
  line-height: 18px;
  text-align: center;
}
.noscript-hint {
  margin: 10px 0;
  text-align: center;
}
.copy-fallback {
  width: 100%;
  min-height: 10rem;
  padding: 0.8rem;
  border: 1.5px solid rgba(107,83,68,0.25);
  border-radius: 10px;
  background: var(--cream);
  color: var(--ink);
  font: inherit;
  font-size: 17px;
  line-height: 1.5;
  resize: vertical;
}

/* Sticky action bar */
.action-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: nowrap;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--parchment);
  border-top: 1px solid rgba(107,83,68,0.25);
  box-shadow: 0 -4px 12px rgba(26,38,22,0.08);
  z-index: 3;
}
.action-bar.single { flex-direction: column; }
.btn {
  flex: 1 1 0;
  min-width: 0;
  min-height: 48px;
  padding: 0 14px;
  border-radius: 24px;
  border: 1.5px solid transparent;
  font-family: var(--font-serif);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: center;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.btn-primary {
  background: var(--olive-dark);
  color: var(--cream);
  border-color: var(--olive-dark);
}
.btn-secondary {
  background: var(--parchment);
  color: var(--ink);
  border-color: rgba(107,83,68,0.45);
}
.btn:active { transform: translateY(1px); }
.btn:focus-visible {
  outline: 3px solid var(--gold);
  outline-offset: 2px;
}

/* Install page */
.install-hero {
  text-align: center;
  margin-bottom: 18px;
}
.install-icon {
  display: block;
  width: clamp(160px, 46vw, 208px);
  height: auto;
  margin: 0 auto 14px;
}
.install-hero p {
  font-size: 17px;
  line-height: 26px;
  color: var(--ink);
  margin: 0 auto;
  max-width: 300px;
}
.unpublished-note {
  padding: 12px 14px;
  background: var(--cream);
  border: 1.5px solid rgba(107,83,68,0.25);
  border-radius: 10px;
  font-size: 16px;
  line-height: 23px;
  color: var(--ink-light);
  margin-bottom: 18px;
}
.install-caption { margin: 0 0 10px; }
.install-steps {
  counter-reset: install;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
}
.install-step {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 17px;
  line-height: 26px;
  color: var(--ink);
}
.install-step::before {
  counter-increment: install;
  content: counter(install) ".";
  font-family: var(--font-ui-serif);
  font-size: 18px;
  font-weight: 700;
  color: var(--gold);
  width: 26px;
  flex-shrink: 0;
  text-align: right;
  line-height: 26px;
}
.install-step-text {
  flex: 1;
  min-width: 0;
  line-height: 26px;
}
.install-step-text em {
  font-style: normal;
  font-weight: 700;
}

/* Error page */
.error-content {
  text-align: center;
  padding: 24px 8px;
}
.error-ornament {
  display: block;
  width: 96px;
  height: 96px;
  margin: 0 auto 18px;
  color: var(--ink-light);
  opacity: 0.8;
}
.error-title {
  font-family: var(--font-ui-serif);
  font-size: 22px;
  line-height: 28px;
  font-weight: 700;
  color: var(--ink);
  margin: 0 0 10px;
}
.error-body {
  font-size: 17px;
  line-height: 26px;
  color: var(--ink-light);
  margin: 0 auto 20px;
  max-width: 280px;
}

/* Footer */
.page-footer {
  text-align: center;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(107,83,68,0.2);
}
.page-footer p {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: var(--ink-light);
}
.page-footer p + p { margin-top: 4px; }

@media (max-width: 380px) {
  .action-bar {
    padding-left: 12px;
    padding-right: 12px;
    gap: 8px;
  }
  .btn { padding: 0 8px; }
  .page-scroll { padding-left: 16px; padding-right: 16px; }
}

@media (min-width: 600px) {
  body { padding: 24px; }
  .page-panel {
    min-height: calc(100vh - 48px);
    min-height: calc(100dvh - 48px);
    border-radius: 22px;
  }
  .page-scroll { padding: 36px 28px 100px; }
  .seal-lg { width: 120px; height: 120px; }
  .share-seal-wrap { margin-bottom: 18px; }
}

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; }
  .btn:active { transform: none; }
}
`;

function shell(options: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  head?: string;
}): string {
  const { title, description, canonical, body, head = "" } = options;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeAttr(description)}">
${head}
<link rel="canonical" href="${escapeAttr(canonical)}">
<style>${COMMON_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function copyButton(copyText: string, variant: "primary" | "secondary"): string {
  return `<button class="btn btn-${variant}" type="button" id="copy" data-copy="${escapeAttr(
    copyText,
  )}">Copiar receita</button>`;
}

export interface SharePageOptions {
  origin: string;
  android: boolean;
  apkAvailable: boolean;
}

export function renderSharePage(
  recipe: Recipe,
  options: SharePageOptions,
): string {
  const canonical = `${options.origin}/r/${recipe.id}`;
  const description = buildDescription(recipe.stepCount, recipe.sender);
  const copyText = toWhatsAppText(recipe.title, recipe.body);
  const rendered = renderMarkdown(recipe.body);
  const when = recipe.createdAt > 0 ? formatDate(recipe.createdAt) : "";

  const host = new URL(options.origin).host;
  const fallbackUrl = encodeURIComponent(canonical);
  const intentUrl =
    `intent://${host}/r/${recipe.id}#Intent;scheme=https;` +
    `package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallbackUrl};end`;

  const senderLine = recipe.sender
    ? `Enviada por ${escapeHtml(recipe.sender)}`
    : "Receita compartilhada";
  const footerLine = when ? `${senderLine} em ${escapeHtml(when)}.` : senderLine;
  const fromLine = recipe.sender
    ? `Carta de ${escapeHtml(recipe.sender)}`
    : "Receita compartilhada";

  let actionBar: string;
  if (options.android) {
    actionBar = `<div class="action-bar">
<a class="btn btn-primary" href="${escapeAttr(
      intentUrl,
    )}" role="button">Abrir no app</a>
${copyButton(copyText, "secondary")}
</div>`;
  } else {
    const download = options.apkAvailable
      ? `<a class="btn btn-secondary" href="/app/latest.apk" role="button">Baixar o app</a>`
      : "";
    actionBar = `<div class="action-bar">
${copyButton(copyText, "primary")}
${download}
</div>`;
  }

  const body = `<div class="page-panel">
${ivyCorner("tl")}
${ivyCorner("br")}
<main class="page-content">
<div class="page-scroll">
${sectionHeader("Receita")}
<div class="share-seal-wrap">${renderSeal(recipe.senderSeal, "lg")}</div>
<div class="share-from">${fromLine}</div>
<div class="share-head">
<h1 class="web-recipe-title">${escapeHtml(recipe.title)}</h1>
</div>
<div class="share-meta web-meta">${escapeHtml(description)}</div>
<hr class="rule">
<div class="recipe web-body">
${rendered}
</div>
<noscript>
<p class="web-small noscript-hint">Como o JavaScript está desligado, selecione o texto e copie manualmente.</p>
<textarea class="copy-fallback" readonly rows="10" aria-label="Texto da receita">${escapeHtml(
    copyText,
  )}</textarea>
</noscript>
<p class="status" id="copy-status" role="status" aria-live="polite"></p>
<footer class="page-footer">
<p>${footerLine}</p>
<p>${SITE} — um caderno de receitas para duas pessoas.</p>
</footer>
</div>
${actionBar}
</main>
</div>
<script src="/assets/page.js" defer></script>`;

  return shell({
    title: recipe.title,
    description,
    canonical,
    body,
    // TODO: add og:image once a static branded card asset exists. Deliberately
    // omitted for now so previews do not point at something that is not there.
    head: `<!-- TODO: og:image when a static branded card asset exists. -->
<meta name="robots" content="noindex,nofollow">
<meta property="og:title" content="${escapeAttr(recipe.title)}">
<meta property="og:description" content="${escapeAttr(description)}">
<meta property="og:site_name" content="${SITE}">
<meta property="og:type" content="article">
<meta property="og:url" content="${escapeAttr(canonical)}">
<meta name="twitter:card" content="summary">`,
  });
}

export interface InstallPageOptions {
  siteName: string;
  apkAvailable: boolean;
}

export function renderInstallPage(options: InstallPageOptions): string {
  const site = options.siteName || SITE;
  const apkNote = options.apkAvailable
    ? ""
    : `<div class="unpublished-note">O APK ainda não foi publicado. Tente novamente mais tarde.</div>`;

  const actionBar = options.apkAvailable
    ? `<div class="action-bar single">
<a class="btn btn-primary" href="/app/latest.apk" role="button">Baixar o app (APK)</a>
</div>`
    : "";

  const body = `<div class="page-panel">
${ivyCorner("tl")}
${ivyCorner("br")}
<main class="page-content">
<div class="page-scroll">
${sectionHeader(site, true)}
<div class="install-hero">
<img class="install-icon" src="${escapeAttr(APP_ICON)}" alt="" aria-hidden="true">
<p>Um caderno de receitas para duas pessoas na cozinha. Cole, organize e compartilhe receitas como cartas seladas.</p>
</div>
${apkNote}
<hr class="rule-dotted">
<div class="web-caption install-caption">Como instalar</div>
<ol class="install-steps">
<li class="install-step"><span class="install-step-text">Toque em <em>Baixar o app</em> no botão abaixo e aguarde o download.</span></li>
<li class="install-step"><span class="install-step-text">Abra o arquivo baixado e toque em <em>Instalar</em>.</span></li>
<li class="install-step"><span class="install-step-text">Se o Android pedir, permita instalação de <em>fontes desconhecidas</em> para este navegador.</span></li>
<li class="install-step"><span class="install-step-text">Se o Play Protect mostrar um aviso, toque em <em>Mais detalhes</em> e depois em <em>Instalar mesmo assim</em>.</span></li>
</ol>
<footer class="page-footer">
<p>Android 8 ou superior.</p>
</footer>
</div>
${actionBar}
</main>
</div>`;

  return shell({
    title: `Instalar o ${site}`,
    description: "Baixe o APK do My Recipes e instale no Android.",
    canonical: "/",
    body,
    head: `<meta name="robots" content="noindex,nofollow">`,
  });
}

export function renderErrorPage(status: number, origin: string): string {
  let heading: string;
  let message: string;

  if (status === 410) {
    heading = "Esta receita não está mais disponível.";
    message = "O remetente desativou este link.";
  } else if (status === 404) {
    heading = "Esta receita não está mais disponível.";
    message = "O link pode estar errado ou a receita foi removida.";
  } else {
    heading = "Algo deu errado";
    message = "Não foi possível abrir esta página agora. Tente novamente em instantes.";
  }

  const body = `<div class="page-panel">
${ivyCorner("tl")}
${ivyCorner("br")}
<main class="page-content">
<div class="page-scroll centered">
<div class="error-content">
${ERROR_ORNAMENT}
<h1 class="error-title">${escapeHtml(heading)}</h1>
<p class="error-body">${escapeHtml(message)}</p>
</div>
</div>
<div class="action-bar single">
<a class="btn btn-secondary" href="/" role="button">Voltar para o início</a>
</div>
</main>
</div>`;

  return shell({
    title: heading,
    description: message,
    canonical: `${origin}/`,
    body,
    head: `<meta name="robots" content="noindex,nofollow">`,
  });
}

export function renderNotFoundPage(origin: string): string {
  return renderErrorPage(404, origin);
}
