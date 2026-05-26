# Location Tracker — SAP CAP full-stack sample

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](##)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A polished, full‑stack fleet location tracker built with SAP Cloud Application Programming model (CAP), a SAPUI5 frontend and flexible persistence (SQLite for local, SAP HANA for production). It demonstrates multi-role auth (XSUAA for admins + app-managed driver login), trip/session management, and live location capture.

## Table of contents

- [Highlights](#highlights)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Development workflow](#development-workflow)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License & contact](#license--contact)

## Highlights

- Dual authentication model: XSUAA for Fleet Admins and lightweight app-managed accounts for Drivers.
- Live trip/session tracking with recorded LocationPoints for route history.
- SAPUI5 frontend optimized for desktop and mobile browsers.
- Local development on SQLite; production-ready HANA deployment instructions included.

## Screenshots

- Sample UI (Dashboard)

![Dashboard](docs/screenshots/truck.svg)

## Tech stack

- Backend: `@sap/cds` (Node.js)
- Frontend: SAPUI5 (app/locationtracker/webapp)
- Persistence: SQLite (dev) and SAP HANA (production)
- Packaging: MTA (`mbt`), Cloud Foundry deploy helpers

See the project `package.json` for available scripts: [package.json](package.json)

## Quick start

Prerequisites
- Node.js 16+ and `npm`
- (Optional) `cds` tooling: install with `npm i -g @sap/cds` for CAP development commands

Install dependencies

```bash
npm install
```

Local development (hot reload)

1. Initialize the local SQLite DB (this project uses a predeploy helper):

```bash
npm run predev
```

2. Start the application in watch mode (backend + UI):

```bash
npm run dev
```

This uses `cds watch` to reload services and UI changes automatically.

Run the production server locally

```bash
npm start
```

Common scripts

- `npm run build` — CDS build
- `npm run build:mta` — Build MTA archive with `mbt`
- `npm run deploy` — Deploy artifacts to HANA (cds deploy)
- `npm run deploy:btp` — Deploy the generated MTA archive to Cloud Foundry

## Development workflow

- Edit domain model under `srv` / `db/schema.cds`.
- Implement service logic in `srv/tracker_service.js` and `srv/` server files.
- UI components live in `app/locationtracker/webapp` (views, controllers, models).
- Generated artifacts appear under `gen/` for DB artifacts when building/deploying.

## Project structure

- `app/` — SAPUI5 frontend and app modules
- `srv/` — CAP services and custom logic
- `db/` — local SQLite files and CDS model for persistence
- `mta_archives/` — generated MTA archive for CF deployment
- `gen/` — generated database artifacts

## Configuration

- CAP configuration is in `package.json` `cds` section (service bindings, requires).
- For local dev the `auth` provider is mocked (see `package.json` -> `cds.requires.auth` -> `development`).
- For production configure XSUAA credentials and HANA connection via environment variables / binding in BTP.

Secrets & environment
- Admin XSUAA and HANA credentials should be provided by the platform (Cloud Foundry service bindings) or via secure environment variables for non-cloud deployments.

## Deployment

Typical production flow

```bash
npm run build
npm run build:mta
# then deploy the MTA archive to Cloud Foundry
npm run deploy:btp
```

Alternatively, use `cds deploy --to hana` when you have direct HANA credentials configured.

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Open an issue describing the change or bug.
2. Create a feature branch and make small, focused commits.
3. Submit pull requests with a clear description and screenshots if applicable.

## License & contact

This repository is provided under the MIT license. See `LICENSE` for details.

If you need help, open an issue or contact the maintainer.

---

If you'd like, I can:

- add screenshots/examples to the README using the app's images,
- include a quick troubleshooting section for common local issues, or
- create a short `README-DEV.md` with exact debugging steps.

Updated file: [readme.md](readme.md)
