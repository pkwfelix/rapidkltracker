# RapidTracker

Real-time bus and train arrival tracker for RapidKL services in Malaysia, built on top of the [Malaysia Open Data](https://data.gov.my) GTFS feeds.

## Vibecode Disclaimer

This project is an experiment of multiple AI IDE on the market with their respective models.

- Windsurf (Claude Sonnet 4.6)
- Kiro (Auto)
- Zed (Claude Sonnet 4.6)

## Overview

RapidTracker consists of two parts running in parallel:

- **Node server** (`server/`) — polls the GTFS Realtime API every 30 seconds, decodes protobuf, caches vehicle positions as JSON, and pushes update events to the browser over SSE
- **Astro frontend** (`src/`) — subscribes to SSE for instant updates, cross-references vehicle positions against GTFS Static schedule data, and computes per-stop ETA estimates in the browser

## Tech Stack

| Layer | Technology |
| :---- | :--------- |
| Frontend framework | [Astro 6](https://astro.build) with [React](https://react.dev) islands |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + [MYDS design system](https://design.digital.gov.my) |
| Backend server | [Express 5](https://expressjs.com) (Node.js ESM) |
| GTFS Realtime decode | [protobufjs](https://protobufjs.github.io/protobuf.js/) |
| GTFS Static parse | [JSZip](https://stuk.github.io/jszip/) (ZIP download + CSV parse in-browser) |
| Client-side cache | [idb](https://github.com/jakearchibald/idb) (IndexedDB wrapper) |
| Dev tooling | [concurrently](https://github.com/open-cli-tools/concurrently) |
| Testing | [Vitest](https://vitest.dev) + [Testing Library](https://testing-library.com) |

## Prerequisites

- Node.js >= 22.12.0

## Getting Started

```sh
# Install dependencies
npm install

# Start both the Node server and Astro dev server together
npm run dev
```

This starts:
- **Node server** on `http://localhost:3001`
- **Astro dev** on `http://localhost:4321`

## Commands

| Command | Action |
| :------ | :----- |
| `npm run dev` | Start Node server + Astro dev together (recommended) |
| `npm run server` | Start the Node server only |
| `npm run build` | Build the Astro frontend to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run the Vitest unit test suite |

## Environment Variables

| Variable | Where | Default | Description |
| :------- | :---- | :------ | :---------- |
| `ALLOWED_ORIGIN` | server | `http://localhost:4321` | Allowed CORS origin. Set to your frontend URL in production. |
| `PUBLIC_SERVER_BASE` | client (Astro) | `http://localhost:3001` | Base URL the browser uses to reach the Node server. Prefix with `PUBLIC_` so Astro exposes it to client-side code. |

Copy `.env.example` to `.env` and fill in both variables before deploying to production.

## Project Structure

```text
/
├── public/
│   ├── favicon.ico
│   └── favicon.svg
│
├── shared/
│   └── types.ts                   # Shared TypeScript types (VehiclePosition) used by
│                                  # both server and client to avoid duplication
│
├── server/
│   ├── index.ts                   # Express entry-point — wires CORS, rate-limit, routes
│   ├── poller.ts                  # Polls GTFS-RT feeds, decodes protobuf, writes cache,
│   │                              # broadcasts SSE events to connected clients
│   ├── cache.ts                   # Atomic JSON file cache (write to .tmp then rename)
│   ├── routes.ts                  # REST + SSE route handlers with rate limiting
│   ├── config.ts                  # Server constants + env var reading
│   ├── types.ts                   # Server-side types (re-exports from shared/)
│   ├── gtfs-realtime.proto        # Protobuf schema
│   └── cache/                     # Ephemeral JSON cache (gitignored)
│       ├── bus.json
│       └── train.json
│
├── vitest.config.ts               # Vitest config — jsdom environment, setup files
│
└── src/
    ├── components/
    │   ├── TrackerPanel.tsx        # Bus or train tracker island (variant prop)
    │   ├── StationInput.tsx        # Autocomplete stop search input
    │   ├── StationCard.tsx         # Per-stop arrivals card
    │   ├── RefreshSpinner.tsx      # Countdown timer — emits DOM events, renders nothing
    │   └── NavSpinner.tsx          # Header spinner — listens to DOM events, renders ring
    ├── hooks/
    │   └── useTracker.ts           # Core tracker state hook — GTFS loading, SSE
    │                               # subscription, ETA computation
    ├── lib/
    │   ├── gtfs-static.ts          # Fetches + parses GTFS Static ZIP; two-level cache
    │   │                           # (in-memory L1 + IndexedDB L2 with 6 h TTL)
    │   ├── gtfs-realtime.ts        # Fetches vehicle positions; SSE subscription helper
    │   ├── eta.ts                  # Cross-references schedule + realtime to compute ETAs
    │   └── config.ts               # Client-side constants
    ├── lib/__tests__/
    │   ├── exploration.test.ts     # Tests that verify bug fixes are applied
    │   ├── preservation.test.ts    # Tests that verify correct behaviour is unchanged
    │   └── setup.ts                # Vitest + Testing Library bootstrap
    ├── pages/
    │   └── index.astro             # Main page layout
    ├── styles/
    │   └── global.css              # MYDS CSS variable wrappers + component utility classes
    └── types/
        └── index.ts                # Frontend-only TypeScript interfaces (WatchedStation)
```

## Architecture

### Data Flow

```
api.data.gov.my (GTFS-RT protobuf)
        │
        ▼  every 30 s (setInterval)
  server/poller.ts
  (fetch → decode protobuf → filter by Malaysia bbox)
        │
        ├─► writes atomically ──► server/cache/{bus,train}.json
        │                         (.tmp file + fs.rename for crash safety)
        │
        └─► SSE broadcast ──────► browser EventSource (instant push)
                                          │
                  ┌───────────────────────┘
                  │  on SSE message OR 10 s fallback interval
                  ▼
         src/hooks/useTracker.ts
         (fetchPositions → computeArrivals)
                  │
                  ├─► in-memory cache (L1)
                  ├─► IndexedDB cache  (L2, 6 h TTL)
                  └─► network fetch    (L3, on cache miss)
                  │
                  ▼  GTFS Static ZIP
         src/lib/gtfs-static.ts
         (stops, trips, routes, stop_times, frequencies)
                  │
                  ▼
         src/lib/eta.ts
         (schedule × realtime → per-stop ArrivalEstimate[])
                  │
                  ▼
         StationCard (rendered ETAs)
```

### Server API

| Endpoint | Description |
| :------- | :---------- |
| `GET /api/vehicles/bus` | Cached bus vehicle positions (rapid-bus-kl + rapid-bus-mrtfeeder) |
| `GET /api/vehicles/train` | Cached train vehicle positions (KTMB) |
| `GET /api/events/bus` | SSE stream — emits `{ updatedAt }` whenever the bus cache is refreshed |
| `GET /api/events/train` | SSE stream — emits `{ updatedAt }` whenever the train cache is refreshed |
| `GET /api/health` | Cache age status for both groups |

All endpoints under `/api` are rate-limited to **60 requests per minute** per IP. SSE endpoints (`/api/events/*`) are exempt from the rate limit so reconnects cannot lock out the data stream. Each SSE connection receives a comment-only heartbeat frame every 15 seconds to keep the TCP connection alive through NAT/proxy timeouts and detect dead clients early.

Vehicle response shape:

```json
{
  "updatedAt": 1234567890000,
  "positions": [
    {
      "vehicleId": "...",
      "tripId": "...",
      "routeId": "...",
      "latitude": 3.1,
      "longitude": 101.6,
      "currentStopSequence": 5,
      "currentStopId": "RB01",
      "timestamp": 1234567890,
      "agency": "rapid-bus-kl"
    }
  ]
}
```

### GTFS Static Cache Layers

GTFS Static ZIPs can be several megabytes and are slow to re-parse. The client uses a two-level cache:

| Layer | Storage | TTL | Notes |
| :---- | :------ | :-- | :---- |
| L1 — memory | JS `Map` | Page lifecycle | Instant; survives hot-reloads in dev |
| L2 — IndexedDB | Browser IDB | 6 hours | Survives page reloads; stale entries are pruned once per session |
| L3 — network | `api.data.gov.my` | — | Only reached on cold load or after TTL expiry |

Stop selections are persisted to `localStorage`. Corrupt entries are automatically cleared and re-initialised on the next load.

### Spinner Architecture

The refresh timer is decoupled from the UI via custom DOM events:

- `RefreshSpinner` — manages the countdown `setInterval`, fires `window.dispatchEvent("rapidtracker:tick", { secondsLeft, refreshing })`, renders `null`
- `NavSpinner` — listens for `rapidtracker:tick`, renders the circular SVG progress ring in the header

This means the countdown ring lives in the sticky header while the trigger logic lives inside each tracker component.

### CSS Architecture

MYDS CSS variables store space-separated RGB channels (e.g. `--bg-white: 255 255 255`) and cannot be used directly as CSS color values. `global.css` wraps every token used by the app into `--c-*` custom properties:

```css
--c-bg:          rgb(var(--bg-white));
--c-txt-primary: rgb(var(--txt-primary));
--c-border:      rgb(var(--otl-gray-200));
/* etc. */
```

All components use only `--c-*` variables, never raw MYDS tokens.

### Server Hardening

| Concern | Implementation |
| :------ | :------------- |
| CORS | Restricted to `ALLOWED_ORIGIN` (env var); defaults to `http://localhost:4321` |
| Rate limiting | 60 req/min per IP via `express-rate-limit`; SSE routes exempted |
| SSE connection leak | 15 s heartbeat per connection; dead clients removed immediately on write error |
| Cache file corruption | Atomic write — JSON serialised to `.tmp`, then `fs.rename` to target |
| Bogus GPS data | Vehicles outside Malaysia's bounding box (lat 0.85–7.4 °N, lon 99.6–119.3 °E) are discarded at poll time |

## GTFS Data Sources

| Feed | Provider | Type |
| :--- | :------- | :--- |
| `rapid-bus-kl` | Prasarana | Static + Realtime |
| `rapid-bus-mrtfeeder` | Prasarana | Static + Realtime |
| `rapid-rail-kl` | Prasarana | Static only (no RT feed) |
| `ktmb` | KTMB | Static + Realtime |

## Testing

```sh
npm test
```

Vitest runs in `jsdom` mode. Two test suites are included:

- **`exploration.test.ts`** — regression tests that verify each bug fix is correctly applied (overnight ETA, NavSpinner progress, RefreshSpinner Strict Mode, localStorage isolation, calendar exception types)
- **`preservation.test.ts`** — baseline tests that verify correct existing behaviour is unchanged across all fixes

## Known Limitations

- `rapid-rail-kl` (LRT/MRT/Monorail) has no GTFS Realtime vehicle position feed — arrivals are schedule-based only
- The client reads `PUBLIC_SERVER_BASE` for the server URL; set this env var before building for production (see [Environment Variables](#environment-variables))

## License

MIT
