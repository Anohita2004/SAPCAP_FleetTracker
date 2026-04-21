const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;

module.exports = cds.service.impl(function () {
  const { Trips, LocationPoints } = this.entities;

  this.on("startTrip", async (req) => {
    const { title } = req.data;

    const activeTrip = await SELECT.one.from(Trips).where({ status: "ACTIVE" });
    if (activeTrip) {
      return activeTrip;
    }

    const now = new Date().toISOString();
    const ID = cds.utils.uuid();
    const entry = {
      ID,
      title: title || `Trip ${now}`,
      startedAt: now,
      status: "ACTIVE"
    };

    await INSERT.into(Trips).entries(entry);

    return SELECT.one.from(Trips).where({ ID });
  });

  this.on("stopTrip", async (req) => {
    const { tripId } = req.data;
    if (!tripId) {
      return req.reject(400, "tripId is required");
    }

    const trip = await SELECT.one.from(Trips).where({ ID: tripId });
    if (!trip) {
      return req.reject(404, "Trip not found");
    }

    const endedAt = new Date().toISOString();
    await UPDATE(Trips).set({ status: "COMPLETED", endedAt }).where({ ID: tripId });

    return SELECT.one.from(Trips).where({ ID: tripId });
  });

  this.on("recordLocation", async (req) => {
    const { tripId, latitude, longitude } = req.data;
    if (!tripId) {
      return req.reject(400, "tripId is required");
    }
    if (latitude === undefined || longitude === undefined) {
      return req.reject(400, "latitude and longitude are required");
    }

    const trip = await SELECT.one.from(Trips).where({ ID: tripId });
    if (!trip) {
      return req.reject(404, "Trip not found");
    }

    if (trip.status !== "ACTIVE") {
      return req.reject(400, "Trip is not active");
    }

    const payload = {
      trip_ID: tripId,
      latitude,
      longitude,
      accuracy: req.data.accuracy ?? null,
      altitude: req.data.altitude ?? null,
      speed: req.data.speed ?? null,
      heading: req.data.heading ?? null,
      recordedAt: req.data.recordedAt || new Date().toISOString(),
      source: req.data.source || "browser-geolocation"
    };

    await INSERT.into(LocationPoints).entries(payload);

    return SELECT.one.from(LocationPoints).where({ trip_ID: tripId, recordedAt: payload.recordedAt });
  });

  this.on("activeTrip", async () => {
    const trips = await SELECT.from(Trips).where({ status: "ACTIVE" }).orderBy("startedAt desc").limit(1);
    return trips[0] || null;
  });
});