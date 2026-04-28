const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;

module.exports = cds.service.impl(function () {
  const { Trips, LocationPoints } = this.entities;

  const nowISO = () => new Date().toISOString();

  const getTripById = (id) =>
    SELECT.one.from(Trips).where({ ID: id });

  const getActiveTrip = () =>
    SELECT.one.from(Trips)
      .where({ status: "ACTIVE" })
      .orderBy("startedAt desc");

  this.on("startTrip", async (req) => {
    const { title } = req.data;

    const activeTrip = await getActiveTrip();
    if (activeTrip) return activeTrip;

    const entry = {
      ID: cds.utils.uuid(),
      title: title || `Trip ${nowISO()}`,
      startedAt: nowISO(),
      status: "ACTIVE"
    };

    await INSERT.into(Trips).entries(entry);
    return entry;
  });

  this.on("stopTrip", async (req) => {
    const { tripId } = req.data;
    if (!tripId) return req.reject(400, "tripId is required");

    const trip = await getTripById(tripId);
    if (!trip) return req.reject(404, "Trip not found");

    await UPDATE(Trips)
      .set({ status: "COMPLETED", endedAt: nowISO() })
      .where({ ID: tripId });

    return getTripById(tripId);
  });

  this.on("recordLocation", async (req) => {
    const { tripId, latitude, longitude } = req.data;

    if (!tripId) return req.reject(400, "tripId is required");
    if (latitude == null || longitude == null)
      return req.reject(400, "latitude and longitude are required");

    const trip = await getTripById(tripId);
    if (!trip) return req.reject(404, "Trip not found");
    if (trip.status !== "ACTIVE")
      return req.reject(400, "Trip is not active");

    const payload = {
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

  this.on("activeTrip", async () => {
    return (await getActiveTrip()) || null;
  });
});