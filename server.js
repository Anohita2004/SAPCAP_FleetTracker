const cds = require("@sap/cds");
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { SELECT, INSERT, UPDATE } = cds.ql;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const createDriverToken = () => crypto.randomBytes(32).toString("hex");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

module.exports = cds.server;

cds.on("bootstrap", (app) => {
  app.use(express.json());

  app.use(async (req, res, next) => {
    try {
      const auth = req.headers && req.headers.authorization;

      if (auth && auth.startsWith("Bearer ")) {
        const token = auth.split(" ")[1];
        const db = await cds.connect.to("db");

        const session = await db.run(
          SELECT.one.from("tracker.DriverSessions")
            .where({ tokenHash: hashToken(token) })
        );

        if (session && new Date(session.expiresAt).getTime() > Date.now()) {
          const driver = await db.run(
            SELECT.one.from("tracker.Drivers").where({ ID: session.driver_ID })
          );

          if (driver && driver.status === "ACTIVE") {
            req.user = {
              id: driver.email,
              driverId: driver.ID,
              roles: ["Driver"],
              is: (role) => role === "Driver"
            };
          }
        }
      }
    } catch (error) {
      // Continue to CAP/XSUAA auth.
    }

    next();
  });

  app.post("/drivers/login", async (req, res, next) => {
    try {
      const db = await cds.connect.to("db");
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: "email and password required" });
      }

      const normalized = normalizeEmail(email);
      const driver = await db.run(
        SELECT.one.from("tracker.Drivers").where({ email: normalized })
      );

      if (!driver || !driver.passwordHash || driver.status !== "ACTIVE") {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const ok = await bcrypt.compare(password, driver.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      const token = createDriverToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      await db.run(
        INSERT.into("tracker.DriverSessions").entries({
          ID: cds.utils.uuid(),
          driver_ID: driver.ID,
          tokenHash: hashToken(token),
          expiresAt
        })
      );

      res.json({
        token,
        driver: {
          ID: driver.ID,
          name: driver.name,
          email: driver.email,
          phone: driver.phone,
          status: driver.status
        }
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/drivers/start", async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await cds.connect.to("db");
      const { title } = req.body || {};

      const activeTrip = await db.run(
        SELECT.one.from("tracker.Trips")
          .where({ driver_ID: req.user.driverId, status: "ACTIVE" })
          .orderBy("startedAt desc")
      );

      if (activeTrip) {
        return res.json(activeTrip);
      }

      const now = new Date().toISOString();

      const entry = {
        ID: cds.utils.uuid(),
        title: title || "Trip " + now,
        driver_ID: req.user.driverId,
        startedAt: now,
        status: "ACTIVE"
      };

      await db.run(INSERT.into("tracker.Trips").entries(entry));
      res.json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.post("/drivers/stop", async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await cds.connect.to("db");
      const { tripId } = req.body || {};

      if (!tripId) {
        return res.status(400).json({ error: "tripId is required" });
      }

      const trip = await db.run(
        SELECT.one.from("tracker.Trips").where({ ID: tripId })
      );

      if (!trip || trip.driver_ID !== req.user.driverId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (trip.status !== "ACTIVE") {
        return res.status(400).json({ error: "Trip is not active" });
      }

      const now = new Date().toISOString();

      await db.run(
        UPDATE("tracker.Trips")
          .set({ endedAt: now, status: "COMPLETED" })
          .where({ ID: tripId })
      );

      const updated = await db.run(
        SELECT.one.from("tracker.Trips").where({ ID: tripId })
      );

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post("/drivers/recordLocation", async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await cds.connect.to("db");
      const payload = req.body || {};

      if (!payload.tripId) {
        return res.status(400).json({ error: "tripId is required" });
      }

      if (payload.latitude == null || payload.longitude == null) {
        return res.status(400).json({ error: "latitude and longitude are required" });
      }

      const latitude = Number(payload.latitude);
      const longitude = Number(payload.longitude);

      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        return res.status(400).json({ error: "latitude must be between -90 and 90" });
      }

      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        return res.status(400).json({ error: "longitude must be between -180 and 180" });
      }

      const trip = await db.run(
        SELECT.one.from("tracker.Trips").where({ ID: payload.tripId })
      );

      if (!trip || trip.driver_ID !== req.user.driverId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (trip.status !== "ACTIVE") {
        return res.status(400).json({ error: "Trip is not active" });
      }

      const entry = {
        ID: cds.utils.uuid(),
        trip_ID: payload.tripId,
        latitude,
        longitude,
        accuracy: payload.accuracy ?? null,
        altitude: payload.altitude ?? null,
        speed: payload.speed ?? null,
        heading: payload.heading ?? null,
        recordedAt: payload.recordedAt || new Date().toISOString(),
        source: payload.source || "mobile"
      };

      await db.run(INSERT.into("tracker.LocationPoints").entries(entry));
      res.json(entry);
    } catch (err) {
      next(err);
    }
  });

  app.get("/drivers/profile", async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await cds.connect.to("db");
      const driver = await db.run(
        SELECT.one.from("tracker.Drivers").where({ ID: req.user.driverId })
      );

      if (driver) {
        delete driver.passwordHash;
      }

      res.json(driver);
    } catch (err) {
      next(err);
    }
  });

  app.get("/drivers/activeTrip", async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await cds.connect.to("db");
      const trip = await db.run(
        SELECT.one.from("tracker.Trips")
          .where({ driver_ID: req.user.driverId, status: "ACTIVE" })
          .orderBy("startedAt desc")
      );

      res.json(trip || null);
    } catch (err) {
      next(err);
    }
  });

  app.get("/tracker/path/:tripId", async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const db = await cds.connect.to("db");
      const trip = await db.run(
        SELECT.one.from("tracker.Trips").where({ ID: req.params.tripId })
      );

      if (!trip) {
        return res.status(404).json({ error: "Trip not found" });
      }

      if (req.user.is && req.user.is("FleetAdmin")) {
        const admin = await db.run(
          SELECT.one.from("tracker.Admins").where({ email: normalizeEmail(req.user.id) })
        );

        const driver = await db.run(
          SELECT.one.from("tracker.Drivers").where({ ID: trip.driver_ID })
        );

        if (!admin || !driver || driver.admin_ID !== admin.ID) {
          return res.status(403).json({ error: "Forbidden" });
        }
      } else {
        const driver = await db.run(
          SELECT.one.from("tracker.Drivers").where({ email: normalizeEmail(req.user.id) })
        );

        if (!driver || trip.driver_ID !== driver.ID) {
          return res.status(403).json({ error: "Forbidden" });
        }
      }

      const points = await db.run(
        SELECT.from("tracker.LocationPoints")
          .where({ trip_ID: req.params.tripId })
          .orderBy("recordedAt asc")
      );

      res.json({ value: points });
    } catch (error) {
      next(error);
    }
  });
});

if (require.main === module) {
  cds.server();
}