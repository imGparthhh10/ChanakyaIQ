# ChanakyaIQ Platform — Full Pipeline

This document maps every stage the live platform goes through: browser input → frontend →
Express API → service/repository layer → PostgreSQL → response → client cache → rendered
output (charts, map, pages, export). It also breaks out the individual pipelines that don't
show up in the top-level flow: login/session, ICP scoring, Business Intent scoring, search,
crawler, enrichment, and bulk import.

Edit this file directly — it's plain Markdown with [Mermaid](https://mermaid.js.org/) diagrams,
so it renders on GitHub, in most editors, and stays in version control with the code it
describes. If a route, service, or table changes, update the relevant section here in the
same PR.

---

## 1. End-to-end pipeline

```mermaid
flowchart TD
    subgraph INPUT["01 · INPUT — Browser"]
        I1["Sign in"]
        I2["Browse a page<br/>#/sector · #/company · #/directory"]
        I3["Filter / search / sort"]
        I4["Trigger admin run<br/>ICP or Business Intent"]
    end

    subgraph FRONTEND["02 · FRONTEND — assets/js"]
        F1["dashboard.js<br/>boot, gate on session"]
        F2["router.js<br/>hash match → mount page"]
        F3["authClient.js<br/>attach JWT from localStorage"]
        F4["data.js<br/>authFetch() orchestration"]
        F1 --> F2
        F2 --> F4
        F3 --> F4
    end

    subgraph GATEWAY["03 · API GATEWAY — backend/src/app.ts"]
        direction LR
        G1["CORS + express.json()"] --> G2["requestLogger"] --> G3["requireAuth<br/>verify JWT"] --> G4["Session check<br/>not expired/revoked"]
    end

    subgraph CORE["CORE DATA SERVICES"]
        C1["/organizations"]
        C2["/branches"]
        C3["/dashboard<br/>KPIs, revenue, funnel"]
        C4["/search<br/>pg_trgm fuzzy match"]
        C5["/organizations/:id/financials"]
        C6["/organizations/:id/technology"]
    end

    subgraph INTEL["INTELLIGENCE & SCORING"]
        N1["/icp/run"]
        N2["/business-intent"]
        N3["/crawl"]
        N4["/enrich"]
        N5["/import"]
    end

    subgraph AUTHSEC["AUTH & SECURITY"]
        A1["/auth/login"]
        A2["/auth/logout"]
        A3["/auth/me"]
        A4["SecurityRepository"]
        A1 --> A4
        A2 --> A4
        A3 --> A4
    end

    subgraph DB["05 · POSTGRESQL — via Prisma"]
        D1[("Organization hub<br/>Organization, Sector, Address, Branch")]
        D2[("Profiles & metrics<br/>FinancialMetric, TechnologyMetric, Leadership, Contact")]
        D3[("Scoring & tags<br/>QualificationResult, ScoreHistory, OrganizationTag")]
        D4[("Auth & ops<br/>User, Session, AuditLog")]
    end

    R1["06 · RESPONSE<br/>JSON assembled"]
    CA1["07 · CLIENT CACHE — cache.js<br/>DataCache indexed by sector/state/city/tier"]

    subgraph OUTPUT["08 · OUTPUT"]
        O1["Charts — charts.js (ECharts)"]
        O2["Map — map.js + markers.js (Leaflet)"]
        O3["Pages — sector / company360 / directory / digest"]
        O4["Export — export.js (CSV/Excel/PDF/PNG/Print)"]
    end

    I1 --> F1
    I2 --> F2
    I3 --> F4
    I4 --> F4

    F4 -->|"HTTP · Authorization: Bearer JWT"| G1
    G4 --> C1 & C2 & C3 & C4 & C5 & C6
    G4 --> N1 & N2 & N3 & N4 & N5
    G4 --> A1 & A2 & A3

    C1 & C2 & C5 & C6 --> D1
    C1 --> D2
    C3 --> D1
    C4 --> D1
    N1 --> D3
    N2 --> D3
    N3 & N4 --> D1
    N5 --> D1
    A4 --> D4

    D1 & D2 & D3 & D4 --> R1
    R1 -->|"fetch resolves"| CA1
    CA1 -->|"data:ready"| O1 & O2 & O3 & O4

    classDef input fill:#e2e8f0,stroke:#64748b,color:#0f172a;
    classDef frontend fill:#e0e7ff,stroke:#6366f1,color:#1e1b4b;
    classDef gateway fill:#cffafe,stroke:#0891b2,color:#083344;
    classDef core fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a;
    classDef intel fill:#ede9fe,stroke:#8b5cf6,color:#4c1d95;
    classDef auth fill:#fef3c7,stroke:#d97706,color:#78350f;
    classDef db fill:#d1fae5,stroke:#059669,color:#064e3b;
    classDef output fill:#ffedd5,stroke:#ea580c,color:#7c2d12;

    class I1,I2,I3,I4 input;
    class F1,F2,F3,F4 frontend;
    class G1,G2,G3,G4 gateway;
    class C1,C2,C3,C4,C5,C6 core;
    class N1,N2,N3,N4,N5 intel;
    class A1,A2,A3,A4 auth;
    class D1,D2,D3,D4 db;
    class R1,CA1 frontend;
    class O1,O2,O3,O4 output;
```

