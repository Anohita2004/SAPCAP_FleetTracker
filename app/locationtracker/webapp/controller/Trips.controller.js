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
            MessageToast.show("Active trip selected");
        },

        onNavBack: function () {
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
                var bMatchesStatus = sStatusFilter === "ALL" || oTrip.status === sStatusFilter;
                var bMatchesQuery = !sQuery ||
                    oTrip.title.toLowerCase().indexOf(sQuery) > -1 ||
                    oTrip.status.toLowerCase().indexOf(sQuery) > -1 ||
                    oTrip.driverLine.toLowerCase().indexOf(sQuery) > -1;

                return bMatchesStatus && bMatchesQuery;
            });

            oModel.setProperty("/filteredTrips", aFilteredTrips);
            oModel.setProperty("/summary", this._buildSummary(aFilteredTrips));

            if (!aFilteredTrips.length) {
                oModel.setProperty("/selectedTrip", {});
                return;
            }

            var oSelectedTrip = oModel.getProperty("/selectedTrip");
            var oMatchingTrip = aFilteredTrips.find(function (oTrip) {
                return oSelectedTrip && oSelectedTrip.ID === oTrip.ID;
            });

            oModel.setProperty("/selectedTrip", oMatchingTrip || aFilteredTrips[0]);
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
            var aPoints = (oTrip.points || []).slice().sort(function (oLeft, oRight) {
                return new Date(oRight.recordedAt || 0) - new Date(oLeft.recordedAt || 0);
            });
            var oLatestPoint = aPoints[0] || null;
            var sStartedDisplay = this._formatDateTime(oTrip.startedAt);
            var sEndedDisplay = this._formatDateTime(oTrip.endedAt);
            var sDurationText = this._formatDuration(oTrip.startedAt, oTrip.endedAt, oTrip.status);

            return {
                ID: oTrip.ID,
                title: oTrip.title || "Untitled Trip",
                status: oTrip.status || "UNKNOWN",
                driverName: oTrip.driver && oTrip.driver.name ? oTrip.driver.name : "Unassigned driver",
                driverLine: this._buildDriverLine(oTrip.driver),
                statusState: this._statusToState(oTrip.status),
                statusNarrative: this._buildStatusNarrative(oTrip, aPoints.length),
                startedAt: oTrip.startedAt,
                endedAt: oTrip.endedAt,
                startedDisplay: sStartedDisplay,
                endedDisplay: sEndedDisplay,
                durationText: sDurationText,
                pointCount: aPoints.length,
                summaryLine: "Started " + sStartedDisplay + " | " + sDurationText,
                locationLine: this._buildLocationLine(oLatestPoint),
                sourceLine: oLatestPoint ? (oLatestPoint.source || "Unknown source") : "No points recorded yet",
                timelineLine: this._buildTimelineLine(oTrip, oLatestPoint),
                recentPoints: aPoints.slice(0, 5).map(function (oPoint) {
                    return {
                        recordedDisplay: this._formatDateTime(oPoint.recordedAt),
                        speedDisplay: oPoint.speed != null ? Number(oPoint.speed).toFixed(1) : "-",
                        coordinateLine: this._buildCoordinateLine(oPoint),
                        detailLine: this._buildPointDetailLine(oPoint),
                        source: oPoint.source || "Unknown"
                    };
                }.bind(this))
            };
        },

        _buildDriverLine: function (oDriver) {
            if (!oDriver) {
                return "Driver unavailable";
            }

            return "Driver: " + (oDriver.name || oDriver.email || "Unknown") + " | " + (oDriver.email || "No email");
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

