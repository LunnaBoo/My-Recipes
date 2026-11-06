# My Recipes — Visual System

A cozy, quest-journal notebook for two people in a kitchen. The UI reads like an aged recipe page held against a dark leafy-green desk: warm parchment panels, dark-brown ink rules, hand-drawn ivy flourishes, and a quiet sense of occasion when you open a shared recipe.

## 1. Palette

| Role | Hex | Usage |
|------|-----|-------|
| Parchment | `#E8D9B8` | Main panel background, cards, list surface. |
| Cream | `#F0E6CF` | Highlights, input fields, tab faces, empty-state panel, legacy sigil art. |
| Ink | `#3A2A1A` | Body text, primary icons, rules. |
| Ink Light | `#6B5344` | Meta text, placeholders, disabled states. |
| Sage | `#8A9A5B` | Secondary accent, decorative flourishes (ivy leaves, star fill). |
| Sage Light | `#9CAB6E` | Selected/pressed row background (passes contrast). |
| Olive | `#6B7A3A` | Header ivy, decorative green accents. |
| Olive Tab | `#4A5A28` | Tab 1 (Receitas), primary buttons, FAB (Cream text). |
| Mauve | `#8B6F8F` | Decorative secondary accents. |
| Mauve Tab | `#5F435F` | Tab 2 (Lixeira) (Cream text). |
| Tan | `#C4A87A` | Borders, warm neutral accents. |
| Tan Tab | `#7A5F3A` | Tab 3 (Ajustes) (Cream text). |
| Gold | `#D4A94A` | Pinned sparkle, accent stars, primary CTA highlights, selected seal cell border. |
| Leafy Green | `#243320` | App background, behind parchment. |
| Leafy Deep | `#1A2616` | Background vignette, status bar area. |
| Navy | `#2F3B52` | Photo-seal disc, legacy sigil disc, deep item tiles. |
| Navy Dark | `#202B40` | Wax-seal rim overlay. |
| Maroon | `#6E2F3F` | Destructive actions, trash badge, discard button. |

### Contrast ratios (WCAG 2.1 AA target 4.5:1)

| Pair | Ratio | Pass? |
|------|-------|-------|
| Ink `#3A2A1A` on Parchment `#E8D9B8` | 9.9:1 | ✅ Body text |
| Ink Light `#6B5344` on Parchment `#E8D9B8` | 5.1:1 | ✅ Meta text |
| Ink `#3A2A1A` on Sage Light `#9CAB6E` | 5.5:1 | ✅ Pressed/selected row |
| Cream `#F0E6CF` on Olive Tab `#4A5A28` | 6.1:1 | ✅ Tab 1 label / primary button |
| Cream `#F0E6CF` on Mauve Tab `#5F435F` | 6.9:1 | ✅ Tab 2 label |
| Cream `#F0E6CF` on Tan Tab `#7A5F3A` | 4.8:1 | ✅ Tab 3 label |
| Cream `#F0E6CF` on Navy `#2F3B52` | 12.5:1 | ✅ Legacy sigil / photo-seal foreground |
| Maroon `#6E2F3F` on Parchment `#E8D9B8` | 7.0:1 | ✅ Destructive text button |
| Gold `#D4A94A` on Parchment `#E8D9B8` | 1.6:1 | Decorative only; sparkle has an Ink stroke. |

> **Why this parchment/ink pair works:** The warm paper tone reduces glare under kitchen lights, and the deep sepia ink gives us nearly AAA body contrast without the coldness of pure black.

## 2. Typography

Two families maximum:

1. **Display / headers:** `Cormorant Garamond` (Google Fonts, OFL). High-contrast transitional serif with an antique, storybook feel. Used for section titles, recipe titles, and tab labels.
2. **Body / reading:** `Source Serif 4` (Google Fonts, OFL). A sturdy, warm serif designed for long text at small sizes. Used for excerpts, recipe body, editor input, and meta labels.

Fallback stack: `Georgia, "Times New Roman", serif`.

### Type ramp