---

## 2. Login & session

The JWT proves who a user *claims* to be; the database `Session` row is the actual source of
truth for whether that claim is still valid — logout flips one flag and every future request
is rejected immediately, regardless of what the token itself says.

```mermaid
sequenceDiagram
    participant U as Browser
    participant FE as login.js / authClient.js
    participant API as POST /api/auth/login
    participant SEC as SecurityRepository
    participant DB as PostgreSQL

    U->>FE: enter email + password
    FE->>API: POST {email, password}
    API->>SEC: findUserByEmail()
    SEC->>DB: SELECT * FROM "User"
    DB-->>SEC: user row (or none)
    SEC-->>API: user
    API->>API: bcrypt.compare(password, hash)
    alt missing user, inactive, or bad password
        API-->>FE: 401 generic error
    else valid
        API->>API: sign JWT — sub=userId, jti=sessionId
        API->>DB: INSERT Session(jti, expiresAt, ip)
        API-->>FE: 200 {token, user}
        FE->>U: store token in localStorage
    end

    Note over FE,API: every later request
    FE->>API: any /api/* call — Authorization: Bearer <JWT>
    API->>API: verify JWT signature/expiry
    API->>DB: SELECT Session WHERE jti = ? AND NOT revoked
    alt session revoked/expired
        API-->>FE: 401 → token cleared, redirect #/login
    else session valid
        API-->>FE: 200 + payload
    end
```

**Files:** [backend/src/middleware/auth.ts](backend/src/middleware/auth.ts) ·
[backend/src/modules/auth/](backend/src/modules/auth/) ·
[backend/src/modules/security/security.repository.ts](backend/src/modules/security/security.repository.ts) ·
[assets/js/data/authClient.js](assets/js/data/authClient.js)

---

## 3. Dashboard data fetch & render

The default page load: two parallel API calls build the entire in-memory dataset the rest of
the UI filters and renders against — no per-page refetching after that.

```mermaid
sequenceDiagram
    participant FE as data.js
    participant API as Express API
    participant DB as PostgreSQL
    participant Cache as cache.js (DataCache)
    participant UI as charts.js / map.js / pages

    FE->>API: GET /api/organizations
    FE->>API: GET /api/branches
    par
        API->>DB: query organizations + metrics
        DB-->>API: rows
    and
        API->>DB: query branches + geo
        DB-->>API: rows
    end
    API-->>FE: JSON arrays
    FE->>Cache: build DataCache (index by sector/state/city/tier)
    Cache->>Cache: dedupe-key merge, cross-module resolvers
    Cache-->>UI: emit data:ready
    UI->>UI: charts.js renders 15 ECharts views
    UI->>UI: map.js/markers.js renders clustered pins
    UI->>UI: active page (sector/company360/directory/digest) renders
```

