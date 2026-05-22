sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.Trips", {
    onInit: function () {
      var oTripsModel = new JSONModel({
        loading: false,
        trips: [],
        filteredTrips: [],
        selectedTrip: {},
        query: "",
        statusFilter: "ALL",
        fcl: {
          layout: "OneColumn"
        },
        summary: {
          totalTrips: 0,
          activeTrips: 0,
          completedTrips: 0,
          totalPoints: 0
        }
      });

      this.getView().setModel(oTripsModel, "trips");
      this._loadTrips();
    },

    onRefreshTrips: function () {
      this._loadTrips(true);
    },

    onSearchTrips: function (oEvent) {
      this.getView().getModel("trips").setProperty("/query", oEvent.getParameter("newValue") || "");
      this._applyFilters();
    },

    onFilterStatus: function (oEvent) {
      this.getView().getModel("trips").setProperty("/statusFilter", oEvent.getParameter("key"));
      this._applyFilters();
    },

    onTripSelectionChange: function (oEvent) {
      var oItem = oEvent.getParameter("listItem");
      var oContext = oItem && oItem.getBindingContext("trips");

      if (!oContext) {
        return;
      }

      this.getView().getModel("trips").setProperty("/selectedTrip", oContext.getObject());
      this.getView().getModel("trips").setProperty("/fcl/layout", "TwoColumnsMidExpanded");

      // notify map to highlight selected trip (if admin map is visible)
      try {
        var trip = oContext.getObject();
        if (window.__highlightAdminTrip && trip && trip.ID) {
          window.__highlightAdminTrip(trip.ID);
        }
      } catch (e) { /* ignore */ }
    },

    onFocusActiveTrip: function () {
      var oModel = this.getView().getModel("trips");
      var aTrips = oModel.getProperty("/filteredTrips") || [];
      var oActiveTrip = aTrips.find(function (oTrip) {
        return oTrip.status === "ACTIVE";
      });

      if (!oActiveTrip) {
        MessageToast.show("No active trip is available in the current filter.");
        return;
      }

      oModel.setProperty("/selectedTrip", oActiveTrip);
      // notify admin map
      try { if (window.__highlightAdminTrip) window.__highlightAdminTrip(oActiveTrip.ID); } catch (e) {}
      oModel.setProperty("/fcl/layout", "TwoColumnsMidExpanded");
      MessageToast.show("Active trip selected");
    },

    onNavBack: function () {
      var oModel = this.getView().getModel("trips");

      if (oModel.getProperty("/fcl/layout") !== "OneColumn") {
        oModel.setProperty("/fcl/layout", "OneColumn");
        return;
      }

      this.getOwnerComponent().getRouter().navTo("RouteApp");
    },

    _loadTrips: async function (bShowToast) {
      var oModel = this.getView().getModel("trips");
      oModel.setProperty("/loading", true);

      try {
        var oResponse = await this._get("/tracker/Trips?$expand=points,driver&$orderby=startedAt desc");
        var aTrips = (oResponse.value || []).map(function (oTrip) {
          return this._shapeTrip(oTrip);
        }.bind(this));

        oModel.setProperty("/trips", aTrips);
        this._applyFilters();

        if (bShowToast) {
          MessageToast.show("Trips refreshed");
        }
      } catch (oError) {
        MessageBox.error(oError.message || "Unable to load trips.");
      } finally {
        oModel.setProperty("/loading", false);
      }
    },

    _applyFilters: function () {
  var oModel = this.getView().getModel("trips");
  var aTrips = oModel.getProperty("/trips") || [];
  var sQuery = (oModel.getProperty("/query") || "").toLowerCase().trim();
  var sStatusFilter = oModel.getProperty("/statusFilter");

  var aFilteredTrips = aTrips.filter(function (oTrip) {
    var sTitle = String(oTrip.title || "").toLowerCase();
    var sStatus = String(oTrip.status || "").toLowerCase();
    var sDriver = String(oTrip.driverCompactLine || oTrip.driverLine || "").toLowerCase();

    var bMatchesStatus = sStatusFilter === "ALL" || oTrip.status === sStatusFilter;
    var bMatchesQuery = !sQuery ||
      sTitle.indexOf(sQuery) > -1 ||
      sStatus.indexOf(sQuery) > -1 ||
      sDriver.indexOf(sQuery) > -1;

    return bMatchesStatus && bMatchesQuery;
  });

  oModel.setProperty("/filteredTrips", aFilteredTrips);
  oModel.setProperty("/summary", this._buildSummary(aFilteredTrips));

  if (!aFilteredTrips.length) {
    oModel.setProperty("/selectedTrip", {});
    oModel.setProperty("/fcl/layout", "OneColumn");
    return;
  }

  var oSelectedTrip = oModel.getProperty("/selectedTrip");
  var oMatchingTrip = aFilteredTrips.find(function (oTrip) {
    return oSelectedTrip && oSelectedTrip.ID === oTrip.ID;
  });

  var oNextTrip = oMatchingTrip || aFilteredTrips[0];
  oModel.setProperty("/selectedTrip", oNextTrip);

  // notify admin map to highlight the selected trip
  try {
    if (window.__highlightAdminTrip && oNextTrip && oNextTrip.ID) {
      window.__highlightAdminTrip(oNextTrip.ID);
    }
  } catch (e) { /* ignore */ }

  if (oNextTrip && oNextTrip.ID) {
    oModel.setProperty("/fcl/layout", "TwoColumnsMidExpanded");
  }
},

    _buildSummary: function (aTrips) {
      return aTrips.reduce(function (oSummary, oTrip) {
        oSummary.totalTrips += 1;
        oSummary.totalPoints += oTrip.pointCount;

        if (oTrip.status === "ACTIVE") {
          oSummary.activeTrips += 1;
        }

        if (oTrip.status === "COMPLETED") {
          oSummary.completedTrips += 1;
        }

        return oSummary;
      }, {
        totalTrips: 0,
        activeTrips: 0,
        completedTrips: 0,
        totalPoints: 0
      });
    },

    _shapeTrip: function (oTrip) {
      // compute deterministic color per driver id
      function colorForDriver(driverId) {
        if (!driverId) return '#0a6ed1';
        var palette = ['#0a6ed1','#1f9e3a','#ff6f61','#8e44ad','#f39c12','#16a085','#34495e','#c0392b'];
        var hash = 0;
        for (var i=0;i<driverId.length;i++) { hash = ((hash<<5)-hash) + driverId.charCodeAt(i); hash |= 0; }
        return palette[Math.abs(hash) % palette.length];
      }

      var aPoints = (oTrip.points || []).slice().sort(function (oLeft, oRight) {
        return new Date(oRight.recordedAt || 0) - new Date(oLeft.recordedAt || 0);
      });

      var oLatestPoint = aPoints[0] || null;
      var sStartedDisplay = this._formatDateTime(oTrip.startedAt);
      var sEndedDisplay = this._formatDateTime(oTrip.endedAt);
      var sDurationText = this._formatDuration(oTrip.startedAt, oTrip.endedAt, oTrip.status);
      var sDurationShort = sDurationText.replace(" running", "").replace(" total", "");
      var sStatusText = this._statusToText(oTrip.status);
      var sCoordinateValue = this._buildCoordinateLine(oLatestPoint);
      var sDriverCompact = this._buildDriverCompactLine(oTrip.driver);
      var sDriverId = (oTrip.driver && oTrip.driver.ID) ? oTrip.driver.ID : (oTrip.driver && oTrip.driver.email) || "";
      var sColor = colorForDriver(String(sDriverId));
 
      return {
        ID: oTrip.ID,
        title: oTrip.title || "Untitled Trip",
        shortTitle: this._buildShortTitle(oTrip.title, oTrip.startedAt),
        status: oTrip.status || "UNKNOWN",
        statusText: sStatusText,
        driverName: oTrip.driver && oTrip.driver.name ? oTrip.driver.name : "Unassigned driver",
        driverLine: this._buildDriverLine(oTrip.driver),
        driverCompactLine: sDriverCompact,
        statusState: this._statusToState(oTrip.status),
        statusNarrative: this._buildStatusNarrative(oTrip, aPoints.length),
        detailSubtitle: sStatusText + " · " + aPoints.length + " captured point" + (aPoints.length === 1 ? "" : "s"),
        startedAt: oTrip.startedAt,
        endedAt: oTrip.endedAt,
        startedDisplay: sStartedDisplay,
        endedDisplay: sEndedDisplay,
        startedTime: this._formatTime(oTrip.startedAt),
        endedTime: oTrip.endedAt ? this._formatTime(oTrip.endedAt) : "-",
        durationText: sDurationText,
        durationShort: sDurationShort,
        pointCount: aPoints.length,
        summaryLine: "Started " + sStartedDisplay + " | " + sDurationText,
        color: sColor,
        coordinateValue: sCoordinateValue,
        locationLine: this._buildLocationLine(oLatestPoint),
        sourceLine: oLatestPoint ? (oLatestPoint.source || "Unknown source") : "No points recorded yet",
        sourceShort: this._shortenSource(oLatestPoint && oLatestPoint.source),
        timelineLine: this._buildTimelineLine(oTrip, oLatestPoint),
        timelineCompact: this._buildTimelineCompact(oTrip, oLatestPoint),
        recentPoints: aPoints.slice(0, 5).map(function (oPoint) {
          return {
            recordedDisplay: this._formatDateTime(oPoint.recordedAt),
            speedDisplay: oPoint.speed != null ? Number(oPoint.speed).toFixed(1) : "-",
            coordinateLine: this._buildCoordinateLine(oPoint),
            detailLine: this._buildPointDetailLine(oPoint),
            compactDetailLine: this._buildPointCompactLine(oPoint),
            source: oPoint.source || "Unknown",
            sourceShort: this._shortenSource(oPoint.source)
          };
        }.bind(this))
      };
    },

    _buildShortTitle: function (sTitle, sStartedAt) {
      if (sTitle) {
        return sTitle.replace(/(\d{2})\/(\d{2})\/(\d{4}),?\s*/, "$1/$2 · ");
      }

      if (!sStartedAt) {
        return "Untitled Trip";
      }

      return "Trip " + this._formatDateShort(sStartedAt) + " · " + this._formatTime(sStartedAt);
    },

    _buildDriverLine: function (oDriver) {
      if (!oDriver) {
        return "Driver unavailable";
      }

      return "Driver: " + (oDriver.name || oDriver.email || "Unknown") + " | " + (oDriver.email || "No email");
    },

    _buildDriverCompactLine: function (oDriver) {
      if (!oDriver) {
        return "Driver unavailable";
      }

      return (oDriver.name || "Driver") + " · " + (oDriver.email || "No email");
    },

    _buildStatusNarrative: function (oTrip, iPointCount) {
      if (oTrip.status === "ACTIVE") {
        return "This trip is currently active and has " + iPointCount + " captured point(s).";
      }

      if (oTrip.status === "COMPLETED") {
        return "This trip has ended and archived " + iPointCount + " point(s) for review.";
      }

      if (oTrip.status === "PAUSED") {
        return "This trip is paused and can resume capturing positions later.";
      }

      return "Trip status is available, but no narrative has been configured.";
    },

    _buildLocationLine: function (oPoint) {
      if (!oPoint) {
        return "No location points recorded yet.";
      }

      return "Latest location: " + this._buildCoordinateLine(oPoint);
    },

    _buildTimelineLine: function (oTrip, oLatestPoint) {
      var sStarted = this._formatDateTime(oTrip.startedAt);
      var sEnded = oTrip.endedAt ? this._formatDateTime(oTrip.endedAt) : "Still active";
      var sLatest = oLatestPoint ? this._formatDateTime(oLatestPoint.recordedAt) : "No capture yet";

      return "Started " + sStarted + ", latest point " + sLatest + ", ended " + sEnded + ".";
    },

    _buildTimelineCompact: function (oTrip, oLatestPoint) {
      var sStarted = this._formatTime(oTrip.startedAt);
      var sLatest = oLatestPoint ? this._formatTime(oLatestPoint.recordedAt) : "no capture";
      return "Started " + sStarted + ", last point " + sLatest;
    },

    _buildCoordinateLine: function (oPoint) {
      if (!oPoint) {
        return "-";
      }

      var sLatitude = oPoint.latitude != null ? Number(oPoint.latitude).toFixed(6) : "-";
      var sLongitude = oPoint.longitude != null ? Number(oPoint.longitude).toFixed(6) : "-";

      return sLatitude + ", " + sLongitude;
    },

    _buildPointDetailLine: function (oPoint) {
      var aParts = [];

      if (oPoint.accuracy != null) {
        aParts.push("Accuracy " + Number(oPoint.accuracy).toFixed(1) + " m");
      }

      if (oPoint.heading != null) {
        aParts.push("Heading " + Number(oPoint.heading).toFixed(1) + " deg");
      }

      if (oPoint.altitude != null) {
        aParts.push("Altitude " + Number(oPoint.altitude).toFixed(1) + " m");
      }

      return aParts.join(" | ") || "No additional telemetry";
    },

    _buildPointCompactLine: function (oPoint) {
      var aParts = [];

      if (oPoint.recordedAt) {
        aParts.push(this._formatDateShort(oPoint.recordedAt) + " · " + this._formatTime(oPoint.recordedAt));
      }

      if (oPoint.accuracy != null) {
        aParts.push("Acc " + Math.round(Number(oPoint.accuracy)) + " m");
      }

      return aParts.join(" · ") || "No telemetry";
    },

    _formatDuration: function (sStartedAt, sEndedAt, sStatus) {
      if (!sStartedAt) {
        return "Duration unavailable";
      }

      var iStart = new Date(sStartedAt).getTime();
      var iEnd = sEndedAt ? new Date(sEndedAt).getTime() : Date.now();
      var iMinutes = Math.max(1, Math.round((iEnd - iStart) / 60000));
      var iHours = Math.floor(iMinutes / 60);
      var iRemainingMinutes = iMinutes % 60;
      var sSuffix = sStatus === "ACTIVE" && !sEndedAt ? "running" : "total";

      if (iHours === 0) {
        return iMinutes + " min " + sSuffix;
      }

      return iHours + "h " + iRemainingMinutes + "m " + sSuffix;
    },

    _formatDateTime: function (sValue) {
      if (!sValue) {
        return "-";
      }

      return new Date(sValue).toLocaleString();
    },

    _formatDateShort: function (sValue) {
      if (!sValue) {
        return "-";
      }

      return new Date(sValue).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "2-digit"
      });
    },

    _formatTime: function (sValue) {
      if (!sValue) {
        return "-";
      }

      return new Date(sValue).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    },

    _statusToText: function (sStatus) {
      switch (sStatus) {
      case "ACTIVE":
        return "Active";
      case "COMPLETED":
        return "Completed";
      case "PAUSED":
        return "Paused";
      default:
        return sStatus || "Unknown";
      }
    },

    _statusToState: function (sStatus) {
      switch (sStatus) {
      case "ACTIVE":
        return "Success";
      case "COMPLETED":
        return "Information";
      case "PAUSED":
        return "Warning";
      default:
        return "None";
      }
    },

    _shortenSource: function (sSource) {
      if (!sSource) {
        return "unknown";
      }

      if (sSource === "browser-geolocation") {
        return "browser-geo";
      }

      return sSource;
    },

    _get: async function (sUrl) {
      var oResponse = await fetch(sUrl, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!oResponse.ok) {
        throw new Error(await this._extractError(oResponse));
      }

      return oResponse.json();
    },

    _extractError: async function (oResponse) {
      try {
        var oData = await oResponse.json();
        return oData.error && oData.error.message ? oData.error.message : oResponse.statusText;
      } catch (oError) {
        return oResponse.statusText || "Unknown request error";
      }
    }
  });
});