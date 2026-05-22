const cds = require("@sap/cds");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { SELECT, INSERT, UPDATE } = cds.ql;
const WS_SECRET = process.env.WS_SECRET || 'dev-local-ws-secret';

const PDFDocument = require('pdfkit');
const streamToBuffer = (stream) => new Promise((resolve, reject) => {
  const chunks = [];
  stream.on('data', (c) => chunks.push(c));
  stream.on('end', () => resolve(Buffer.concat(chunks)));
  stream.on('error', (err) => reject(err));
});

module.exports = cds.service.impl(function () {
  const { Admins, Drivers, Trips, LocationPoints } = this.entities;

  const nowISO = () => new Date().toISOString();
  const userId = (req) => req.user?.id;
  const userName = (req) => req.user?.attr?.given_name || req.user?.attr?.family_name || userId(req);
  const isAdmin = (req) => req.user?.is("FleetAdmin");
  const isDriver = (req) => req.user?.is("Driver");

  const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

  const getAdminByEmail = (email) =>
    SELECT.one.from(Admins).where({ email: normalizeEmail(email) });

  const getDriverByEmail = (email) =>
    SELECT.one.from(Drivers).where({ email: normalizeEmail(email) });

  const getTripById = (id) =>
    SELECT.one.from(Trips).where({ ID: id });

  const ensureAdminProfile = async (req) => {
    if (!isAdmin(req)) return null;

    const email = normalizeEmail(userId(req));
    let admin = await getAdminByEmail(email);
    if (admin) return admin;

    admin = {
      ID: cds.utils.uuid(),
      name: userName(req),
      email
    };

    await INSERT.into(Admins).entries(admin);
    return admin;
  };

  const requireDriverProfile = async (req) => {
    const driver = await getDriverByEmail(userId(req));
    if (!driver || driver.status !== "ACTIVE") {
      return req.reject(403, "No active driver profile is assigned to this login");
    }
    return driver;
  };

  const getActiveTrip = (driverId) =>
    SELECT.one.from(Trips)
      .where({ status: "ACTIVE", driver_ID: driverId })
      .orderBy("startedAt desc");

  const rejectIfNotTripDriver = async (req, tripId) => {
    const driver = await requireDriverProfile(req);
    if (!driver) return null;

    const trip = await getTripById(tripId);
    if (!trip) return req.reject(404, "Trip not found");
    if (trip.driver_ID !== driver.ID) {
      return req.reject(403, "Drivers can only access their own trips");
    }

    return { trip, driver };
  };

  this.before("READ", Admins, (req) => {
    req.query.where({ email: normalizeEmail(userId(req)) });
  });

  this.before("READ", Drivers, (req) => {
    if (isAdmin(req)) {
      req.query.where({ "admin.email": normalizeEmail(userId(req)) });
      return;
    }

    req.query.where({ email: normalizeEmail(userId(req)) });
  });

  this.before("READ", Trips, (req) => {
    if (isAdmin(req)) {
      req.query.where({ "driver.admin.email": normalizeEmail(userId(req)) });
      return;
    }

    req.query.where({ "driver.email": normalizeEmail(userId(req)) });
  });

  this.before("READ", LocationPoints, (req) => {
    if (isAdmin(req)) {
      req.query.where({ "trip.driver.admin.email": normalizeEmail(userId(req)) });
      return;
    }

    req.query.where({ "trip.driver.email": normalizeEmail(userId(req)) });
  });

  this.on("me", async (req) => {
    const admin = await ensureAdminProfile(req);
    const driver = isDriver(req) ? await getDriverByEmail(userId(req)) : null;

    return {
      email: normalizeEmail(userId(req)),
      name: userName(req),
      isAdmin: isAdmin(req),
      isDriver: Boolean(driver && driver.status === "ACTIVE"),
      adminId: admin?.ID || null,
      driverId: driver?.ID || null
    };
  });

  this.on("createDriver", async (req) => {
    const admin = await ensureAdminProfile(req);
    if (!admin) return req.reject(403, "Only fleet admins can create drivers");

    const email = normalizeEmail(req.data.email);
    if (!email) return req.reject(400, "Driver email is required");

    const password = String(req.data.password || "");
    if (password.length < 8) {
      return req.reject(400, "A temporary password with at least 8 characters is required");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const existingDriver = await getDriverByEmail(email);
    if (existingDriver && existingDriver.admin_ID !== admin.ID) {
      return req.reject(409, "A driver with this email is already assigned to another admin");
    }

    if (existingDriver) {
      await UPDATE(Drivers)
        .set({
          name: req.data.name || existingDriver.name,
          phone: req.data.phone || existingDriver.phone,
          passwordHash,
          status: "ACTIVE"
        })
        .where({ ID: existingDriver.ID });

      return SELECT.one.from(Drivers).where({ ID: existingDriver.ID });
    }

    const entry = {
      ID: cds.utils.uuid(),
      name: req.data.name || email,
      email,
      passwordHash,
      phone: req.data.phone || null,
      status: "ACTIVE",
      admin_ID: admin.ID
    };

    await INSERT.into(Drivers).entries(entry);

    return {
      ID: entry.ID,
      name: entry.name,
      email: entry.email,
      phone: entry.phone,
      status: entry.status,
      admin_ID: entry.admin_ID
    };
  });

  this.on("startTrip", async (req) => {
    const driver = await requireDriverProfile(req);
    if (!driver) return null;

    const activeTrip = await getActiveTrip(driver.ID);
    if (activeTrip) return activeTrip;

    const entry = {
      ID: cds.utils.uuid(),
      title: req.data.title || `Trip ${nowISO()}`,
      driver_ID: driver.ID,
      startedAt: nowISO(),
      status: "ACTIVE"
    };

    await INSERT.into(Trips).entries(entry);
    return entry;
  });

  this.on("stopTrip", async (req) => {
    const { tripId } = req.data;
    if (!tripId) return req.reject(400, "tripId is required");

    const result = await rejectIfNotTripDriver(req, tripId);
    if (!result) return null;

    await UPDATE(Trips)
      .set({ status: "COMPLETED", endedAt: nowISO() })
      .where({ ID: tripId });

    return getTripById(tripId);
  });

  this.on("recordLocation", async (req) => {
    const { tripId, latitude, longitude } = req.data;

    if (!tripId) return req.reject(400, "tripId is required");
    if (latitude == null || longitude == null) {
      return req.reject(400, "latitude and longitude are required");
    }

    const result = await rejectIfNotTripDriver(req, tripId);
    if (!result) return null;
    if (result.trip.status !== "ACTIVE") {
      return req.reject(400, "Trip is not active");
    }

    const payload = {
      ID: cds.utils.uuid(),
      trip_ID: tripId,
      latitude,
      longitude,
      accuracy: req.data.accuracy ?? null,
      altitude: req.data.altitude ?? null,
      speed: req.data.speed ?? null,
      heading: req.data.heading ?? null,
      recordedAt: req.data.recordedAt || nowISO(),
      source: req.data.source || "browser-geolocation"
    };

    await INSERT.into(LocationPoints).entries(payload);

    // Best-effort broadcast to admin dashboards in the same process
    try {
      const serverModule = require('../server');
      if (serverModule && typeof serverModule.broadcastToAdmin === 'function') {
        const adminId = result.driver && result.driver.admin_ID;
        if (adminId) {
          serverModule.broadcastToAdmin(adminId, {
            type: 'location',
            driverId: result.driver.ID,
            tripId: tripId,
            latitude: payload.latitude,
            longitude: payload.longitude,
            recordedAt: payload.recordedAt,
            speed: payload.speed,
            heading: payload.heading
          });
        }
      }
    } catch (e) {
      // ignore
    }

    return payload;
  });

  this.on("activeTrip", async (req) => {
    const driver = await requireDriverProfile(req);
    if (!driver) return null;
    return (await getActiveTrip(driver.ID)) || null;
  });

  // Issue a short-lived WebSocket token for the calling admin (no change to existing login)
  this.on("issueWsToken", async (req) => {
    const admin = await ensureAdminProfile(req);
    if (!admin) return req.reject(403, "Only fleet admins may request a WS token");

    if (!WS_SECRET) return req.reject(500, "WS token signing not configured");

    const payload = { adminId: admin.ID, email: admin.email };
    const token = jwt.sign(payload, WS_SECRET, { algorithm: 'HS256', expiresIn: '2m' });
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    return { token, expiresAt };
  });

  // Reporting actions
  this.on('scheduleReport', async (req) => {
    const admin = await ensureAdminProfile(req);
    if (!admin) return req.reject(403, 'Only fleet admins may schedule reports');

    const data = req.data || {};
    if (!data.name || !data.entityName) return req.reject(400, 'name and entityName required');
    const interval = Number(data.intervalMin) || 60;

    const entry = {
      ID: cds.utils.uuid(),
      name: data.name,
      admin_ID: admin.ID,
      entityName: data.entityName,
      format: data.format === 'PDF' ? 'PDF' : 'CSV',
      filter: data.filter || null,
      intervalMin: interval,
      lastRun: null,
      nextRun: new Date(Date.now() + interval * 60 * 1000).toISOString(),
      enabled: true
    };

    await INSERT.into('tracker.ScheduledReports').entries(entry);
    return entry;
  });

  this.on('listScheduledReports', async (req) => {
    const admin = await ensureAdminProfile(req);
    if (!admin) return req.reject(403, 'Only fleet admins may list reports');

    const rows = await SELECT.from('tracker.ScheduledReports').where({ admin_ID: admin.ID });
    return rows;
  });

  this.on('cancelScheduledReport', async (req) => {
    const admin = await ensureAdminProfile(req);
    if (!admin) return req.reject(403, 'Only fleet admins may cancel reports');

    const id = req.data.reportId;
    if (!id) return req.reject(400, 'reportId required');

    await UPDATE('tracker.ScheduledReports').set({ enabled: false }).where({ ID: id, admin_ID: admin.ID });
    return true;
  });

  this.on('generateReport', async (req) => {
    const admin = await ensureAdminProfile(req);
    if (!admin) return req.reject(403, 'Only fleet admins may generate reports');

    const id = req.data.reportId;
    if (!id) return req.reject(400, 'reportId required');

    const rep = await SELECT.one.from('tracker.ScheduledReports').where({ ID: id, admin_ID: admin.ID });
    if (!rep) return req.reject(404, 'Report not found');

    // Build query based on entityName
    let rows = [];
    if (rep.entityName === 'Trips') {
      rows = await SELECT.from('tracker.Trips').where({ 'driver.admin_ID': admin.ID }).orderBy('startedAt desc');
    } else if (rep.entityName === 'LocationPoints') {
      rows = await SELECT.from('tracker.LocationPoints').where({ 'trip.driver.admin_ID': admin.ID }).orderBy('recordedAt desc');
    } else if (rep.entityName === 'Drivers') {
      rows = await SELECT.from('tracker.Drivers').where({ admin_ID: admin.ID }).orderBy('name asc');
    } else {
      return req.reject(400, 'Unsupported entityName');
    }

    if (rep.format === 'PDF') {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const pass = doc.pipe(new require('stream').PassThrough());

      doc.fontSize(16).text(rep.name || 'Report', { underline: true });
      doc.moveDown(0.5);

      // Simple tabular layout
      doc.fontSize(10);
      rows.forEach((r, idx) => {
        doc.text(JSON.stringify(r), { continued: false });
        if (idx < rows.length - 1) doc.moveDown(0.1);
      });

      doc.end();
      const buf = await streamToBuffer(pass);
      // update lastRun/nextRun
      await UPDATE('tracker.ScheduledReports').set({ lastRun: new Date().toISOString(), nextRun: new Date(Date.now() + (rep.intervalMin || 60) * 60 * 1000).toISOString() }).where({ ID: rep.ID });
      return buf.toString('base64');
    }

    // CSV
    if (rep.format === 'CSV') {
      // infer headers from first row
      const headers = rows.length ? Object.keys(rows[0]).filter(k => k !== '_timestamps' && k !== '__metadata') : [];
      const csvLines = [headers.join(',')];
      rows.forEach(r => {
        const vals = headers.map(h => {
          const v = r[h];
          if (v == null) return '';
          return String(v).replace(/"/g, '""');
        });
        csvLines.push('"' + vals.join('","') + '"');
      });

      await UPDATE('tracker.ScheduledReports').set({ lastRun: new Date().toISOString(), nextRun: new Date(Date.now() + (rep.intervalMin || 60) * 60 * 1000).toISOString() }).where({ ID: rep.ID });
      return csvLines.join('\n');
    }

    return req.reject(400, 'Unsupported format');
  });
});