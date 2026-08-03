# ESDS BOIP — Presentation Brief

**Bharat Opportunity Intelligence Platform** · Enterprise Market Intelligence for BFSI

Use this document to walk through the dashboard. Every section tells you *what to click*, *what to show*, and *what to say*.

---

## 1 · Elevator (30-second version)

> ESDS BOIP is a purpose-built market intelligence platform that reads 20,000+ BFSI company records from a single source of truth, ranks the entire universe by ESDS opportunity, and gives every persona in the go-to-market team — from a BDR to the CRO — the exact view they need to act on it. It's not a dashboard. It's a workspace.

## 2 · Why it's enterprise-grade (5 differentiators)

1. **Company as the atomic object** — every account has a permalink URL, a full 360° page, notes, engagement status, ownership, and a citation-backed AI brief. Same object model that Salesforce, Palantir, and Bloomberg Terminal use.
2. **Role-separated workspaces** — Executive, Sales, BDR, Solutions Architect, and Marketing personas each land on a different surface. One dashboard trying to serve everyone is objectively worse.
3. **Explainable AI, not black-box scores** — every opportunity score shows its drivers. Every ESDS product fit shows the reason. Every brief cites the source field. Nothing is unverifiable.
4. **Workflow, not just views** — save lists, take notes, assign accounts, track engagement status, tick off next actions, share the URL. The platform remembers what you did.
5. **Production-grade under the hood** — hash router, event bus, focus-trapped modals, WCAG 2.1 focus rings, screen-reader announcements, global error boundary with data-source-fatal recovery, input sanitization on every user-supplied string, virtualization-ready for 20K+ records, dark + light theme, print-optimized outputs.

---

## 3 · The tour — 12 screens

Each block: **what to click** → **what to show** → **what to say**.

### 3.1 Home dashboard (`#/`)
- **Click** the app to load. Wait for the loading screen to complete.
- **Show** the 12 executive KPI cards, the enterprise filter panel, the geo-intelligence map, and the analytics tabs.
- **Say** *"This is the traditional 'dashboard' view — 20,000 companies aggregated across 12 executive KPIs, 15 enterprise filters, an interactive India map with clustering, heatmap, and choropleth modes, and 15 Apache ECharts across four analytical tabs. But this is only Home — one page inside the platform."*

### 3.2 Command palette (⌘K or Ctrl+K)
- **Click** anywhere and press **Ctrl+K** (or type `/`).
- **Show** the palette opening. Type a company name — see live fuzzy match. Then clear it and type `"banks in maharashtra with low cyber maturity"`.
- **Say** *"This is the enterprise power-user layer. Fuzzy search across 20,000 companies, jump to any page or action, natural-language search that parses sector, state, city, maturity level, revenue band, and ownership shortcuts into filter chips. Press Enter and the whole dashboard filters. Modeled on Bloomberg Terminal and Superhuman."*

### 3.3 Enterprise filters (scroll to filter panel on Home)
- **Show** the 15 filter fields: Owner, Signal Type, Δ Score, Region, State, City, Category, Sub-category, Revenue, Employees, CEO, CTO, CIO, Cloud, Pain Point, AI, Cyber, ESDS Product.
- **Say** *"15 filter dimensions with cross-filtering — pick a region and the states auto-narrow. Save filter presets to localStorage. Every filter change is announced to screen readers and sanitized against injection. The three orange filters at the top are workflow filters: `Owner` (my accounts / unassigned / by user), `Signal Type` (buying / gap / risk / initiative — derived from the data), and `Δ Score` (accounts whose opportunity score changed since the last data load)."*

