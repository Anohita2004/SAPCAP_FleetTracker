const cds = require("@sap/cds");
const { SELECT } = cds.ql;
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

module.exports = cds.server;

cds.on("bootstrap", (app) => {
  app.get("/tracker/path/:tripId", async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const db = await cds.connect.to("db");
      const trip = await db.run(
        SELECT.one.from("tracker.Trips").where({ ID: req.params.tripId })
      );

      if (!trip) return res.status(404).json({ error: "Trip not found" });

      if (req.user.is("FleetAdmin")) {
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