# RapidTracker

Real-time bus and train arrival tracker for RapidKL services in Malaysia, built on top of the [Malaysia Open Data](https://data.gov.my) GTFS feeds.

## Overview

RapidTracker consists of two parts running in parallel:

- **Node server** (`server/`) — polls the GTFS Realtime API every 30 seconds, decodes protobuf, and caches vehicle positions as JSON
- **Astro frontend** (`src/`) — fetches the cached JSON from the local server, cross-references it against GTFS Static schedule data, and computes per-stop ETA estimates in the browser

## Tech Stack

| Layer | Technology |
| :---- | :--------- |
| Frontend framework | [Astro 6](https://astro.build) with [React](https://react.dev) islands |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) + [MYDS design system](https://design.digital.gov.my) |
| Backend server | [Express 5](https://expressjs.com) (Node.js ESM) |
| GTFS Realtime decode | [protobufjs](https://protobufjs.github.io/protobuf.js/) |
| GTFS Static parse | [JSZip](https://stuk.github.io/jszip/) (ZIP download + CSV parse in-browser) |
| Dev tooling | [concurrently](https://github.com/open-cli-tools/concurrently) |

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

## Project Structure

```text
/
├── public/
│   ├── favicon.ico
│   ├── favicon.svg
│   └── gtfs-realtime.proto        # Protobuf schema (served statically, unused by browser)
│
├── server/
│   ├── index.js                   # Express server — polls GTFS-RT, writes cache
│   └── cache/                     # Ephemeral JSON cache (gitignored)
│       ├── bus.json
│       └── train.json
│
└── src/
    ├── components/
    │   ├── BusTracker.tsx          # Bus stop tracker island
    │   ├── TrainTracker.tsx        # Train station tracker island
    │   ├── StationInput.tsx        # Autocomplete stop search input
    │   ├── StationCard.tsx         # Per-stop arrivals card
    │   ├── RefreshSpinner.tsx      # Countdown timer — emits DOM events, renders nothing
    │   └── NavSpinner.tsx          # Header spinner — listens to DOM events, renders ring
    ├── lib/
    │   ├── gtfs-static.ts          # Fetches + parses GTFS Static ZIP (stops, trips, routes, schedules)
    │   ├── gtfs-realtime.ts        # Fetches vehicle positions from local server
    │   └── eta.ts                  # Cross-references schedule + realtime to compute ETAs
    ├── pages/
    │   └── index.astro             # Main page layout
    ├── styles/
    │   └── global.css              # MYDS CSS variable wrappers + component utility classes
    └── types/
        └── index.ts                # Shared TypeScript interfaces
```

## Architecture

### Data Flow

```
api.data.gov.my (GTFS-RT protobuf)
        │
        ▼  every 30s
  server/index.js
  (decode protobuf → JSON)
        │
        ▼  writes
  server/cache/{bus,train}.json
        │
        ▼  GET /api/vehicles/{bus,train}
  Browser (React islands)
  (fetch JSON + parse GTFS Static ZIP)
        │
        ▼
  eta.ts → per-stop arrival estimates
        │
        ▼
  StationCard (rendered ETAs)
```

### Server API

| Endpoint | Description |
| :------- | :---------- |
| `GET /api/vehicles/bus` | Cached bus vehicle positions (rapid-bus-kl + rapid-bus-mrtfeeder) |
| `GET /api/vehicles/train` | Cached train vehicle positions (KTMB) |
| `GET /api/health` | Cache age status for both groups |

Response shape:
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

## GTFS Data Sources

| Feed | Provider | Type |
| :--- | :------- | :--- |
| `rapid-bus-kl` | Prasarana | Static + Realtime |
| `rapid-bus-mrtfeeder` | Prasarana | Static + Realtime |
| `rapid-rail-kl` | Prasarana | Static only (no RT feed) |
| `ktmb` | KTMB | Static + Realtime |

GTFS Static ZIPs are fetched directly in the browser from `api.data.gov.my` on first load and cached in memory for the session. Stop selections are persisted to `localStorage`.

## Known Limitations

- `rapid-rail-kl` (LRT/MRT/Monorail) has no GTFS Realtime vehicle position feed — arrivals are schedule-based only
- GTFS Static data is re-fetched on every page reload (no persistent cache beyond `localStorage` stop list)
- `SERVER_BASE` is hardcoded to `http://localhost:3001` — needs an environment variable for production deployment

## License

MIT
