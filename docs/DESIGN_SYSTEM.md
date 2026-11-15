# GFV design system

This page explains how I built the macOS-style look and the rules that keep it consistent. Please read it before you
add or restyle anything in `web/`. The short version: **colours, shadows and motion live in one file, components use them by
name, and tests fail when contrast breaks.**

To see every screen in both themes, run `CAPTURE_UI=mine pnpm exec playwright test --config e2e/playwright.config.ts 01-onboarding capture-ui`.
It writes the screenshots to `docs/redesign/mine/`, which is ignored by git.

## 1. Tokens (`web/src/styles/tokens.css`)

The **only** place a colour, shadow or duration is defined. Light is `:root`, dark is `.dark` (a class on
`<html>`, set by `App.tsx` in a layout effect). `index.css` maps tokens to Tailwind utilities with `@theme inline`.

| Group           | Tokens                                                                                    | Use                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Surfaces        | `background`, `sunken`, `chrome`, `glass`, `popover`, `secondary`, `muted`, `accent`      | window content, wells, menu bar/Dock/title bars, menus               |
| Text            | `foreground`, `muted-foreground` (secondary), `faint-foreground` (tertiary)               | `text-foreground` ... ; hints and timestamps use `faint`             |
| Accent / status | `primary` (+`-foreground`), `link`, `ring`, `destructive`, `danger`, `success`, `warning` | buttons; **`link`/`danger` are the TEXT versions** (see below)       |
| Code surfaces   | `code`, `code-foreground`, `code-muted`, `code-accent`, `code-danger`, `code-border`      | terminals, command lines and logs: dark in **both** themes           |
| Charts          | `chart-1..3`                                                                              | uPlot series (read through `tokenColor()` because canvas has no CSS) |
| Window controls | `tl-close`, `tl-minimize`, `tl-zoom`, `tl-inactive`                                       | traffic lights                                                       |
| Elevation       | `shadow-elev-1..3`, `shadow-window`, `shadow-window-inactive`                             | layered shadows (a contact shadow plus an ambient one)               |
| Shape           | `rounded-window` (12px), `rounded-control` (8px)                                          |                                                                      |
| Type scale      | `text-caption` 11, `footnote` 12, `body` 13, `callout` 15, `title` 17, `large` 22         | Inter variable first, then the system stack (SF on Apple devices)    |
| Motion          | `--dur-fast/--dur/--dur-slow`, `ease-out`, `ease-spring` (a sampled spring, `linear()`)   | durations collapse to 1 ms under `prefers-reduced-motion`            |

**Why `danger` and `destructive` are two tokens.** A red fill with white text and red text on a window need
different reds, and in dark mode no single red passes AA for both. `destructive` is the fill; `danger` (and
`link`, `success`, `warning`) are for text. Likewise `primary` is a button fill, `link` is blue text.

**Glass.** `glass-chrome` (bars, title bars, Dock) and `glass-popover` (menus, dialogs, palette) are translucent
with a blur. They fall back to solid colours under `.reduce-transparency` (a user setting) and
`prefers-reduced-transparency`. Text on glass is only ever placed over a colour that was checked in its solid form.

## 2. Rules that tests enforce

- `web/src/styles/tokens.test.ts`: every text/background token pair is **WCAG AA (4.5:1)** in light and dark, chart
  colours and the focus ring are 3:1. Break a colour and this fails.
