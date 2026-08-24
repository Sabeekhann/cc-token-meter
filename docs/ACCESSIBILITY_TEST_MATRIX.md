# Dashboard accessibility and responsive test matrix

Use only the synthetic dashboard fixture when running this checklist:

```bash
npm run preview:dashboard
```

Do not use contributor transcripts or production usage data for screenshots or test evidence.

## Automated contract

`test/accessibility.test.js` verifies the dependency-free source contract for semantic landmarks, labeled controls, keyboard handlers, 44×44 CSS targets, text chart summaries, responsive breakpoints, disconnected-state messaging, fallback-pricing messaging, bounded histories, and local-only assets.

## Viewport matrix

Test every dashboard view at each width. Horizontal scrolling is acceptable only inside the mobile chart and navigation containers; the page itself must not overflow.

| Width | Overview | Live Session | Projects | Insights | Settings |
| ---: | --- | --- | --- | --- | --- |
| 1440 px | Four metrics, two-column history/forecast, lower panels | Hero, timeline, and details | Full table and three-column branches | Full insight cards | Two-column form and privacy cards |
| 1024 px | Two-column metrics, stacked history/forecast | Stacked timeline and details | Reduced table columns | Full insight cards | Stacked settings layout |
| 768 px | Horizontal top navigation, two-column metrics | Stacked layout | Reduced table and two-column branches | Full insight cards | Single-column layout |
| 390 px | Single-column cards; chart scrolls within its panel | Two-column metrics; full-width session picker | Compact rows; one-column branches | Compact two-column cards; scrollable filters | One-column fields and full-width save button |

For each cell:

- [ ] No text overlaps, clips, or becomes unreadable.
- [ ] Page-level horizontal scrolling is absent.
- [ ] Zoom at 200% remains usable.
- [ ] Focus indicator is visible and not clipped.
- [ ] Interactive controls expose at least a 44×44 CSS-pixel target.

## Keyboard and semantics

- [ ] The skip link appears on focus and moves to dashboard content.
- [ ] Tab and Shift+Tab reach navigation, project search, expandable project rows, insight filters, session links, session picker, all settings fields, and Save.
- [ ] Arrow keys plus Home/End move through dashboard navigation without trapping focus.
- [ ] Arrow keys plus Home/End select insight filters, and `aria-pressed` follows the selection.
- [ ] Enter/Space activates view buttons, project rows, filters, session links, and Save.
- [ ] Expanded project rows announce `aria-expanded=true`; collapsing announces `false`.
- [ ] Only the active view is exposed; inactive panels have the `hidden` attribute.
- [ ] Headings form a useful page/view/card hierarchy and all form controls have labels.
- [ ] Status changes for the local connection, settings save, and toast are announced politely.

## State coverage

- [ ] Fresh install: zero sessions, zero projects, and zero insights render useful empty states.
- [ ] One session: the Live Session picker and timeline remain usable.
- [ ] Disconnected SSE: the status reads “Reconnecting” without relying on red alone.
- [ ] Invalid local stream data: the status reads “Invalid local data.”
- [ ] Fallback model pricing: Session Details says “Fallback estimate used.”
- [ ] Large history: Overview displays the latest 14 days and the timeline remains bounded to 500 points.
- [ ] Charts include text totals/peak summaries and use different shapes plus labels, not color alone.

## Privacy verification

- [ ] Browser Network shows only `127.0.0.1`/localhost requests.
- [ ] No remote image, font, script, stylesheet, telemetry, analytics, or CDN request occurs.
- [ ] Synthetic fixtures contain no real username, filesystem path, prompt, or tool output.
