# Approved Finradar UI alignment — 20 September 2026

The user approved the desktop/mobile HTML proposal after comparison with the current Finradar X Intelligence screen and `docs/spec/mockups/Main.dc.html`. This update applies Finradar's blue header, page/surface tokens, compact typography, module sidebar and mobile navigation to the existing standalone app. Phase 4 remains excluded.

Today now has a sortable calls table, retained card view, search/trust/stance filters, progressive disclosure of all matching calls, the existing submission and video activity controls, and sentiment/creator/review panels. Save and unsave share the unchanged action logic with Analysis and Saved; no route, provider control, budget setting, review, export or data operation was removed. Creator counts use the latest dated call per known creator/ticker, excluding signed rejections. Unknown creators are not counted. Empty states reflect stored data, not the illustrative mockup numbers. Price levels remain available in Analysis.

The header links only to working standalone routes. Finradar's Briefing, Adanos, Research and account actions are not fabricated in this app; those belong to the later integration. Existing Light/Dark/System preferences remain available. The light-on-dark-system badge bug was corrected, and explicit Dark now gets the same component styling as system dark.

## Verification

- Default and PGlite suites: 403 tests each, 402 passed, one existing opt-in real-Postgres skip, zero failures.
- Targeted viewmodel/metric registry: 13 passed, including a new creator de-duplication/rejection/latest-stance regression test (observed failing before implementation).
- Typecheck and production build pass. Offline legacy diagnostic passes in advisory-only mode, not a quality certification.
- Native Chrome: local fixture database; dev port 3020 followed by production build port 3021. No paid services or production data writes.
- Desktop: table/card switching, save in table, saved state retained in cards and across navigation, unsave in cards, Settings appearance save, trust heading sorting. Inspected 1440 × 1100 screenshot.
- Mobile: 390 × 844 responsive viewport; navigation drawer contains every module page and closes on Leaderboard navigation; leaderboard filters and export control remain present. Search empty state and clearing restore calls. Evidence deep-link opens selected NVDA evidence, translation, trust, level, review and processing controls. The synthetic video is unavailable; timestamped source fallback is shown, not claimed as successful live playback.
- Screenshots: ignored `data/browser/ui-alignment-20260920/desktop.png` and `mobile.png`, captured from Chrome and visually inspected. They precede the final wording-only correction from “shown” to “matching” and dark-control specificity fix.
- Chrome's installed Scribe/Grammarly/MetaMask extensions produce console warnings, including Scribe-added root attributes in development. Do not describe this session as warning-free. No application error screen observed in the production build.

These checks cover this UI change. They do not close the unrelated native-batch, HTTPS push delivery or complete historical browser acceptance gaps recorded in the standalone conformance report. Finradar deployment/integration is not included.
