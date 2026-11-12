---
name: OrderMori Legal & Support
description: Premium Minimal reading surfaces for bilingual support and privacy information.
colors:
  bg: "#F7F6F2"
  ink: "#20201F"
  muted: "#686762"
  line: "#E8E6E1"
  surface: "#fff"
  accent: "#895B05"
  ink-hover: "#3A3935"
  selection: "#EAE0C8"
  code-bg: "#EFEEE9"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang HK", "Noto Sans CJK TC", sans-serif'
    fontSize: "clamp(2rem, 4.7vw, 3.5rem)"
    fontWeight: 600
    lineHeight: 1.22
    letterSpacing: "-0.035em"
  title:
    fontSize: "1.22rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.015em"
  body:
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.9
  label:
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.75
  action:
    fontSize: "0.95rem"
    fontWeight: 500
    lineHeight: 1.75
rounded:
  compact: "10px"
  panel: "14px"
spacing:
  step-16: "16px"
  step-20: "20px"
  step-24: "24px"
  step-28: "28px"
  step-32: "32px"
components:
  action-link:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.compact}"
    padding: "10px 20px"
  action-link-hover:
    backgroundColor: "{colors.ink-hover}"
  contact-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "24px 28px"
  resource-row:
    textColor: "{colors.ink}"
    padding: "28px 30px 28px 0"
  navigation-link:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  topic-link:
    textColor: "{colors.muted}"
    padding: "7px 0"
---

# Design System: OrderMori Legal & Support

## Overview

**Creative North Star: "Premium Minimal"**

A quiet Read surface: compact editorial introductions lead into practical support and long-form privacy text. Warm paper, dark type, white contact panels and fine rules carry the hierarchy. The official App icon provides the established identity.

This contract describes the built `public/` site only: six Traditional Chinese and English routes, plus a shared bilingual 404. It does not define the App interface. Product facts and policy wording remain in `AUDIT.md` and the page sources.

**Key Characteristics:**
- System typography with generous paragraph leading.
- Flat surfaces, light dividers and restrained link accents.
- Paired language routes with the same component structure.
- Plain HTML, CSS and a local icon; ordinary links support reading and contact.

## Colors

The palette is almost entirely neutral; the warm accent appears on ordinary link hover.

### Primary

- **Warm ochre** (`accent`): hover feedback for links other than the filled action and skip link.

### Neutral

- **Warm paper** (`bg`): the page canvas.
- **Soft charcoal** (`ink`): headings, body text, filled actions and focus outlines.
- **Quiet gray** (`muted`): introductions, dates, secondary text and topic navigation.
- **Pale rule** (`line`): header, footer, article and resource separators; contact-panel borders.
- **White surface** (`surface`): contact panels and reversed action text.
- **Hover charcoal** (`ink-hover`): filled action hover.
- **Warm selection** (`selection`): selected text background.
- **Code paper** (`code-bg`): inline filename backgrounds.

## Typography

The headline's frontmatter font stack is inherited throughout the site; there are no remote fonts. The system stack covers Latin and Traditional Chinese. Inline filenames use `ui-monospace, SFMono-Regular, Consolas, monospace`.

Headlines use the fluid `headline` role; section headings use `title`; article paragraphs use `body`; navigation uses `label`. The normal page line height is (1.75), while article paragraphs use the more open body leading. Introductory copy is muted, with a wider scale on larger screens (1.1rem, line height 1.8). Home resource headings are slightly larger than section headings (1.35rem).

At the narrow breakpoint, section headings become (1.1rem), lead copy becomes (1rem), and the home headline uses (2.25rem). The same hierarchy serves both languages; long text can wrap without truncation.

## Layout

The shared outer container caps at (1120px), including side padding (32px desktop; 20px at the narrow breakpoint). Header and footer align with the main content. The desktop home is a compact two-column editorial layout (1.1fr / 1fr, gap 88px), with an introduction beside two ruled resource rows.

Document pages place a topic index (200px) beside the article, with a gap (64px) and article width capped at (700px). The topic index is sticky below the viewport top (28px). Sections are separated by fine rules and vertical padding (28px); anchor scrolling leaves room above the heading (24px).

At widths up to (860px), documents become a single column and topics form a static two-column grid; the home gap tightens (40px). At widths up to (620px), the header navigation wraps to its own row, home columns stack, contact panels stack, and the footer becomes a vertical layout. Article sections tighten to (24px) vertical padding. Navigation and contact targets have a minimum height (44px); filled actions use (48px).

Print removes the header, footer and topic index, uses a white canvas, and retains the article with underlined links. There is no animated transition; the reduced-motion rule keeps scrolling automatic.

## Elevation & Depth

There are no shadows, gradients or raised surfaces. White contact panels and pale borders create the only surface distinction. Resource rows and article sections sit directly on the warm canvas.

## Shapes

Filled actions have compact rounded corners; contact panels use the softer panel radius. Most reading content stays open and rectangular, divided by single-pixel rules. The official icon is the byte-identical copy at `public/assets/app-icon.png`; its displayed corner treatment follows the existing image CSS. Do not redraw, crop or re-encode the source asset.

## Components

- **Header and language navigation:** plain links, with the current destination underlined and semibold. Language switching points to the equivalent route. The header itself is not sticky.
- **Resource rows:** full-row links with a title, muted summary, underlined reading cue and a small upper-right arrow. Fine rules separate the rows; no card background is used.
- **Topic navigation:** ordinary anchor links, sticky on desktop and a two-column topic grid on smaller screens. Hover adds an underline and the accent color.
- **Article sections:** an explicit heading followed by open paragraphs and inline links. Inline filenames use small, softly rounded code backgrounds. Content is visible without accordions.
- **Contact panels:** white, bordered containers with muted explanatory text. The support panel places an email action beside the text on desktop and stacks on mobile; the closing article panel uses an ordinary email link.
- **Filled actions:** dark anchor links with white text and a darker-neutral hover variant. These are mail or home links, not form controls.
- **Keyboard states:** links and summary elements receive a charcoal outline (2px, offset 5px). The skip link appears at the top-left when focused. Current-route styling remains distinct from hover.
- **404:** the shared header and footer frame a short bilingual message and a single filled home link.

## Do's and Don'ts

### Do:

- Do preserve the warm canvas, charcoal text, white panels and light borders.
- Do retain the inherited system font stack and the official App icon unchanged.
- Do maintain equivalent bilingual navigation and readable, wrapping text.
- Do preserve visible keyboard focus, generous link targets and the mobile topic grid.

### Don't:

- Don't turn the ruled reading layout into a collection of elevated cards.
- Don't introduce remote fonts, scripts, forms or analytics into this static site.
- Don't hide policy or support sections behind interactive disclosure controls.
- Don't extend this site-specific contract to the App or replace product facts with design guidance.