**Files:** [assets/js/data/data.js](assets/js/data/data.js) ·
[assets/js/data/cache.js](assets/js/data/cache.js) ·
[assets/js/charts/charts.js](assets/js/charts/charts.js) ·
[assets/js/map/map.js](assets/js/map/map.js)

---

## 4. ICP scoring run

Manual, admin-triggered batch job (no scheduler) that re-scores every organization against
whatever rules and weights are currently configured in the database.

```mermaid
sequenceDiagram
    participant Admin as icpSettings.js
    participant API as POST /icp/run
    participant SVC as icp.service.ts
    participant DB as PostgreSQL
    participant Tags as tags.service.ts

    Admin->>API: trigger run
    API->>SVC: runIcpScoring()
    SVC->>DB: load organizations + financial/tech metrics + contacts
    SVC->>DB: load active RuleGroup/QualificationRule + ScoreModel/ScoreWeight
    DB-->>SVC: dataset + config
    loop each organization
        SVC->>SVC: evaluate rule groups (ANY/ALL logic)
        SVC->>DB: persist QualificationResult
        SVC->>SVC: weighted percentile-in-sector sum → 0–100 icpScore
        SVC->>SVC: map score → tier (Strategic … Watchlist)
        SVC->>DB: persist ScoreHistory / TierHistory
        SVC->>Tags: assignOpportunityTags(org)
        Tags->>DB: replace OrganizationTag rows
    end
    SVC-->>API: {organizationsScored, qualified, tagsAssigned, tierBreakdown}
    API-->>Admin: 200 run summary

    Note over Admin,DB: later, on any company page
    Admin->>API: GET /organizations/:id/icp
    API->>DB: read score, tier, qualification reasons, tags
    API-->>Admin: rendered by icpBadge.js / icpSection.js / company360.js
```

**Files:** [backend/src/modules/icp/icp.service.ts](backend/src/modules/icp/icp.service.ts) ·
[backend/src/modules/icp/tags.service.ts](backend/src/modules/icp/tags.service.ts) ·
[backend/src/modules/icp/icp.repository.ts](backend/src/modules/icp/icp.repository.ts) ·
[assets/js/components/icpSection.js](assets/js/components/icpSection.js) ·
[assets/js/utils/icpBadge.js](assets/js/utils/icpBadge.js)

---

## 5. Business Intent scoring

Similar shape to ICP scoring but classifies organizations by intent signals, and supports a
dry-run mode before committing changes.

```mermaid
sequenceDiagram
    participant Admin as businessIntent.js
    participant API as POST /business-intent/run
    participant SVC as businessIntent.service.ts
    participant DB as PostgreSQL

    Admin->>API: run (dryRun: true|false)
    API->>SVC: runBusinessIntentScoring()
    SVC->>DB: load organizations + signal sources
    SVC->>SVC: score via businessIntent.scoring.ts
    SVC->>SVC: prioritize via businessIntent.priority.ts
    alt dry run
        SVC-->>API: preview diff only, no writes
    else real run
        SVC->>DB: write BusinessIntentScoreHistory
        SVC->>DB: write BusinessIntentRemovalLog for dropped orgs
    end
    SVC-->>API: run summary
    API-->>Admin: rendered as score movers + removal audit log
```

**Files:** [backend/src/modules/businessIntent/businessIntent.service.ts](backend/src/modules/businessIntent/businessIntent.service.ts) ·
[assets/js/pages/businessIntent.js](assets/js/pages/businessIntent.js)

---

## 6. Search

```mermaid
flowchart LR
    A["User types in search box"] --> B["GET /api/search?q=..."]
    B --> C["search.routes.ts<br/>raw Prisma $queryRaw"]
    C --> D[("PostgreSQL<br/>pg_trgm similarity() on Organization.name")]
    D --> E["ranked matches"] --> F["dropdown / directory results"]
```