| Name | Family | Size | Line height | Weight | Letter-spacing | Usage |
|------|--------|------|-------------|--------|----------------|-------|
| Section Title | Cormorant Garamond | 22px | 28px | 700 | 0.18em uppercase | Screen headers, e.g. "RECEITAS". |
| Recipe Title | Cormorant Garamond | 20px | 26px | 700 | 0.02em | Recipe view title. Clamped to 2 lines; fits a 360dp screen at this size. |
| List Title | Source Serif 4 | 16px | 22px | 700 | 0 | Recipe list card title. |
| Body | Source Serif 4 | 17px | 26px | 400 | 0 | Rendered markdown, editor body. |
| Body Small | Source Serif 4 | 15px | 22px | 400 | 0 | Step text, excerpts. |
| Meta | Source Serif 4 | 13px | 18px | 600 | 0.04em | Step counts, dates. |
| Button | Source Serif 4 | 14px | 20px | 700 | 0.04em | Action buttons. |
| Tab Label | Cormorant Garamond | 13px | 18px | 700 | 0.1em uppercase | Folder tabs. |

> **Uppercase headers** use generous letter-spacing so the antique serif doesn't feel cramped.

## 3. Spacing, radii, and hand-drawn lines

### Spacing scale

| Token | Value | Usage |
|-------|-------|-------|
| `space-1` | 4px | Tight icon gaps, rule offsets. |
| `space-2` | 8px | Row internal padding, inline tool gaps. |
| `space-3` | 12px | Card padding, list row vertical padding. |
| `space-4` | 16px | Standard screen padding, section gaps. |
| `space-5` | 24px | Major section separators. |
| `space-6` | 32px | Header to content, empty-state vertical room. |

### Radii

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 4px | Small buttons, inline flourishes. |
| `radius-md` | 8px | Cards, input fields, action pills. |
| `radius-lg` | 16px | Main parchment panel, modals. |
| `radius-tab` | 12px 12px 0 0 | Folder tab top corners. |

### Hand-drawn line quality

- **Rules:** 1px solid `Ink Light` (`#6B5344` at 40% opacity). Subtle, never pure black.
- **Borders:** 1.5px with a slight organic wobble achieved by `border-radius` variation and a 0.5px pseudo-element offset (no blur filters).
- **Panel edge:** an SVG path with gentle curves on the top/bottom, not a straight rectangle. Implemented as a decorative SVG overlay, not a background image.
- **No drop shadows on text.** Elevation is created by layered parchment panels and a single soft shadow on the phone frame only.

## 4. Components

### Tab bar

- Folder-style tabs, each a muted but dark enough color for Cream text: Olive Tab (`Receitas`), Mauve Tab (`Cartas`), Tan Tab (`Ajustes`).
- **Active tab** is taller, fully opaque, and visually connected to the panel: its own background color continues down over the panel top edge via a small overlap, so there is no visible bottom edge where tab meets parchment.
- **Inactive tabs** sit lower, are slightly recessed (lower opacity + inset shadow), and appear to tuck behind the panel surface.
- The `Cartas` tab carries the unread-letter badge inside its face. The trash count moves to the Ajustes → Lixeira row.
- Tabs are compact and left-aligned; the remaining row space stays empty. Minimum tab hit target: 48px height, 80px width on a 360dp screen.

### List row

- Background: Parchment.
- Padding: 12px vertical, 16px horizontal.
- Layout: title top, excerpt middle (1–2 lines, truncated at 3 with ellipsis), meta bottom right.
- Hairline rule between rows, 1px `Ink Light` at 25% opacity.
- **Normal:** Parchment background, Ink text.
- **Pressed:** Sage Light (`#9CAB6E`) background with Ink text; appears during touch and fades to normal on release.
- **Pinned:** Gold four-point sparkle at the top-right of the row, replacing the reference's decorative star with meaningful state.
- **Long title:** wraps to 2 lines; line-height keeps rows scannable.
- **Truncated excerpt:** clamped to 3 lines via `-webkit-line-clamp` / `numberOfLines`; gradient fade is not used because it harms readability.
- **No per-recipe icons.** The reference's pictograms are intentionally removed to keep the list calm and text-first.

### Recipe header

- Centered uppercase serif title "RECEITA" flanked by inline SVG leaf/berry flourishes and a thin rule.
- Own recipes: see §5.2 — cream card, centred header, profile seal.
- Imported recipes: left-aligned title and step count, with a 28px source seal inline before `"Receita de <sender>"`.

### Seal

- A decorative wax identity for each sender. It is **never load-bearing for meaning**: the sender name is always shown as text, and the seal is an ornament that makes shared recipes feel personal.
- **Sizes:**
  - **Large (108px):** import-preview letter, centered above `"Receita de <sender>"`.
  - **Small (28px):** imported-recipe header, settings row, inline before `"Receita de <sender>"`.
  - **Grid (56px):** the six built-in stamps in the "Seu selo" picker.
  - **Preview (110px):** top-of-screen seal preview on "Seu selo".
