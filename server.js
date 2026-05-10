const cds = require("@sap/cds");
const express = require('express');
const { SELECT, INSERT, UPDATE } = cds.ql;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const JWT_SECRET = process.env.DRIVER_JWT_SECRET || 'change_this_secret';

module.exports = cds.server;

cds.on("bootstrap", (app) => {
  // JSON parser
  app.use(express.json());

  // JWT middleware for driver tokens (non-XSUAA)
  app.use(async (req, res, next) => {
    try {
      const auth = req.headers && req.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        const token = auth.split(' ')[1];
        try {
          const payload = jwt.verify(token, JWT_SECRET);
          req.user = {
            id: payload.id,
            driverId: payload.driverId,
            roles: payload.roles || [],
            is: (role) => (payload.roles || []).includes(role)
          };
        } catch (e) {
          // invalid token: let other middlewares (e.g., xsuaa) try
        }
      }
    } catch (e) {
      // ignore
    }
    next();
  });

  // Register driver (email + password)
  app.post('/drivers/register', async (req, res, next) => {
    try {
      const db = await cds.connect.to('db');
      const { name, email, password, phone, adminId } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'email and password required' });
      const normalized = normalizeEmail(email);
      const existing = await db.run(SELECT.one.from('tracker.Drivers').where({ email: normalized }));
      if (existing) return res.status(409).json({ error: 'Driver already exists' });
      const passwordHash = await bcrypt.hash(password, 10);
      await db.run(INSERT.into('tracker.Drivers').entries({ name, email: normalized, passwordHash, phone, admin_ID: adminId }));
      const driver = await db.run(SELECT.one.from('tracker.Drivers').where({ email: normalized }));
      const token = jwt.sign({ id: normalized, roles: ['Driver'], driverId: driver.ID }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, driver: { ID: driver.ID, name: driver.name, email: driver.email, phone: driver.phone, status: driver.status } });
    } catch (err) { next(err); }
  });

  // Login driver
  app.post('/drivers/login', async (req, res, next) => {
    try {
      const db = await cds.connect.to('db');
      const { email, password } = req.body || {};
      if (!email || !password) return res.status(400).json({ error: 'email and password required' });
      const normalized = normalizeEmail(email);
      const driver = await db.run(SELECT.one.from('tracker.Drivers').where({ email: normalized }));
      if (!driver || !driver.passwordHash) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, driver.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign({ id: normalized, roles: ['Driver'], driverId: driver.ID }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, driver: { ID: driver.ID, name: driver.name, email: driver.email, phone: driver.phone, status: driver.status } });
    } catch (err) { next(err); }
  });

  // Driver-friendly endpoints (mobile clients using JWT)
  app.post('/drivers/start', async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) return res.status(401).json({ error: 'Unauthorized' });
      const db = await cds.connect.to('db');
      const { title } = req.body || {};
      const now = new Date().toISOString();
      await db.run(INSERT.into('tracker.Trips').entries({ title: title || ('Trip ' + now), driver_ID: req.user.driverId, startedAt: now, status: 'ACTIVE' }));
      const trip = await db.run(SELECT.one.from('tracker.Trips').where({ driver_ID: req.user.driverId, status: 'ACTIVE' }).orderBy('startedAt desc'));
      res.json(trip);
    } catch (err) { next(err); }
  });

  app.post('/drivers/stop', async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) return res.status(401).json({ error: 'Unauthorized' });
      const db = await cds.connect.to('db');
      const { tripId } = req.body || {};
      const now = new Date().toISOString();
      const trip = await db.run(SELECT.one.from('tracker.Trips').where({ ID: tripId }));
      if (!trip || trip.driver_ID !== req.user.driverId) return res.status(403).json({ error: 'Forbidden' });
      await db.run(UPDATE('tracker.Trips').set({ endedAt: now, status: 'COMPLETED' }).where({ ID: tripId }));
      const updated = await db.run(SELECT.one.from('tracker.Trips').where({ ID: tripId }));
      res.json(updated);
    } catch (err) { next(err); }
  });

  app.post('/drivers/recordLocation', async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) return res.status(401).json({ error: 'Unauthorized' });
      const db = await cds.connect.to('db');
      const payload = req.body || {};
      const point = await db.run(INSERT.into('tracker.LocationPoints').entries({
        trip_ID: payload.tripId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        accuracy: payload.accuracy,
        altitude: payload.altitude,
        speed: payload.speed,
        heading: payload.heading,
        recordedAt: payload.recordedAt,
        source: payload.source || 'mobile'
      }));
      res.json(point);
    } catch (err) { next(err); }
  });

  app.get('/drivers/profile', async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) return res.status(401).json({ error: 'Unauthorized' });
      const db = await cds.connect.to('db');
      const driver = await db.run(SELECT.one.from('tracker.Drivers').where({ ID: req.user.driverId }));
      if (driver) delete driver.passwordHash;
      res.json(driver);
    } catch (err) { next(err); }
  });

  app.get('/drivers/activeTrip', async (req, res, next) => {
    try {
      if (!req.user || !req.user.driverId) return res.status(401).json({ error: 'Unauthorized' });
      const db = await cds.connect.to('db');
      const trip = await db.run(SELECT.one.from('tracker.Trips').where({ driver_ID: req.user.driverId, status: 'ACTIVE' }));
      res.json(trip);
    } catch (err) { next(err); }
  });

  // existing authenticated route
  app.get("/tracker/path/:tripId", async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const db = await cds.connect.to("db");
      const trip = await db.run(
        SELECT.one.from("tracker.Trips").where({ ID: req.params.tripId })
      );

      if (!trip) return res.status(404).json({ error: "Trip not found" });

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

if (require.main === module) cds.server();