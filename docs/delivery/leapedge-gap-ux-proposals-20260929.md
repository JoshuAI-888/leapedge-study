# LeapEdge-gap features — UI/UX requirements, 29 September 2026

This is the written requirement for phase 5 (ledger F56–F77). The wireframes that illustrate it
are in `docs/spec/mockups/LeapEdgeGaps.html` (published: https://claude.ai/artifact/R5WyW2Uqjw44CbB9nBo75s).
Where the two differ, this file wins. Scope decisions per gap: `leapedge-gap-decisions-20260929.md`.
Spec amendments: `docs/spec/youtube-intelligence-v2-spec.md` §7.6.

Evidence base: code on `main` at `931c643`, plus desktop (1440), phone (390) and dark-mode
screenshots of every page, taken against the local fixture database (`scripts/seed-browser.ts`).
Wireframe figures are illustrative examples; the product computes every number from stored rows.

## Decisions (accepted by the user, 29 September 2026)

| # | Decision |
|---|---|
| D1 | A live step progress bar is shown **only while a run is working** (Analysis page, Today activity row). Finished runs return to the four states of §7.2. Cost stays in Processing details. |
| D2 | The module sidebar is grouped: **Read** (Today, Daily report) · **Research** (Search, Trends, Leaderboard) · **Sources** (Channels) · **Your work** (Saved calls) · **Operate** (Lab, Settings, Methodology). Quick search sits at the top of the module sidebar, not in Finradar's top bar. The duplicate Saved calls/Settings links leave the top bar. Phone tab strip: Today · Report · Search · More. |
| D3 | Today's "Material developments" (per-video brief ranking) moves to the Daily report page as "Video briefs". Today's top slot shows the report summary. |
| D4 | Periods, ranges and filters are **view state in the URL**, seeded from the saved setting. Changing them never writes a team or account setting. Applies to the existing Sentiment panel too. |

## Cross-cutting requirements

### Audit fixes that ship with F57

1. **Filters say what they hide.** Every filtered view states "N calls hidden by <filter>" with a one-click reveal. Today and the Leaderboard currently open with 0 rows because the default trust filter (Audio-agreed) hides every Extracted call.
2. **Short pages align to the top.** `main.yi-main` is vertically centred inside `.yi-frame`, which leaves about 150 px of blank space above short pages.
3. **Evidence panel fixes (Analysis page).**
   - The panel is sticky instead of an internal scroll box, so "Review this evidence" is reachable on desktop.
   - On a phone, evidence opens under the selected card.
   - The whole claim card is the selectable control (aria-pressed); the stray "Select X evidence" links are removed.
4. **Trust names are consistent.** Use the names, not L0–L3, in the Leaderboard filter. Zero counts are muted.
5. **No internals in user-facing text.** No raw ISO timestamps, repo paths, or schema/config keys in Title Case. Channel catalogue provenance goes behind a disclosure.
6. **Settings navigation.** Settings gets section anchors and a sticky save bar.

### Sentiment colour and marks

- **Seven stances, three sentiments.** Aggregate visuals use the three sentiments derived from stance (`contracts.ts`), never the seven stances. Stance chips keep their text labels.
- **Validated palette.** The existing green/red fails CVD (deutan ΔE 5.2). Use these, validated with the dataviz skill's `validate_palette.js`:

  | Sentiment | Light | Dark |
  |---|---|---|
  | Bullish | `#0f8f6f` | `#2aa384` |
  | Neutral | `#8a94a6` | `#8b95a8` |
  | Bearish | `#c7492e` | `#d9603e` |

  Result: light ΔE 9.1, dark ΔE 9.7.
- **Never colour alone.** Sentiment always has a second cue as well: ▲ ● ▼ glyphs or text, a fixed order (bullish first or on top), and a table view.
- **Colour means sentiment only.** Price change is ink-coloured text with a sign, never green/red, so colour keeps one meaning.

### Shared parts (F57 unless noted)

| Part | Requirement |
|---|---|
| Sentiment split bar | Three segments with 2 px gaps, counts as text beside it ("12 ▲ · 3 ● · 1 ▼"), and calls and creators in the hover. |
| Headline tile row | At most four tiles. Each shows a value, the change against the prior period, and an optional sparkline. |
| URL filter bar | One row above the content, date range first. Active filters show as chips with "Clear all". Includes the "hidden by filter" line. On refetch the previous render stays at reduced opacity. |
| Instrument label (F59) | `NVDA`, `MACRO · RATES`, `SECTOR · SEMIS`. Non-tickers use a dashed outline. Links to Search. |
| Trading-day label (F58) | "Mon 28 Sep · US session". The hover gives the local publish time and the session-assignment reason. |
| Export menu (F63) | CSV · JSON. States its scope ("41 calls matching these filters"). Disabled when there are no rows. |
| Step progress bar (F72) | Five plain-language steps, current step name, elapsed time, Retry on failure. |
| Call card v2 (F60) | Action line, level chips, catalysts, expiry with days remaining. Risks and conditions are collapsible. |
| Verdict line (F61) | "4 ideas · 3 ▲ 1 ● · NVDA AVGO TSM" on every list of videos. |

### Data

Pages today read one capped workspace snapshot (`actions/research.ts` reports `truncated`). Search, Trends, channel pages, the report archive, Export and quick search must use paged server-side queries (F56). They must report true totals, never a silent cap.

## Per-feature requirements

### F56 — Research query API
Server-side, paged queries over calls and videos, filtered by:
- instrument and type
- channel
- stance and sentiment
- conviction
- trust
- trading-day window
- text

Every query returns facet counts and set aggregates: the sentiment split, conviction histogram, top instruments and top channels.

Text search matches substrings in title, thesis, quote and translation, including CJK. This avoids LeapEdge's prefix-only title search.

The same query layer serves F62–F66, F63 and F76.

### F57 — UX foundations
The shared parts, the palette and the audit fixes above, plus the D2 sidebar and phone tab strip.

### F58 — US trading day and team time zone (gap 14)
- **Session assignment:** every "day" is a US session (ET), holiday-aware. Weekend and holiday uploads roll into the next session.
- **Local times:** times display in the team time zone, chosen in Settings (a searchable IANA list). The digest time-zone field merges into it.
- **Hover:** gives the reason, e.g. "Published Sat 26 Sep 14:00 NZDT → Mon 28 Sep session (weekend)".
- **Date pickers:** date pickers and previous/next skip non-trading days, and holidays are named.
- **Page header:** shows market status, e.g. "US market: pre-market · opens in 2 h 10 m".
- **ISO timestamps:** raw ISO strings are removed from the UI, starting with the Leaderboard's "As of".

### F59 — Macro, theme and sector views (gap 13)
- **Vocabulary:** a fixed list — Rates, Inflation, USD, Oil, Gold, Growth, Liquidity, Credit, plus GICS sectors — so grouping is stable.
- **Labels:** rendered with the instrument label.
- **Filter:** a "Type" filter (Stocks & ETFs · Crypto · Macro · Sector) in Search and Trends.
- **Aggregates:** these views appear in In focus, the sentiment panel and trending like tickers.
- **Unresolved instruments:** "Unresolved instrument" is kept only for genuinely unknown names. It is muted and carries a "Suggest a ticker" hint.

### F60 — Richer call fields (gap 6)
- **New fields:** catalysts, expiry, and recommended action.
- **Parsed levels:** each level carries a parsed value (number or range, currency, comparator such as "close above"). The original text is always kept.
- **Version:** a new prompt/schema version.
- **Card layout:**
  - Line 1: instrument, stance, conviction, trust, with horizon and expiry right-aligned. Expiry turns amber when near and reads "expired" once past.
  - Line 2: thesis.
  - Line 3: action.
  - Then level chips (hover shows the original wording), catalyst chips, and collapsible risks and conditions.
- **Unparsed levels:** a level that cannot be parsed shows its original text with a dotted underline. Never invent a number.
- **Older calls:** show only the fields they have, with no empty rows.
- **Elsewhere:**
  - Today's table gets an optional Levels column, off by default.
  - Search gets "Has levels" and "Expires within" filters.

### F61 — Verdict, summary and key points (gap 5)
- **Page order:** the Analysis page becomes:
  1. Header with verdict box (idea count, overall conviction, split bar, tickers) and summary paragraph.
  2. Numbered key points (at most 10, in video order), each with a ▶ timestamp that plays the embedded player.
  3. Tabs: **Calls · Research brief · Processing details**.
- **Research brief:** "Generate research brief" becomes a secondary action, with a cost estimate, inside its tab.
- **Trust strip:** moves into the Calls tab.
- **No ideas:** "No investable ideas · educational or commentary". The summary and key points still show.
- **Still running:** the verdict box is replaced by the progress bar (F72).
- **Verdict line:** the compact verdict line appears on Today activity, channel pages, Search Videos and report sources.

### F62 — Search (gap 2)
- **Route:** `/youtube-intelligence/search`, with state in the URL.
- **Layout:** three panes.
  - **Filters**, each with a live count: instrument, type, sentiment/stance, conviction, trust, channel, date window, pinned only. Zero-count options stay visible but greyed.
  - **Results**, in Calls and Videos tabs. Sort by newest, conviction or trust. "Load 50 more" with an honest total.
  - **Summary of the filtered set:** counts, split bar, conviction histogram, top instruments and channels, and a preview of the hovered row.
- **Trust default:** Text-checked, with the "hidden by trust" line.
- **No results:** suggests the single filter removal that returns the most rows.
- **Phone:** a "Filters (n)" sheet with a sticky "Show N calls" button. The summary collapses to one line.
- **Entry points:**
  - Today's "Find a call" hands its text to Search.
  - Every instrument label and channel name links here.
  - The Leaderboard and channel page link "See all calls →".

### F63 — Export (gap 10)
- **Where:** one Export menu on Search, the channel page, the Daily report, Saved calls and the Leaderboard (existing).
- **Call columns:**
  - call id, session date, published at (UTC), channel, video title and timestamped link
  - instrument and type, stance, sentiment, conviction, trust
  - thesis, action, levels (original and parsed), catalysts, risks, horizon, expiry
  - quote, translation
- **JSON:** nests evidence spans.
- **Report export:** the report exports its themes with citations and its In focus rows as JSON.
- **Large exports:** more than 5,000 rows are prepared server-side with progress shown.
- **File footer:** each file states the filters, the trust basis, and "Trust describes the evidence, not investment quality". The Methodology page documents the columns.

### F64 — Daily report (gap 1)
- **Routes:** `/youtube-intelligence/report/<session-date>`; archive at `/youtube-intelligence/report`.
- **Header:**
  - The session date, with previous/next arrows that skip non-trading days.
  - A one-sentence consensus headline.
  - The split bar with creator count.
  - Source count, check status and generation time.
  - Cost stays out of the header.
- **Sections:**
  - **Themes:** 3–5. Every bullet carries citation chips (channel ▶ timestamp) that open the analysis at that moment.
  - **In focus:** ranked instruments, including macro, with creators, split bar, change against the prior session, and a one-line reason. A row expands to its calls.
  - **Where creators disagree:** instruments with calls on both sides, quotes side by side.
  - **Video briefs** (moved from Today, D3).
  - **Sources:** each with its verdict line.
- **Archive:** past sessions, each with its headline and split bar. Shown as a right-hand column on desktop and a list page on a phone.
- **States:**
  - **Before generation:** "Generated at 08:30 ET (local time); showing <previous session>".
  - **Fewer than 3 videos:** no synthesis. Show the calls table and say why.
  - **Points removed by the check:** an amber strip listing them. Never hide them silently.
  - **Failure:** a plain-language error with Retry.
- **Today:** the report summary card replaces Material developments, and "Across creators" folds into In focus.
- **Unchanged:** the existing public share page keeps working. No new share UI (sharing is out of scope).

### F65 — Trends (gap 3)
- **Route:** `/youtube-intelligence/trends?by=ticker|channel|sentiment&value=…&range=…`.
- **Filter row:** view by, value, range chips (1d · 7d · 30d · 90d · 1y · All), trust.
- **Headline tiles:** calls (change against the prior period), sentiment split, typical conviction, creators.
- **Main chart:** weekly columns, bullish above the zero line and bearish below. The period is daily for ranges of 7 days or less.
- **Ticker view:** a second chart on the same date axis, with its own vertical scale, places each call on the adjusted-close line. Dot size shows conviction. Never use two scales on one chart.
- **Channel and sentiment views:** a call-dot timeline with at most three lanes.
- **Interaction:**
  - Crosshair snaps to a period; the tooltip lists all three counts.
  - Each dot has a hit area of at least 24 px.
  - Click a column to filter the list; click a dot to open the call.
  - Chart · Table toggle; Export.
- **States:**
  - **Fewer than 5 calls:** list only, with a note.
  - **No price series:** the price chart hides with a message.
- **Chronicle:** not repeated here; it is the report archive.

### F66 — Channel page (gap 4)
- **Route:** `/youtube-intelligence/channels/<channel id>`, linked from every channel name.
- **Header:**
  - Name, handle, followed since, live status.
  - Follow and process-new-uploads switches, moved from the Channels card.
  - Search this channel, Open on YouTube, Export.
- **Tiles:**
  - videos analysed (with count in the last 7 days)
  - calls per video
  - lean split bar
  - record against the team benchmark, with the leaderboard's significance wording (n, q, "not significant")
- **Sections:**
  - Calls over time (the Trends chart, channel preset).
  - Most-discussed instruments with split bars.
  - Recent analyses with verdict lines and unread dots.
  - A collapsed Processing section: discovery mode, tier, last pull, projected cost, trust distribution.
- **Too few settled calls:** "Too few settled calls to score (3 of 5)".

### F67 — Channels list (gap 11)
- **Order:** followed channels first, as a sortable table: channel, status, last video, videos in 7 days, top instrument, lean, record. Cards on a phone. Headings come from the metrics registry.
- **Sort presets:** Most active · Recently added · Best record.
- **"+ Add channels" drawer:** holds Follow, Discover, the catalogue (source notes behind "Where this list comes from") and the cost preview.
- **Row click:** opens the channel page.
- **Status chip:** replaces the "Queued / analysed" pseudo-button.
- **Silent channels:** flagged in amber, e.g. "No uploads 21 d".
- **Copy fixes:** "Projected: Not selected / month" becomes "Not processed automatically", and the unlabelled "· 1" is labelled or removed.

### F68 — Watchlist (gap 8)
- **Where:** a Today right-hand panel with Pinned and Mentioned-today tabs. Pinned uses the existing `watch` action.
- **Each row:**
  - instrument
  - 20-session sparkline in neutral ink with an emphasised endpoint
  - 1-day % change as signed text
  - today's mentions with sentiment glyphs
  - "Closes to <date>" label
- **Divergence flag:** mostly bullish calls with the price down more than 5%, or the reverse.
- **Pin toggle:** on the instrument label in the Analysis header, Search, In focus and quick search. This is the team watchlist, not a personal favourite.
- **Pinned only:** a "Pinned only" filter in Search.
- **Phone:** a horizontal tile scroller.
- **Prices:** existing price data only; no new vendor.

### F69 — 24-hour trending (gap 15)
- **Period control:** the Sentiment panel's period becomes segments (24h · 7d · 14d · 30d) held as view state (D4).
- **Session-aligned window:** 24h means "since the previous session close", e.g. since Friday's close on a Monday.
- **Row:** instrument · split bar · creators · change against the prior window ("+4 creators", "new"). Evidence links stay in the disclosure.
- **Empty state:** names the window.

### F70 — Unread markers (gap 18)
- **Dot:** an accent dot on unseen videos, on Today, channel pages and Search Videos.
- **Sidebar:** "N new" beside Today.
- **Today group:** "New since <time>" with "Mark all as seen".
- **What counts as seen:** opening the analysis.
- **Storage:** browser local storage. Hover text: "Tracked on this browser". Never implied to be per person.
- **Blocked storage:** no dots, and nothing breaks.

### F71 — Follow prompt (gap 19)
- **Banner:** under the verdict header on analyses from unfollowed channels, and on the channel page.
- **Contents:** uploads per week, estimated monthly cost (the Channels projection) and remaining budget, with Follow and Not now.
- **Over budget:** Follow defaults to discover-only when the projection exceeds the budget, and says so.
- **Not now:** hides the banner for that channel on this browser for 30 days.

### F72 — Live progress and Retry (gap 12)
- **Steps:** five plain-language steps mapped onto pipeline stages: Title · Transcript · Extract · Check · Publish.
- **Running:** current step, elapsed time, and typical duration from stored timings of similar-length videos.
- **Stuck:** after 3× the typical time, "This is taking longer than usual" with Retry.
- **Failure banner:** names the stopped step and the reason, with:
  - "Retry from step N" and its estimated cost (resumes from checkpoints; no double spend)
  - "Transcribe audio instead" when captions failed
  - Details
- **Existing action:** `recoverAudit` gets its button, "Retry the check".
- **Today activity rows:** a mini progress bar and an inline Retry.
- **Timing card:** leaves the default view (it currently says "In progress" on finished runs).

### F73 — Token counts (gap 20)
- **Table:** Processing details gets one table with a row per model call, retries included: step, model, input, cached, output, time, cost, with a total row.
- **Raw data:** the JSON moves behind "Show raw data".
- **Lab:** cost diagnostics gains the same columns aggregated per step.

### F74 — Reuse finished analyses (gap 7)
- **Resubmission:** submitting a video with a completed run on the same pipeline and prompt version opens that analysis. Notice: "Already analysed <date> with the current pipeline. No new cost."
- **Re-run:** confirmed in-page (no browser dialogs), with the estimate and remaining budget; the audit trail records it.
- **Older pipeline version:** offers a re-run and never auto-reuses.
- **Analysis header:** shows "Reused · analysed <date>".

### F75 — Saved calls (gap 17)
- **Tabs:** Open · Reviewed · Removed · All, with counts, replacing the Status select.
- **Grouping:** by session date. Alternative sort: expiring soonest.
- **Cards:** call card v2 with the note below, an expiry badge, and the price change since the call ("since <close date>").
- **Delete permanently:** only in Removed, with an inline confirmation.
- **Export:** of the current tab.

### F76 — Quick search (gap 16)
- **Shortcut:** ⌘K / Ctrl+K from any page. The field sits at the top of the module sidebar; on a phone, a full-screen sheet opens from a header icon.
- **Groups:** Instruments, Channels, Videos, Pages, Actions.
- **Pasted links:** a pasted YouTube link offers "Analyse this video".
- **Matching:** substring, including CJK.
- **Enter behaviour:** Enter on an instrument opens Search; ⌘Enter opens Trends.
- **Recent searches:** the last 5 are listed.
- **Data:** a server-built index (F56).
- **Accessibility:** combobox ARIA; keyboard only (↑↓, Enter, Esc).

### F77 — Phase-5 gate
- **Checks:** the browser and visual matrix for every new or changed surface: desktop and 390 px, light and dark, keyboard-critical flows, and empty, loading, error and retry states.
- **Fixture data:** covers macro views, CJK titles, parsed and unparsed levels, reuse, and failed runs.
- **Also required:** registry CI for new columns, and conformance written under `docs/gates/`.
- **Reporting:** comparison with LeapEdge is reported separately and is never counted as verified accuracy.