- **Built-in stamps:** six photographs of real wax seals, cut out to alpha and bundled as WebP. They render at their photographed silhouette inside a transparent square (`contain`) — **no circular crop, no navy disc, no rim**. IDs, in picker order: `bee`, `cat`, `leaf`, `moon`, `mushroom`, `sea`.
- **Picker cell:** a square tile with `radii.lg` corners on Parchment; the selected tile switches to Cream with a Gold border. The cells stay uniform even though the silhouettes vary.
- **Custom-image seal:** unchanged. The user picks a photo; it is cropped to a circle and rendered *under* a Navy rim so it stays readable as a seal.
- **Legacy sigils:** `sun`, `star`, and `owl` keep the old Cream-on-Navy line-art rendering so recipes saved before the stamp art don't change. They are not offered in the picker.
- **Fallback:** when no seal is set, show the `cat` stamp. The sender name remains visible as text.
- **Web sizes:** 96px on mobile and 132px at `min-width:600px` on share pages; the install hero uses the app icon at `clamp(148px, 42vw, 188px)`.

### Step list

- Rendered Markdown numbered list.
- Step numbers use `Gold` at 17px, body uses Body 17px.
- Spacing between steps: 16px.
- No per-step icons; the numbers themselves are the markers.

### Action buttons

- Rounded capsule, small size, uppercase letter-spacing.
- **Primary:** Olive Tab background, Cream text (e.g. Salvar, FAB).
- **Secondary:** Parchment background, Ink border, Ink text (e.g. Copiar).
- **Danger / outline:** Parchment background, Maroon border, Maroon text (e.g. Descartar).
- **Tertiary / inline:** transparent with Ink underline (e.g. Copiar texto).
- **Disabled:** 40% opacity, no pointer events.
- Minimum size: 44px height, 80px width.
- Recipe-view bottom bar uses short labels that fit a 360dp screen: **Enviar · Copiar · Editar**.

### Section divider / flourish

- A horizontal rule with an SVG leaf-and-berry cluster centered over it.
- Used to separate title/meta from body, and before "Area Map"-style footer sections.

### Empty state

- Centered Cream panel with an Ink ivy wreath illustration.
- Title: "Nenhuma receita ainda" in Section Title style.
- Body: "Cole sua primeira receita ou toque em + para começar."
- Primary CTA: Olive Tab pill "Colar receita".

### Toast / snackbar

- A slim panel that slides up from the bottom safe area.
- Background: Leafy Green (`#243320`) with a 1px Parchment border.
- Text: Cream.
- Action text: Gold, underlined.
- Duration: 4 seconds; includes a "Desfazer" action for delete.

### Dialog

- Parchment panel with rough top/bottom SVG edges, centered on a translucent Leafy Deep scrim.
- Title: Section Title.
- Buttons stacked or side-by-side depending on label length.
- Destructive button uses Maroon background.

## 5. Screen-by-screen layout notes

### 5.1 Home — recipe list

- Background: Leafy Green full-bleed, with a subtle vignette and paper-grain texture overlay.
- Top: folder tabs (Receitas / Cartas / Ajustes).
- Panel: Parchment, full-width with 16px margins, rough top edge.
- Inside panel:
  - Search field (Cream, rounded, placeholder "Buscar receitas…").
  - Section header "RECEITAS" with flourish, flanked by two small `IvyCorner` branches in the band between the search field and the filter control.
  - `Todas | Fixadas` filter row.
  - Scrollable list of rows.
- FAB: circular Olive Tab button with a simple plus, anchored bottom-right above safe area.
- Long-press on a row opens a context menu: Fixar, Editar, Excluir.

### 5.2 Recipe view

- Same outer parchment panel; the content treatment differs by origin (below).
- Rendered Markdown body, generous vertical rhythm.
- Bottom action bar (sticky): **Enviar · Copiar · Editar**, styled as pill buttons.

**Own recipes**

- Cream/Tan card (`cream` background, `tan` 1.5dp border, `radii.lg` corners, `spacing.lg` padding and gap `xs`).
- Large centred profile seal (108dp) built from the user's chosen seal.
- Centred header line: `"Receita de <displayName>"` when a name is set, otherwise `"Sua receita"`.
- Title clamped to 2 lines, centred, long-press opens the options menu.
- Meta line centred: step count only.
- The `⋯` overflow menu sits as an absolute top-right control inside the card (44dp touch target).

