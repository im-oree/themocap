# Electron packaging plan

**Placeholder — filled in during Document 7 (spec Phases 7 + 8).**

Nothing here is decided yet. Recorded now only so later phases have somewhere to
put their notes, and so the constraints Document 1 already imposed are not
rediscovered later.

## What Document 1 already did for this

- `Toolbar` supports a draggable region (`app-region-drag` / `app-region-no-drag`
  utilities in `packages/ui/src/styles.css`), so the custom title bar a frameless
  Electron window needs is already accounted for in the design system.
- The app is fully local: no CDN, no remote font, no remote model. A packaged build
  has nothing to strip out.
- COOP/COEP requirements are documented; under Electron these are supplied by the
  custom protocol handler rather than a web server, which is the main porting
  difference to work through.

## Open questions for Document 7

- Custom `app://` protocol vs `file://` (the latter is explicitly not supported
  today) and how cross-origin isolation is granted in that context.
- Native filesystem access replacing OPFS for project storage.
- Code signing and notarization for macOS distribution.
- Whether the mesh-regressor stretch goal is shippable at all given the SMPL
  licensing exclusion recorded in `docs/licenses.md`.