**Files:** [backend/src/modules/search/](backend/src/modules/search/)

---

## 7. Background jobs — crawler, enrichment, import

These three don't run on the request/response cycle above; they're longer-running jobs
kicked off from an admin action and polled or checked later.

```mermaid
flowchart LR
    subgraph Crawl["Crawler"]
        C1["POST /crawl {orgId, url}"] --> C2["crawler.service.ts<br/>queues CrawlJob"] --> C3[("CrawlSource / CrawlJob")]
    end
    subgraph Enrich["Enrichment"]
        E1["POST /enrich {orgId, docId}"] --> E2["enrichment.service.ts<br/>LLM extraction"] --> E3[("ExtractedEntity → EntityResolution")]
    end
    subgraph Import["Bulk Import"]
        I1["POST /import (Excel upload)"] --> I2["importJob.service.ts<br/>excelReader → mapping → dedupe"] --> I3[("Organization rows upserted")]
    end
```

**Files:** [backend/src/modules/crawler/](backend/src/modules/crawler/) ·
[backend/src/modules/enrichment/](backend/src/modules/enrichment/) ·
[backend/src/modules/import/](backend/src/modules/import/)

---

## 8. Module reference

| Route base | Module | Service → Repository | Key tables touched |
|---|---|---|---|
| `/auth` | auth | `auth.routes.ts` → `SecurityRepository` | User, Session |
| `/organizations` | organizations | `OrganizationsRepository` + `organizations.mapper.ts` | Organization, Sector, Address |
| `/branches` | branches | `BranchesRepository` | Branch, City, State |
| `/organizations/:id/financials` | financials | `FinancialsRepository` | FinancialMetric, FinancialProfile |
| `/organizations/:id/technology` | technology | `TechnologyRepository` | TechnologyMetric, TechnologyProfile |
| `/dashboard` | dashboard | `DashboardRepository` | aggregates across Organization |
| `/search` | search | raw `$queryRaw` (pg_trgm) | Organization |
| `/icp` | icp | `icp.service.ts` + `tags.service.ts` → `icp.repository.ts` | QualificationResult, ScoreHistory, OrganizationTag |
| `/business-intent` | businessIntent | `businessIntent.service.ts` → `businessIntent.repository.ts` | BusinessIntentScoreHistory, BusinessIntentRemovalLog |
| `/crawl` | crawler | `crawler.service.ts` → `crawler.repository.ts` | CrawlSource, CrawlJob |
| `/enrich` | enrichment | `enrichment.service.ts` → `enrichment.repository.ts` | EnrichmentJob, ExtractedEntity |
| `/import` | import | `importJob.service.ts` → `excelReader.ts`/`mapping.ts`/`dedupe.ts` | Organization (bulk upsert) |

## 9. Frontend routing

| Route | Page file | Shows |
|---|---|---|
| `/` | `home.js` | Landing page (persistent) |
| `/login` | `login.js` | Login overlay |
| `/sector/:key` | `sector.js` | Sector KPIs, maturity, top companies |
| `/company/:key` | `company360.js` | Single-company profile: financials, leadership, ICP fit, tech stack |
| `/directory` | `companyDirectory.js` | Full exportable company table |
| `/digest` | `digest.js` | Weekly digest: score movers, accounts to action |
| `/settings/icp` | `icpSettings.js` | Edit ICP rule thresholds (GET/PATCH `/api/icp/rules`) |
| `/settings/business-intent` | `businessIntent.js` | Trigger BI scoring runs, view removal log |

---

## Keeping this in sync

Update the relevant section (and its Mermaid diagram) whenever you: add/rename a route, add a
Prisma model, change the auth flow, or change what a scoring run computes. The diagrams are
plain text — edit the node labels and arrows directly, no diagram tool required.