### 3.4 Company 360 (click any company anywhere)
- **Click** any company from the map, a chart, a list, or Ctrl+K search.
- **Show** the full three-column layout: financials + facts + leadership on the left; the AI-generated Account Brief with citation chips in the center; signals + notes + peer companies on the right. Every claim in the brief has a citation chip underneath showing which field it cites.
- **Say** *"This is the atomic object of the platform. Every company has a permalink URL like `#/company/hdfc-bank`. Notice: the score chip in the header shows opportunity level. The status dropdown persists engagement stage — New, Researching, Contacted, Qualified, Won, Lost, DQ. One-click 'Assign to me' puts it in my book. Bookmark it, add it to a list, launch a comparison. The Account Brief is generated deterministically — every claim cites the source field. When we plug in a real LLM, only the generator changes."*

### 3.5 Meeting prep (Prep Meeting button on Company 360)
- **Click** the **Prep Meeting** button in the Company 360 header.
- **Show** the full one-page brief: Elevator · Talking Points · Discovery Questions in 3 tiers · Objection Handling with pre-written responses · Next-Step Commitments.
- **Say** *"One-click sales meeting brief. Elevator pitch. Discovery questions at three depth tiers. Objection handling for the five common BFSI pushbacks — price, sovereignty, timing, compliance, in-house preference. Print-optimized: the print button fires the browser print dialog with a scoped CSS rule that hides everything except this modal. Sales rep hits the meeting with a printed briefing sheet."*

### 3.6 Executive dashboard (`#/executive`)
- **Click** **Executive** in the sidebar.
- **Show** the 5-row layout: 5 KPI tiles (Pipeline TAM · Whitespace TAM · Coverage % · Hot Leads · Data Quality) · sectors & states ranked by TAM · fresh signals + score movers · ESDS product coverage · data health.
- **Say** *"This is what a CRO or Head of BFSI sees. No filter bar. No exploration. Every tile answers a leadership question in 15 seconds and has a drill-in link to the operational surface. Whitespace TAM is the killer number — 'how much money are we leaving on the table because those accounts are unassigned and unengaged?' Click it and it opens the Whitespace Analysis page."*