**Imported recipes**

- Compact header row, left-aligned.
- Small source seal (28dp) inline before `"Receita de <sender>"`.
- Title and meta left-aligned; meta is the step count.
- The `⋯` overflow menu sits at the right end of the header row.

### 5.3 Editor

- Same outer frame, but the writing area is intentionally plain:
  - Title input: Cream field, 20px Cormorant Garamond.
  - Body input: Cream field, 17px Source Serif 4, generous line-height, no background texture under the caret.
  - Toolbar: horizontal strip with Markdown buttons (bold, italic, heading, list, checkbox, divider).
  - Toggle: Editar / Pré-visualizar as two pill segments; active segment uses Olive Tab background with Cream text.
- Cursor and selection use system defaults tinted toward Sage (`#8A9A5B`).
- No faux-handwriting font; the app is a journal, not a forgery.

### 5.4 Paste-import (Colar receita)

- Screen pushed modally or as a full-screen panel.
- Large Cream text area at top with placeholder "Cole aqui a receita do WhatsApp…".
- Live preview card below shows parsed title, step count, first lines.
- Bottom buttons: "Criar receita" (primary Olive Tab) / "Cancelar" (secondary).

### 5.5 Import preview (shared link)

- Designed to feel like receiving a letter.
- Background: Leafy Green with a faint parchment letter overlay.
- A sealed scroll/card at center:
  - Large Navy wax-seal (108px) above "Receita de <sender>". The mockup demonstrates a custom photo inside the seal rim.
  - Title (clamped to 2 lines), step count, rendered body.
- Bottom sticky bar: "Salvar" (primary) / "Descartar" (secondary, Maroon outline).
- Already-imported state shows a notice and "Ver receita" / "Atualizar cópia" actions.
- Offline: inline message with retry button, link retained.

### 5.6 Trash

- Pushed screen from Ajustes → Lixeira; back header "Lixeira", no folder tabs.
- List shows deleted recipes with "expira em N dias" in Meta style.
- Swipe actions (or long-press menu): Restaurar / Apagar para sempre.
- Empty trash: disabled state when empty.
- Destructive confirmations use the Dialog component.

### 5.7 Settings

- Tab "Ajustes" folder is Tan Tab.
- Grouped list on parchment, section headers in uppercase serif.
- Fields: Nome de exibição, Seu selo, Caixa de entrada, Lixeira (with count), Exportar backup, Importar backup, Verificar atualização.
- Version info at bottom in Meta style.

### 5.8 Seu selo

- Reached from Settings or during onboarding.
- Folder tabs remain visible; this screen lives under the "Ajustes" tab.
- Panel shows:
  - Large seal preview at top (reflects current choice).
  - "Nome de exibição" text field.
  - Selectable 3×2 grid of the six built-in stamps on square parchment cells; the selected cell uses Cream and a Gold border.
  - "Enviar imagem" option with a circular photo preview inside the wax rim.
  - Save / Cancel actions.

### 5.9 Cartas

- Tab "Cartas" folder is Mauve Tab, with an unread badge.
- Inbox rows: 44 dp sender seal, "Carta de <name>", title, steps/time, gold unread dot.
- Empty: "Nenhuma carta ainda."
- Tapping opens the shared-recipe page; long-press marks read/unread or removes.

## 6. React Native implementation notes

### Fonts

- Load via `expo-font` with `useFonts` hook.
- Include `CormorantGaramond-Bold.ttf` and `SourceSerif4-Regular.ttf` / `SourceSerif4-Bold.ttf`.
- Both are licensed under the SIL Open Font License, free to embed.

### Ornaments

- Use `react-native-svg` for all flourishes: ivy corners, tab shapes, torn panel edges, sparkle, and the legacy seal sigils. Stamps are bundled WebP images.
- Keep paths simple; prefer `<Path>` over complex filters.
- Tab shape: a single SVG path behind each tab label, colored per tab.
- Panel edge: one SVG overlay at the top and bottom of the main panel, not a full background image.

### Seal implementation constraints

