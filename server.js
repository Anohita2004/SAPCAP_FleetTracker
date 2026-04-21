const cds = require("@sap/cds");
const { SELECT } = cds.ql;

module.exports = cds.server;

cds.on("bootstrap", (app) => {
  app.get("/tracker/path/:tripId", async (req, res, next) => {
    try {
      const db = await cds.connect.to("db");
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