# LINEPOOL To C design system

## Direction

The interface applies the user-provided Kimi K3 qualities—minimal, content-first, highly readable and fluid—to a telecom project marketplace. It does not copy a chat product's information architecture.

## Visual principles

1. **Content owns the page.** Navigation and decoration stay quiet; the current task, price, stock and status are visually dominant.
2. **Whitespace creates structure.** Prefer spacing, alignment and typography before borders or shadows.
3. **One accent has meaning.** Brand blue is reserved for the primary action, current navigation and selected controls.
4. **Surfaces are restrained.** Use white and soft gray surfaces with thin neutral dividers. Avoid gradients, glassmorphism and heavy shadows.
5. **Motion confirms, never distracts.** Transitions are short and interruptible; functional content never depends on animation.

## Tokens

```css
:root {
  --lp-bg: #f7f7f5;
  --lp-surface: #ffffff;
  --lp-surface-muted: #f1f1ee;
  --lp-text: #171717;
  --lp-text-muted: #6b6b68;
  --lp-border: #deded9;
  --lp-brand: #246bfd;
  --lp-brand-hover: #1557d8;
  --lp-success: #18794e;
  --lp-warning: #946200;
  --lp-danger: #c22f2f;
  --lp-radius-sm: 6px;
  --lp-radius-md: 10px;
  --lp-space-1: 4px;
  --lp-space-2: 8px;
  --lp-space-3: 12px;
  --lp-space-4: 16px;
  --lp-space-6: 24px;
  --lp-space-8: 32px;
  --lp-space-12: 48px;
}
```

## Typography

- Use a system-first sans-serif stack for fast, predictable Chinese and Latin rendering.
- Page title: 28–36 px, 600 weight, one per page.
- Section title: 18–22 px, 600 weight.
- Body: 14–16 px, 400 weight, 1.6 line-height.
- Dense data: 13–14 px; keep labels muted and values high contrast.
- Numeric balances and point prices use tabular numerals.

## Layout

- Content max width: 1200 px; reading-heavy sections: 760–880 px.
- Desktop uses a quiet left rail or top navigation with a stable content column.
- Mobile uses a compact header and bottom/slide navigation; critical purchase actions remain reachable without horizontal scrolling.
- Use lists and tables when users compare repeated data. Use cards only for project discovery, summaries and bounded decisions.

## Components

- Buttons: one primary action per region; secondary actions use neutral borders or text treatment.
- Forms: persistent labels, useful helper text and inline validation; no placeholder-only labels.
- Status: text plus icon; never color alone.
- Loading: skeletons match final layout. Empty states explain the next useful action. Errors provide a retry where safe.
- Dialogs: only for focused confirmation such as the final purchase summary; avoid nesting.

## Motion and progressive enhancement

- Routine CSS feedback: 120–180 ms and interruptible.
- Honor `prefers-reduced-motion`; functional content never depends on animation.
- GSAP provides restrained desktop entrance and feedback motion under ADR-005. Three.js remains deferred by ADR-004.

## Performance rules

- Lazy-load routes and keep optional visual runtimes out of the current bundle.
- Keep Element Plus imports tree-shakeable; avoid importing the full component library globally.
- Paginate server lists. Add virtual scrolling only after a measured need; the current demo data does not justify it.
- Reserve dimensions for asynchronously loaded blocks to prevent layout shift.

## Responsive and accessibility checks

- Verify 320, 768, 1024 and 1440 px widths.
- Meet WCAG AA contrast; keep visible focus rings and logical heading order.
- All primary flows work with keyboard only.
- Announce request results with accessible status regions.