- **Stamps:** bundle the six stamp WebP files as local assets (`bee`, `cat`, `leaf`, `moon`, `mushroom`, `sea`). Render them with `resizeMode="contain"` in a transparent square; never clip or fetch them from the network.
- **Legacy sigils:** keep the old SVG line-art components for `sun`, `star`, `owl` so recipes saved before the stamps don't change. They are not selectable.
- **Picker cells:** square tiles with `radii.lg` corners; Parchment by default, Cream with a Gold border when selected.
- **Custom image:** accept a square image from the photo picker, downscale and compress it to a 256×256 JPEG under 32 KB, and store it locally.
- **Circular crop:** applies only to custom images. Clip with a rounded `<View>` + `overflow: 'hidden'` or an SVG `<ClipPath>`; stamps are never clipped.
- **Wax-rim overlay:** custom images only. Draw the wavy rim SVG **on top of** the photo, never behind it, so it stays visible even on a light or busy image.
- **Fallback:** if the user has not set a seal, render the `cat` stamp; do not leave an empty slot.
- **Accessibility:** the seal is decorative; screen readers should ignore it and read the sender name as text.

### Texture

- **Strategy:** a single tiled paper-grain PNG under 60 KB, applied as a low-opacity overlay (`opacity: 0.06`) on top of colored backgrounds, multiplied or normal blend.
- Avoid CSS-equivalent gradients in RN; a small tile is more performant and looks better when zoomed.
- Vignette: a radial-gradient view behind everything, no texture on top of text panels.

### Shadow / elevation

- Parchment panel: Android elevation 4 + a subtle offset shadow in `rgba(26, 38, 22, 0.25)`.
- Phone-safe area handled with `react-native-safe-area-context`.
- No text shadows.

### Scroll performance

- The grain overlay is a single full-screen `Image` with `pointerEvents="none"`, not per-row.
- SVG ornaments are static; do not re-render on scroll.
- List rows use `React.memo` and fixed heights where possible.
- Avoid blur/backdrop-filter; use translucent solid colors instead.

## 7. Accessibility

- **Contrast:** All body and meta text pairs pass WCAG 2.1 AA (see §1).
- **Touch targets:** Minimum 44px for buttons, 48px for tabs and FAB.
- **Dynamic type:**
  - `allowFontScaling={true}` on text.
  - Body text and recipe steps reflow; list excerpts truncate at 3 lines regardless of scale.
  - Tab labels use `adjustsFontSizeToFit` or scale down to 11px before truncating.
  - At 200% font scale, the editor body remains fully scrollable; toolbar wraps to two rows if needed.
- **Screen reader:**
  - List rows: `"Feijão carioca perfeito, 12 passos, fixada"`.
  - Sparkle image and sender seal have an empty alt / decorative role.
  - Buttons labeled explicitly ("Enviar receita").
- **Focus:** visible focus ring (2px Gold outline) on editor inputs and buttons when navigated by keyboard/D-Pad.

## 8. Dark mode

**Recommendation: light-only for v1.**

The parchment aesthetic is the product identity. A forced dark mode would either invert the concept (grey "paper" on black) or require a completely second visual system. Instead, the app stays warm and readable under kitchen lighting.

Future "candlelit" variant (post-v1):
- Parchment becomes `#C9B896` (dimmed candlelight).
- Ink becomes `#2A1E12` (still high contrast).
- Background becomes `#1A120E` (very dark brown, not pure black).
- Sage becomes `#A8B97A` (slightly brighter for the darker paper).
- Gold becomes `#E8C46B` (more luminous).

## 9. Anti-patterns for this style

- **No more than one texture layer behind text.** The grain is a single overlay; never stack multiple filters behind body copy.
- **No per-row icons.** The reference's pictograms are intentionally omitted to keep the list calm and text-first.
- **No drop shadows on text.** Elevation comes from panels and buttons only.
- **Nothing that makes a 12-step recipe harder to scan.** No animated flourishes inside the scroll area; no faux-handwriting fonts in the editor; no texture under the caret.
- **No pure black or pure white.** Everything is warmed: ink is sepia, backgrounds are green/brown, highlights are cream.
- **No blurred glass effects.** Use solid translucent overlays instead.

## 10. Web pages

The share, install, and error pages are rendered by a Cloudflare Worker and are often the first impression for people who do not have the app installed. They must carry the same parchment identity while obeying the Worker's strict Content-Security-Policy.

### Type stack

The CSP blocks external fonts, so Cormorant Garamond and Source Serif 4 cannot be loaded on the web. Use a single antique-feeling system serif stack for both display and body:

```css
font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
```

