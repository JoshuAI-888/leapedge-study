# Target-state mockups (Finradar theme)

Source artboards for the YouTube Intelligence v2 mockup canvas:
https://claude.ai/artifact/42c21wSpbiEtPrHJLh7THZ

Files are Design Component artboards (`.dc.html`) plus the canvas index. They render inside the canvas editor; the markup, tokens and copy are the reference for implementation. Tokens used are Finradar's: `#ffffff`, `#f7f9fc`, `#262626`, `#626b7b`, `#e5e9f0`, `#194df4`, `#edf3ff`, radius 14px, Inter/system font.

- `ProcessMap.dc.html` — end-to-end process map of the target design (inline SVG)
- `Main.dc.html` — Today: ranked trusted calls, sentiment shift, agreement, review queue (Finradar top nav: Daily briefing · Intelligence ▾ · Research ▾ · Settings; module side panel)
- `Leaderboard.dc.html` — leaderboard by ticker (consensus, sentiment shift, benchmark chosen by the viewer) and by creator, with significance gates, sortable columns and hover definitions
- `Analysis.dc.html` — decision-first report with trust strip, evidence pair and dated context check
- `Channels.dc.html` — creator trust distribution, forward record, automation mode
- `Settings.dc.html` — account settings (benchmark, comparison period) and team settings (sources with Supadata standby, models/transport, context check, budget)
- `Phone.dc.html` — Today at phone width

Figures on the boards are placeholders. In the product every displayed number is computed from stored rows at request time and every column heading carries a hover with its definition and calculation steps (spec section 4.11).