### 3.7 Whitespace Analysis (`#/whitespace`)
- **Click** the **Whitespace TAM** tile on the Executive dashboard, or **Whitespace** in the sidebar.
- **Show** the 4 KPI tiles at the top, then the ranked table of unengaged high-fit accounts with per-row rationale (why it's a whitespace opportunity), then the **Assign top 10 to me** bulk action and the sector breakdown at the bottom.
- **Say** *"The single most strategic page in the platform. Every row is an account that (a) meets the opportunity threshold, (b) is unassigned, and (c) has no engagement status. The rationale column tells the sales leader why: `₹80 Cr wallet · Cyber uplift · Documented pain`. One click, top 10 land in my book. Filter by sector, region, minimum score. This is the whitespace conversation you have with your CRO."*

### 3.8 My Territory (`#/my-territory`)
- **Click** **My Territory** in the sidebar.
- **Show** the 3-tile summary header (Pipeline TAM, Hot leads, Avg score), the status-chip bar (New 4 · Researching 2 · Contacted 5 · ...), and the table of my assigned accounts sorted by opportunity with inline status change and signal badges.
- **Say** *"Every Sales user lands on this page. Everything I see is filtered to my ownership. Change status inline. Unassign with one click. When someone else in the roster is switched to (see the user switcher at the bottom of the sidebar) the whole page re-computes to their book. This is where a Sales rep spends 80% of their day."*

### 3.9 Weekly Digest (`#/digest`)
- **Click** **Digest** in the sidebar.
- **Show** the personalized hero with greeting + book stats, score movers in my book, top 5 accounts to action **with a suggested next step per account based on status**, new signals across the broader book, and the enrichment watchlist for accounts with low data completeness.
- **Say** *"This is the reason someone opens the app on Monday morning. Personalized to me. Suggests 'next step' per account driven by current status: New + hot score → 'Book a discovery call this week'. Qualified → 'Prepare tailored proposal'. Won → 'Cross-sell review'. The Print button hands the digest to the browser print dialog for PDF export."*

### 3.10 Sectors index + deep-dive (`#/sectors` → `#/sector/:name`)
- **Click** **Sectors** in the sidebar. Then click on any sector card — say `Private Bank`.
- **Show** the sector deep-dive: macro KPIs, then the maturity profile (stacked bars showing High/Medium/Low distribution per dimension), signal density tiles, top states in the sector, ESDS product fit density, and the top 10 companies in that sector.
- **Say** *"This is sector-level intelligence. Which sectors have the best cloud maturity? Which are dominated by cyber risk? Which ESDS products fit each sector best? Product Fit Density is the killer view — sales enablement knows which product to lead with per sector."*

### 3.11 Signals feed (`#/signals`)
- **Click** **Signals** in the sidebar.
- **Show** the time-ordered feed with type filter tabs at the top (All / Buying / Gap / Risk / Initiative / Internal).
- **Say** *"Time-ordered stream of what changed. Notes I add to companies show up as Internal signals — the platform's memory of what my team has learned. Signals are derived today; when we plug in external feeds (news, hiring, funding APIs), they land in the same feed."*

### 3.12 Compare (Compare button on Company 360 or ⌘K)
- **Click** **Compare** on any Company 360 page, or ⌘K → `Open Compare`.
- **Show** the compare modal with up to 3 companies side-by-side: radar chart, feature comparison table, strength/weakness cards, gap analysis, AI recommendations, and the top 10 / quick wins / high ROI targeting panel.
- **Say** *"Deal-team comparison. Radar chart across 6 dimensions. Gap analysis identifies where one leads and one lags. Strength/weakness cards per company. AI recommendations tuned to each. And the targeting intelligence at the bottom — Top 10 to target, quick wins (low complexity, high score), and high-ROI accounts. Every deal review starts here."*

### 3.13 Export (Export button on any page)
- **Click** **Export** in the header or in the Company 360 header.
- **Show** the 5-option grid: CSV · Excel · PDF · PNG snapshot · Print.
- **Say** *"Every dataset in the platform is exportable. CSV with proper escaping. Excel via SheetJS. PDF via jsPDF. PNG snapshot via html2canvas. Print via the browser print dialog with scoped CSS. Filter the data first, then export — the export respects the filter state."*

---

## 4 · Numbers to cite in the pitch

| Metric | Value |
|---|---|
| Company records loaded | 20,000+ (from two Master BFSI Excel files) |
| Executive KPIs on Home | 12 with sparkline trends |
| Interactive charts | 15 (across 4 tabs) + 3 sidebar quick charts |
| Filter dimensions | 15 |
| ESDS products in the recommendation engine | 20, scored across 9 dimensions |
| Personas in the identity roster | 6 (Executive, Sales West, Sales South, BDR, SE, Marketing) |
| Engagement statuses | 7 (New / Researching / Contacted / Qualified / Won / Lost / DQ) |
| Routes / pages | 11 (Home, Executive, My Territory, Digest, Signals, Lists, Lists detail, Whitespace, Sectors index, Sector deep-dive, Company 360) |
| Export formats | 5 (CSV, Excel, PDF, PNG, Print) |
| Compare capacity | Up to 3 companies with radar, gap analysis, and AI recommendations |
| Signal types derived | 4 (Buying, Gap, Risk, Initiative) + Internal notes |
| Frontend size | ~65 JS modules, ~4,700 lines of CSS |
| Backend | None — 100% client-side, static hosting, works offline after first load |
| Third-party libs | Leaflet, Apache ECharts, SheetJS, jsPDF, html2canvas — all lazy-loaded from CDN |

## 5 · The architecture story (2 minutes)

> **"We built this as a workspace, not a dashboard. The atomic unit is the Company object — every company has a permalink URL, a full 360° page, notes, ownership, and engagement status. Every module — filters, map, charts, compare, export, digest, whitespace, sector deep-dive — is a view on that object graph, coordinated through a single event bus."**
>
> **"Zero framework. Zero build step. Pure vanilla ES modules. This runs on any static server — S3, Netlify, GitHub Pages — and works with no backend at all. Data reads from Excel files via SheetJS at boot. Workspace state (notes, bookmarks, status, lists, saved filters) persists to localStorage. When we add a real backend, we swap the data engine and the workspace store — nothing else changes."**
>
> **"Every piece is production-grade. Global error boundary that keeps the dashboard alive even when a section fails. Input sanitization on every user-supplied string. Focus-trapped modals with keyboard navigation. Screen-reader live-region announcements. Visible WCAG focus rings. Reduced-motion support. Dark + light theme with a smooth switch. Print-optimized CSS for meeting briefs and reports."**

## 6 · What's next (roadmap slide)

| Phase | Value | Status |
|---|---|---|
| Phase 1 | Router · Workspace store · Company 360 · Command palette · Lists · Signals | **Shipped** |
| Phase 2 | Identity/roles · Territory · Executive dashboard · My Territory · 3 workflow filters | **Shipped** |
| Phase 3 | Whitespace · Sectors index · Sector deep-dive | **Shipped** |
| Phase 4 | Citation-backed AI brief · Meeting prep · Weekly digest · Natural-language search | **Shipped** |
| Phase 3.5 | India map layer stack (penetration / whitespace / territory choropleth modes) | Next |
| Phase 5 | Collaboration (@-mentions, comments, watchlists) · Verification queue · Admin | Queued |
| Phase 6 | Real LLM integration (replaces deterministic generators) · CRM push · Slack/Email digest delivery | Queued |

## 7 · Talking points for the Q&A

- **"Where's the AI?"** → *"Everywhere, but explainable. Score drivers, brief citations, meeting prep, natural-language search. The generators are deterministic today — when we swap in an LLM, every consumer keeps working because the output shape is stable."*
- **"How does it scale?"** → *"Set-based indexed lookups in the DataCache handle 20K+ records with O(1) filter intersections. Charts and lists are lazy — nothing renders until needed. Third-party libraries CDN-load only when the surface using them is opened."*
- **"Where's the backend?"** → *"None yet, by design. Everything runs client-side against Excel files loaded at boot. This is the fastest possible path to shipping — no infra to provision, no auth to build, no API to version. When we're ready, the data engine becomes an API client and the workspace store becomes a real database. Nothing else changes."*
- **"How do you handle data quality?"** → *"Confidence score on every company (data completeness across 12 fields). Freshness metadata on every record. Enrichment watchlist in the Digest page surfaces the accounts most in need of attention. When real per-field source dates flow through, the same UI absorbs them."*
- **"Can we plug this into Salesforce / HubSpot / Zoho?"** → *"Yes — the workspace store already emits `workspace:*` events for every state change. Adding a CRM push subscriber is a Phase 6 deliverable, not a rewrite."*

## 8 · Screenshot capture list

When you take screenshots for the deck, get these 12 in this order:

1. Home dashboard — hero shot with KPIs + map + filters visible
2. Command palette open with NL query typed in
3. Filter panel with the three orange workflow filters visible
4. Company 360 — the citation-backed AI brief scrolled into view
5. Meeting prep modal open
6. Executive dashboard — full 5-row view
7. Whitespace Analysis — showing the table with rationale column
8. My Territory — with a real book (assign 5-10 first via Whitespace's bulk action)
9. Weekly Digest — after switching user + assigning accounts
10. Sector deep-dive on `Private Bank` or `NBFC`
11. Signals feed with the type-filter tabs
12. Compare modal with 3 companies loaded

---

## Appendix — Key URLs to demo from

```
#/                      Home (existing dashboard)
#/executive             Executive dashboard
#/my-territory          My Book
#/digest                Weekly Digest
#/whitespace            Whitespace Analysis
#/sectors               Sectors index
#/sector/Private Bank   Sector deep-dive
#/signals               Signals feed
#/lists                 Saved lists
#/lists/_bookmarks      Bookmarks
#/company/hdfc-bank     Company 360 (URL-encoded dedupe key)
```

Press **⌘K** or **Ctrl+K** at any time to jump anywhere.

---

*ESDS Software Solution Limited · Confidential · Internal use*