- `e2e/10-accessibility.spec.ts`: measures the **rendered** UI (it composites each element's real background):
  contrast on every app plus Spotlight, the Run dialog, Control Center and a menu, in both themes; every control
  has an accessible name; keyboard focus is visible; reduced motion stops animations and Dock magnification;
  Reduce Transparency makes glass solid. The audit switches Reduce Transparency on so backgrounds are solid and
  the numbers are exact. It skips: canvases (xterm, Monaco, charts), disabled controls, elements fading on
  purpose (opacity below 1), and gradient backgrounds.
  Tokens passing is **not** enough: this audit found text on tinted fills that was under 4.5 even though both
  colours were individually fine. Use a solid `bg-background` under small text, and prefer 10% tints.
- Never put a literal palette class (`text-red-500`, `bg-slate-900`, `#0b1020`) in a component. Use a token.
  The exceptions are the app icon tints in `registry.tsx` and the user-chosen server colours.
- **Text on a user-chosen colour** (the server pill) goes through `readableOn(colour)` (`lib/color.ts`), which picks
  black or white by contrast.

## 3. Components

| Component                                         | Where               | Notes                                                                                       |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `Button`, `Input`, `Textarea`, `Label`, `Dialog*` | `components/ui/`    | shadcn-style, restyled. `cn()` (`lib/utils.ts`) knows our type scale, see below             |
| `AppIcon`                                         | `components/icons/` | gradient squircle + white lucide glyph; apps declare `{ icon, tint }` in the registry       |
| `GfvMark`                                         | `components/icons/` | the neutral logo (a prompt in a rounded square)                                             |
| `Menu`                                            | `components/menu/`  | the one floating menu: menu bar, Dock, right-click menus. Keyboard, outside-click, clamping |
| `ConfirmHost` / `confirmDialog()`                 | `components/`       | styled yes/no (Cancel focused). **Never use `window.confirm`.**                             |
| `ToastHost` / `toast()`                           | `components/toast/` | notifications from anywhere, including stores                                               |
| `RiskBadge`, `CommandLine`, `LogPanel`            | `components/`       | status pill, "$ command + Try it yourself", log viewer                                      |

**`cn()` and custom font sizes.** `tailwind-merge` must be told about `text-body` etc., otherwise it treats them
as text colours and silently deletes a real colour class next to them (this made every small primary button's text
dark). `lib/utils.ts` registers them; `utils.test.ts` guards it. If you add a type-scale step, add it there too.

## 4. The shell (`web/src/desktop/`)

- **Menu bar** (`MenuBar.tsx`): GFV mark menu, the focused app's name, File / Edit / View / Window / Help, then
  search, server picker, Record, Learn, Control Center, clock. Menus are built **when opened** (`BarMenu` takes
  `items` as a function), so enabled/disabled states are never stale. The pure builder is `menuModel.ts`.
- **App menus** (`appMenus.ts`): an app contributes items to File/Edit/View while its window is focused:

  ```ts
  const provide = useAppMenus(windowId); // a hook: call it before any early return
  provide(() => ({ file: [{ label: 'Save', onSelect: save }], edit: [...] })); // every render, after handlers exist
  ```

  Terminal, Editor and Files do this. Right-click menus reuse the same item builders, so they never disagree.

- **Dock** (`Dock.tsx`, `dockMath.ts`): magnification is **transform-only** (never layout) and anchored so the
  point under the pointer stays under the pointer. The glass bar is a separate layer that grows with the icons.
  Minimized windows sit after a separator. Because icons move as you approach, a test that teleports the pointer
  must first park it off the Dock (`openApp` in `e2e/helpers.ts` does).
- **Windows** (`Window.tsx`, `windowAnim.ts`): traffic lights, glass title bar, server ring + pill. Open, close,
  minimize and restore use the Web Animations API on the inner frame; maximize transitions the rectangle. Durations
  are read from the tokens by `parseDuration` (the production CSS minifier rewrites `420ms` as `.42s`).
  Minimize flies to the window's Dock item (`data-win-anchor`).
- **Spotlight** (`Spotlight.tsx`, `spotlightModel.ts`): Ctrl/Cmd+K. **Ctrl+K is left alone in the Terminal and the
  Editor** (bash and Monaco use it); Cmd+K and the menu-bar button always work. Shortcut rules are pure functions in
  `hotkeys.ts`.
- **Mission Control** (`overviewLayout.ts`, Window `slot`): the real windows are shrunk with a transform into a grid.
  Window wrappers get `pointer-events: none` while it is open (they still cover their unscaled area).
- **Control Center** (`ControlCenter.tsx`), **commands** (`commands.ts`: things reachable from several places live
  once), **overlay state** (`overlayStore.ts`).
- **Wallpapers** (`wallpapers.ts`, `Wallpaper.tsx`): generated CSS gradients (no image files), light and dark
  variants that crossfade, a slow drift. Preferences: `stores/appearanceStore.ts`.

## 5. Keep these hooks (the specs and the tour use them)

`data-tour="app-<id>"` (Dock icons), `server-switcher`, `record`, `learn` (menu bar); `data-testid="window"` with
`data-app` and `data-focused`; `data-win-anchor` (minimize target); `data-path` (Files); `aria-label`s on the menu
bar buttons ("Start recording", "Toggle Learn Mode", "Control Center", ...).

## 6. Checklist for a new screen

1. Tokens only (no palette classes, no hex). Text sizes from the scale.
2. Icons from `lucide-react`, never emoji. Icon-only buttons need `aria-label`.
3. Small text sits on `bg-background` (or a 10% tint), not on a translucent surface.
4. Confirmations through `confirmDialog()`, feedback through `toast()`.
5. If the app has actions a user would look for in a menu, `useAppMenus`.
6. Run `pnpm e2e`: the accessibility spec will tell you if you broke contrast or focus.