`ui-serif` may be added where the platform offers a nicer bundled serif, but Georgia is the reliable baseline. Georgia can read like a Word document if left alone, so tune it like this:

- **Display sizes slightly larger** than the app (recipe title 22–24 px) so the serifs have room to breathe.
- **Generous letter-spacing on uppercase headers** (0.18–0.22 em) to avoid cramped blocks.
- **Body at 17 px / 28–30 px line-height** with weight 400, so paragraphs feel like a letter rather than a spreadsheet.
- **No faux small-caps, no synthetic obliques, no font-weight lighter than 400.**

### Seal treatment on the web

- Built-in stamps are inlined WebP data URIs rendered with `object-fit: contain`; legacy sigils stay inline SVG `<symbol>`s.
- Custom sender photos are rendered as `<img src="data:image/...">` and clipped to a circle; the wavy wax-rim overlay is an inline SVG drawn on top so the rim never disappears into a light photo.
- The seal is always decorative; the sender name appears as text beside or below it.
- Fallback seal: the `cat` stamp, identical rule to the app.

### Button hierarchy for the two Android states

- **No app / desktop browser:** the primary action is **"Copiar receita"** (Olive Tab). **"Baixar o app (APK)"** is secondary and only rendered when an APK asset is actually published.
- **Android with app installed:** the primary action becomes **"Abrir no app"** (Olive Tab, using an `intent://` link). **"Copiar receita"** moves to secondary. This makes the native path the obvious main action without looking like an ad banner.

In both states buttons are capsule-shaped, uppercase, minimum 48 px height, and never rely on hover.

### Action bar

The primary action must be visible without scrolling on a 390 × 844 viewport, so the action bar is pinned to the bottom of the page panel:

- Use `position: sticky; bottom: 0` inside the scrollable content area, or place the bar as a fixed sibling at the bottom of the panel.
- Background matches the parchment panel, with a 1 px hairline top rule and a very soft upward shadow so it reads as a bar, not floating text.
- Padding bottom includes `env(safe-area-inset-bottom)` to account for WhatsApp's in-app browser and gesture areas.
- Buttons are minimum 48 px tall; the bar itself is roughly 72 px high including padding.
- The scrollable content area has bottom padding equal to the bar's height so the last line of text or footer is never permanently hidden behind the bar.
- On desktop widths the same bar remains visible and the buttons stay side-by-side.

### Install steps list

The install page uses a plain numbered list with no absolute positioning or floats:

- Each step is a flex/grid row: a gold step number on the left, then a text block on the right.
- The text block wraps freely; emphasized labels like *Baixar o app* or *Instalar mesmo assim* are inline and do not break the layout.
- Gap between number and text is 10 px; gap between steps is 12 px.
- The list must remain readable at 360 px as well as 390 px content widths, so the text block uses `flex: 1` with `min-width: 0` to allow wrapping.

### CSP constraints as design rules

The Worker serves this policy:

```
default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'self'; base-uri 'none'; form-action 'none'
```

These become non-negotiable design rules:

- **No external fonts.** Google Fonts and any other hosted typeface are blocked.
- **No external images.** All ornaments, icons, seals, and textures must be inline SVG or data URIs (`img-src data:`).
- **No inline scripts.** The only JavaScript is `/assets/page.js`. The copy button is wired by that script after load. A `<noscript>` fallback explains how to copy the recipe text manually.
- **Server-side rendering.** The page must be fully useful with zero JS: recipe text, install steps, and error messages are plain HTML.
- **No icon fonts, no web fonts, no scroll-driven animations, no hover-only affordances.** The page is meant to be fast and readable inside WhatsApp's in-app browser.

### Mobile-first constraints

- Design at 390 px width first; test one-handed use and 44 px tap targets.
- Body text minimum 17 px; buttons minimum 48 px height.
- Long titles clamp to 3 lines so they never push the action buttons below the fold.
- One subtle grain texture at panel level only; no texture under body copy.
- Dark leafy-green background around the parchment panel, matching the app.

### Compromises versus the app

- **Typography:** we lose Cormorant Garamond's high-contrast display character and Source Serif 4's crisp body at small sizes. Georgia is warmer than a default sans-serif but less refined; we compensate with size, line-height, and letter-spacing.
- **Texture:** the paper grain must be an inline SVG noise data URI instead of a small tiled PNG, because external images are blocked.
- **Seals:** custom photo seals must be embedded as data URIs rather than local files, which keeps the page self-contained but adds bytes to the HTML.
