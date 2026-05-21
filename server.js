const cds = require("@sap/cds");
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { SELECT, INSERT, UPDATE } = cds.ql;
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

// In-memory admin socket registry: adminId -> Set(ws)
const adminSockets = new Map();

function broadcastToAdmin(adminId, payload) {
  const set = adminSockets.get(adminId);
  if (!set) return;
  const msg = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const createDriverToken = () => crypto.randomBytes(32).toString("hex");

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

module.exports = cds.server;
module.exports.broadcastToAdmin = broadcastToAdmin;

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

      // Best-effort broadcast to admin dashboards associated with this driver
      try {
        const driver = await db.run(SELECT.one.from("tracker.Drivers").where({ ID: trip.driver_ID }));
        if (driver && driver.admin_ID) {
          broadcastToAdmin(driver.admin_ID, {
            type: "location",
            driverId: driver.ID,
            tripId: entry.trip_ID,
            latitude: entry.latitude,
            longitude: entry.longitude,
            recordedAt: entry.recordedAt,
            speed: entry.speed,
            heading: entry.heading
          });
        }
      } catch (e) {
        // ignore broadcast errors
      }

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

// Start WebSocket server attached to the main HTTP server (no separate port)
const wss = new WebSocket.Server({ noServer: true });

// JWKS configuration (set WS_JWKS_URI and optional WS_AUDIENCE / WS_ISSUER in production)
const JWKS_URI = process.env.WS_JWKS_URI || process.env.XSUAA_JWKS_URI || null;
const WS_AUDIENCE = process.env.WS_AUDIENCE || process.env.WS_CLIENT_ID || null;
const WS_ISSUER = process.env.WS_ISSUER || null;
let jwksClientInstance = null;
if (JWKS_URI) {
  jwksClientInstance = jwksClient({ jwksUri: JWKS_URI, cache: true, rateLimit: true });
}

function getKey(header, callback) {
  if (!jwksClientInstance) return callback(new Error('JWKS client not configured'));
  jwksClientInstance.getSigningKey(header.kid, function (err, key) {
    if (err) return callback(err);
    const pubkey = key.getPublicKey();
    callback(null, pubkey);
  });
}

function verifyTokenAsync(token) {
  return new Promise((resolve, reject) => {
    try {
      const decodedHeader = jwt.decode(token, { complete: true });
      const alg = decodedHeader && decodedHeader.header && decodedHeader.header.alg;

      // HS* tokens (server-signed with WS_SECRET)
      if (alg && alg.toUpperCase().startsWith('HS')) {
        const secret = process.env.WS_SECRET;
        if (!secret) return reject(new Error('WS_SECRET not configured for HS token verification'));
        try {
          const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
          return resolve(payload);
        } catch (err) {
          return reject(err);
        }
      }

      // For RS* or ES* tokens, use JWKS if configured
      if (JWKS_URI) {
        jwt.verify(token, getKey, { audience: WS_AUDIENCE || undefined, issuer: WS_ISSUER || undefined }, function (err, decoded) {
          if (err) return reject(err);
          resolve(decoded);
        });
        return;
      }

      return reject(new Error('Unable to verify token: unsupported alg or JWKS not configured'));
    } catch (err) {
      return reject(err);
    }
  });
}

wss.on('connection', async function connection(ws, req, meta) {
  ws.isAlive = true;
  ws.on('pong', function () { ws.isAlive = true; });

  // If token was provided in query, meta may include tokenFromQuery
  const tokenFromQuery = meta && meta.tokenFromQuery;
  if (tokenFromQuery) {
    try {
      const payload = await verifyTokenAsync(tokenFromQuery);
      const email = payload && (payload.email || payload.user_name || payload.client_id);
      if (email) {
        const db = await cds.connect.to('db');
        const admin = await db.run(SELECT.one.from('tracker.Admins').where({ email: normalizeEmail(email) }));
        if (admin) {
          ws.adminId = admin.ID;
          let set = adminSockets.get(admin.ID);
          if (!set) { set = new Set(); adminSockets.set(admin.ID, set); }
          set.add(ws);
          try { ws.send(JSON.stringify({ type: 'auth', status: 'ok' })); } catch (e) {}
        } else {
          try { ws.send(JSON.stringify({ type: 'auth', status: 'failed' })); } catch (e) {}
          ws.close();
        }
      } else {
        try { ws.send(JSON.stringify({ type: 'auth', status: 'failed' })); } catch (e) {}
        ws.close();
      }
    } catch (err) {
      try { ws.send(JSON.stringify({ type: 'auth', status: 'failed', error: err.message })); } catch (e) {}
      ws.close();
    }
    return; // done
  }

  // Fallback: accept an 'auth' message with a token (production) or an adminEmail (development only)
  ws.once('message', async function incoming(message) {
    try {
      const data = JSON.parse(message);
      if (data && data.type === 'auth') {
        if (data.token) {
          // verify token
          try {
            const payload = await verifyTokenAsync(data.token);
            const email = payload && (payload.email || payload.user_name || payload.client_id);
            if (email) {
              const db = await cds.connect.to('db');
              const admin = await db.run(SELECT.one.from('tracker.Admins').where({ email: normalizeEmail(email) }));
              if (admin) {
                ws.adminId = admin.ID;
                let set = adminSockets.get(admin.ID);
                if (!set) { set = new Set(); adminSockets.set(admin.ID, set); }
                set.add(ws);
                try { ws.send(JSON.stringify({ type: 'auth', status: 'ok' })); } catch (e) {}
                return;
              }
            }
            try { ws.send(JSON.stringify({ type: 'auth', status: 'failed' })); } catch (e) {}
            ws.close();
            return;
          } catch (err) {
            try { ws.send(JSON.stringify({ type: 'auth', status: 'failed', error: err.message })); } catch (e) {}
            ws.close();
            return;
          }
        }

        // Non-token auth (legacy): allow only outside production
        if (process.env.NODE_ENV !== 'production' && data.adminEmail) {
          try {
            const db = await cds.connect.to('db');
            const admin = await db.run(SELECT.one.from('tracker.Admins').where({ email: normalizeEmail(data.adminEmail) }));
            if (admin) {
              ws.adminId = admin.ID;
              let set = adminSockets.get(admin.ID);
              if (!set) { set = new Set(); adminSockets.set(admin.ID, set); }
              set.add(ws);
              try { ws.send(JSON.stringify({ type: 'auth', status: 'ok' })); } catch (e) {}
              return;
            }
          } catch (e) {
            // fallthrough
          }
        }
      }
    } catch (err) {
      // ignore
    }

    // If not authenticated by now, close connection
    try { ws.send(JSON.stringify({ type: 'auth', status: 'failed' })); } catch (e) {}
    ws.close();
  });

  ws.on('close', function () {
    if (ws.adminId) {
      const set = adminSockets.get(ws.adminId);
      if (set) {
        set.delete(ws);
        if (!set.size) adminSockets.delete(ws.adminId);
      }
    }
  });
});

// Periodic ping to detect dead clients
setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

if (require.main === module) {
  const maybeServer = cds.server();
  Promise.resolve(maybeServer).then((httpServer) => {
    // cds.server may return an http.Server or an object with .server
    const server = httpServer && httpServer._server ? httpServer._server : (httpServer && httpServer.server ? httpServer.server : httpServer);

    if (server && typeof server.on === 'function') {
      server.on('upgrade', function (req, socket, head) {
        // parse token from query
        let tokenFromQuery = null;
        try {
          const url = new URL(req.url, 'http://localhost');
          tokenFromQuery = url.searchParams.get('access_token');
        } catch (e) {
          tokenFromQuery = null;
        }

        wss.handleUpgrade(req, socket, head, function done(ws) {
          // pass tokenFromQuery as meta by emitting connection with third arg
          wss.emit('connection', ws, req, { tokenFromQuery: tokenFromQuery });
        });
      });

      // attach close handler to clean up sockets on server close
      server.on('close', function () {
        wss.clients.forEach(function (ws) { try { ws.terminate(); } catch (e) {} });
      });
    }
  }).catch((e) => {
    // ignore
  });
}