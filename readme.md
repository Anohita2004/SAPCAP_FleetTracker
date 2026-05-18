# SAP CAP Fleet Tracker

A full-stack SAP CAP fleet tracking application where a Fleet Admin signs in with SAP BTP/XSUAA, creates app-level driver accounts, and visualizes driver trip/location data. Drivers do not need BTP accounts. They log in with app credentials, grant browser/mobile location permission, and send live location updates to the backend.

## Overview

This project solves a common fleet-management scenario:

- Fleet Admins are organization users with SAP BTP accounts.
- Drivers are field users without SAP BTP accounts.
- Admins create drivers and assign temporary passwords.
- Drivers log in through the app, start trips, and share live location.
- Admins can review drivers, trips, and recorded route points.

## Tech Stack

- SAP CAP Node.js
- SAP HANA Cloud / HDI Container for production
- SQLite for local development
- SAPUI5 frontend
- SAP Approuter
- XSUAA for Fleet Admin authentication
- App-managed driver sessions for driver login
- Leaflet / OpenStreetMap for map visualization

## User Roles

### Fleet Admin

Fleet Admins authenticate through SAP BTP/XSUAA.

They can:

- Create driver accounts
- Assign temporary driver passwords
- View assigned drivers
- View trips and recorded locations
- Review route history

### Driver

Drivers do not need SAP BTP accounts.

They can:

- Log in with app-level email/password
- Start an active trip
- Grant browser/mobile location permission
- Send location points while tracking
- Stop the active trip

## Authentication Model

This app intentionally uses two authentication flows:

### Admin Authentication

Admin routes use SAP BTP/XSUAA.

Protected backend route prefix:

```text
/tracker
