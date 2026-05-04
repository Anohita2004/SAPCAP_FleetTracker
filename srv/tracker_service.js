const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;

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

    const existingDriver = await getDriverByEmail(email);
    if (existingDriver && existingDriver.admin_ID !== admin.ID) {
      return req.reject(409, "A driver with this email is already assigned to another admin");
    }

    if (existingDriver) {
      await UPDATE(Drivers)
        .set({
          name: req.data.name || existingDriver.name,
          phone: req.data.phone || existingDriver.phone,
          status: "ACTIVE"
        })
        .where({ ID: existingDriver.ID });
      return SELECT.one.from(Drivers).where({ ID: existingDriver.ID });
    }

    const entry = {
      ID: cds.utils.uuid(),
      name: req.data.name || email,
      email,
      phone: req.data.phone || null,
      status: "ACTIVE",
      admin_ID: admin.ID
    };

    await INSERT.into(Drivers).entries(entry);
    return entry;
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
    return payload;
  });

  this.on("activeTrip", async (req) => {
    const driver = await requireDriverProfile(req);
    if (!driver) return null;
    return (await getActiveTrip(driver.ID)) || null;
  });
});
