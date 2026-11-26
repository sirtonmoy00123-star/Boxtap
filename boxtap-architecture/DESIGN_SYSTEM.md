# BoxTap — Design System

Version 1.0 · 2026-11-26 · Status: Approved by the owner (ADR-023). Source: BoxTap UI Design Guide (https://claude.ai/artifact/UtDaqLQY5WG43r1UtoSwUP), reviewed against Apple's Human Interface Guidelines.

Components use only the tokens below. Never hard-code a colour, size or font in a component.

## 1. Principles
1. Find it in 3 seconds: the answer is the biggest thing on screen; Search and Scan one tap away.
2. Content first: plain surfaces, hairline dividers, no decorative gradients.
3. One thumb: main actions in the bottom half; destructive actions away from the main button.
4. Familiar patterns: list rows, bottom sheets, swipe with Undo.
5. Honest about data: backup, offline and free-limit state always visible in plain words.
Borrow Apple's principles, not its brand: no Apple logos, no SF Symbols files, no shipped SF Pro font files, no fake iOS dialogs.

## 2. Colour tokens
```css
:root {
  color-scheme: light dark;
  --bg: #F2F2F7; --surface: #FFFFFF; --surface-2: #E5E5EA;
  --text: #000000; --text-2: #6C6C70;
  --separator: rgba(60,60,67,0.29);
  --accent: #0066D6; --accent-fill: #0066D6;
  --danger: #D70015; --success: #1E7B34; --warning: #C93400;
  --on-accent: #FFFFFF;
}
:root[data-mode="seller"] { --accent: #5856D6; --accent-fill: #5856D6; }
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000; --surface: #1C1C1E; --surface-2: #2C2C2E;
    --text: #FFFFFF; --text-2: #AEAEB2;
    --separator: rgba(84,84,88,0.6);
    --accent: #0A84FF; --accent-fill: #0066D6;
    --danger: #FF453A; --success: #30D158; --warning: #FF9F0A;
  }
  :root[data-mode="seller"] { --accent: #7D7AFF; --accent-fill: #5856D6; }
}
@media (prefers-contrast: more) {
  :root {
    --text-2: #3A3A3C; --separator: rgba(60,60,67,0.6);
    --accent: #004FA8; --accent-fill: #004FA8;
    --danger: #A0000F; --success: #145C26; --warning: #8F2500;
  }
  :root[data-mode="seller"] { --accent: #3634A3; --accent-fill: #3634A3; }
}
@media (prefers-contrast: more) and (prefers-color-scheme: dark) {
  :root {
    --text-2: #D1D1D6; --separator: rgba(120,120,128,0.8);
    --accent: #409CFF; --accent-fill: #004FA8;
    --danger: #FF6961; --success: #4CE077; --warning: #FFB340;
  }
  :root[data-mode="seller"] { --accent: #A5A3FF; --accent-fill: #3634A3; }
}
```
`--accent-on-grey` (owner decision 2026-11-26): accent-coloured text on a `--surface-2` grey fill, such as the secondary button label. Plain accent on grey is only 4.4:1, below WCAG AA.

| Token set | Home | Seller |
| --- | --- | --- |
| Light | #004FA8 | #4644B8 |
| Dark | #409CFF | #9593FF |
| prefers-contrast: more (light) | #003A80 | #2B2980 |
| prefers-contrast: more with dark | #80BFFF | #C0BFFF |

Rules: theme follows the device only (no in-app light/dark switch). Accent only for label tag border, primary button, links, selected tab. Never colour alone: Fragile, Open first, Low stock, Not backed up always have icon + word. Printed labels black on white.

## 3. Typography
```css
html { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Bengali", "Hind Siliguri", sans-serif; font-size: 100%; }
@supports (font: -apple-system-body) { html { font: -apple-system-body; } }
:lang(bn) { line-height: 1.6; }
.num { font-variant-numeric: tabular-nums; }
```
Noto Sans Bengali self-hosted, Bangla subset, 400 and 600, font-display swap. Sizes in rem; inputs at least 17 px.
Text styles (px size/line, weight): large-title 34/41 700; title2 22/28 700; headline 17/22 600; body 17/22 400; callout 16/21; subhead 15/20; footnote 13/18; caption 12/16 500; stock 28/34 700 tabular.
Bangla language shows Bangla digits via Intl.NumberFormat('bn-BD'); stored data uses Western digits.

## 4. Layout
Spacing 4, 8, 12, 16, 20, 24, 32, 48 px. Side margin 16 (20 at ≥430 px). Desktop content max 680 px; sidebar replaces tab bar at ≥1024 px. Touch targets ≥44×44 px, 8 px apart. viewport-fit=cover and env(safe-area-inset-*) on top bar, tab bar, Scan. Radius 10 px groups/cards/label tag; 14 px sheets/buttons; full round badges and Scan. Lists inset grouped, rows ≥44 px, separators indented to text.
Navigation: Home tabs Boxes, Rooms, Settings (Bin, backup, labels inside). Seller tabs Stock, Booked, Settings. Plus floating Scan button 56 px round, bottom centre, above the tab bar (an action, not a tab). Detail screens push with a back button; quick tasks open in a bottom sheet.

## 5. Components
Primary button: full width, 50 px, accent-fill, white headline, max one per screen. Secondary: 50 px, --surface-2 grey fill, --accent-on-grey label (owner decision 2026-11-26). Destructive: danger text away from primary, then 5 s Undo toast, no confirm dialog. Search field: 36 px rounded, magnifier, under large title, filters while typing. List row: headline title, subhead detail in text-2, count or chevron; swipe to Bin with a button alternative. Box card: label tag, name, room · where, item count, badges. Stock row: name and box, stock-size count, 44 px −/+ steppers; Low stock icon + word in warning. Bottom sheet: opens at half height, grabber, swipe down or Cancel, asks before discarding typed text. Status banner: one at a time, icon + text + one action; action min-width 60 px with centred label (use min-width, not fixed width). Scan view: full-screen camera, rounded guide, torch, hint, close top left; success flashes success colour, vibrates on Android only.
Box screen autosaves (debounced 500 ms, "Saved" footnote); no Save button. Icons: Lucide, 24 px, 1.75 stroke; tab icons have word labels.

## 6. Signature: the label tag
Box number in a label-shaped chip matching the printed QR label: 10 px radius, 2 px accent border (black on paper), small QR corner mark, title2 tabular number. On box card, box screen title, Scan success.

## 7. Motion and feedback
200–300 ms ease-out, transform and opacity only. Reduced motion: slides become fades. Blur only on the iPhone tab bar; solid under prefers-reduced-transparency and on Android. Scan success: guide shrinks into the label tag, then the box opens. navigator.vibrate only as a bonus.
States: empty = one sentence + primary button; loading = skeleton after 300 ms; offline = no change, Drive shows "Waiting for internet"; error = what happened + what to do; free limit = calm sheet; undo = 5 s toast "Box 12 moved to Bin · Undo".

## 8. Accessibility and language
WCAG 2.2 AA; axe in tests. aria-label on every icon button in the current language. Text to 200% without truncation. :focus-visible ring 2 px accent, 2 px offset. Swipe/long-press have button alternatives. No fixed-width buttons. All text in translation files. Sentence case everywhere. Dates "26 Nov 2026" in English.

## 9. Tailwind mapping (Tailwind 3 syntax; adapt for 4)
colors: bg, surface, surface-2, text, text-2, separator, accent, accent-fill, accent-on-grey, on-accent, danger, success, warning → var(--token). spacing 1=4px 2=8px 3=12px 4=16px 5=20px 6=24px 8=32px 11=44px 12=48px 14=56px. borderRadius md=10px lg=14px full. fontSize large-title, title2, headline, body, callout, subhead, footnote, caption, stock per §3. Replace (not extend) the palette.

## 10. Phase 0 checks
iPhone -apple-system-body follows Larger Text; Noto Sans Bengali on 3 budget Android phones; automated contrast check in CI; tab-bar blur on budget Android.
