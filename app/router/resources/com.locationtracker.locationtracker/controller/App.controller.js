sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], function (Controller, MessageBox, MessageToast) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.App", {
    onInit: function () {
      this._watchId = null;
      this._map = null;
      this._polyline = null;
      this._marker = null;
      this._points = [];
      this._adminMarkers = [];
      this._adminRefreshTimer = null;
      this._viewModel = this.getOwnerComponent().getModel("view");

      this._viewModel.setProperty("/nav", { active: "home" });
      this._viewModel.setProperty("/showAdminPanel", false);
      this._viewModel.setProperty("/drivers", []);
      this._viewModel.setProperty("/adminTrips", []);
      this._viewModel.setProperty("/lastRefreshText", "Not refreshed yet");
      this._viewModel.setProperty("/adminStats", {
        totalDrivers: 0,
        activeDrivers: 0,
        activeTrips: 0,
        completedTrips: 0
      });

      this.getView().addEventDelegate({
        onAfterShow: function () {
          this._ensureMap();
        }.bind(this)
      });

      this._loadUserContext();
    },

    onExit: function () {
      if (this._watchId !== null) {
        navigator.geolocation.clearWatch(this._watchId);
      }

      if (this._adminRefreshTimer) {
        clearInterval(this._adminRefreshTimer);
      }
    },

    onNavHome: function () {
      this._viewModel.setProperty("/nav/active", "home");
      this._ensureMap();
    },

    onOpenCreateDriver: function () {
      this.byId("createDriverDialog").open();
    },

    onCloseCreateDriver: function () {
      this.byId("createDriverDialog").close();
    },

    onLogout: function () {
      localStorage.removeItem("driver_token");

      if (this._adminRefreshTimer) {
        clearInterval(this._adminRefreshTimer);
        this._adminRefreshTimer = null;
      }

      try {
        var origin = window.location.origin || "";
        if (!/localhost|127\.0\.0\.1|:4004/.test(origin)) {
          window.location.href = origin + "/logout";
          return;
        }
      } catch (error) {
        // Ignore logout redirect errors.
      }

      this._viewModel.setProperty("/user", {});
      this._viewModel.setProperty("/isAdmin", false);
      this._viewModel.setProperty("/isDriver", false);
      MessageToast.show("Logged out");
    },

    onAfterRendering: function () {
      this._ensureMap();
    },

    onNavigateToTrips: function () {
      this.getOwnerComponent().getRouter().navTo("RouteTrips");
    },

    onRefreshFleet: async function () {
      await this._loadDrivers();
      await this._loadAdminTrips();
      MessageToast.show("Fleet refreshed");
    },

    onLocateDriver: function (event) {
      var driver = event.getSource().getBindingContext("view").getObject();

      if (!driver.latestLat || !driver.latestLng || !this._map) {
        MessageToast.show("No live location available for this driver");
        return;
      }

      this._map.setView([Number(driver.latestLat), Number(driver.latestLng)], 16);
    },

    onCreateDriver: async function () {
      var draft = this._viewModel.getProperty("/driverDraft") || {};

      try {
        var driver = await this._post("/tracker/createDriver", {
          name: draft.name,
          email: draft.email,
          phone: draft.phone,
          password: draft.password
        });

        this._viewModel.setProperty("/driverDraft", {
          name: "",
          email: "",
          phone: "",
          password: ""
        });

        this.byId("createDriverDialog").close();
        MessageToast.show("Driver assigned: " + driver.email);
        await this._loadDrivers();
      } catch (error) {
        MessageBox.error(error.message || "Unable to create driver.");
      }
    },

    onStartTracking: async function () {
      if (!navigator.geolocation) {
        MessageBox.error("This browser does not support geolocation.");
        return;
      }

      try {
        var trip = this._viewModel.getProperty("/currentTrip");

        if (!trip || trip.status !== "ACTIVE") {
          var token = localStorage.getItem("driver_token");
          trip = await this._post(token ? "/drivers/start" : "/tracker/startTrip", {
            title: "Trip " + new Date().toLocaleString()
          });

          this._viewModel.setProperty("/currentTrip", trip);
          this._points = [];
          this._syncPolyline();
        }

        this._viewModel.setProperty("/tracking", true);
        this._viewModel.setProperty("/statusText", "Tracking is live");
        this._viewModel.setProperty("/permissionText", "Location access granted");

        this._watchId = navigator.geolocation.watchPosition(
          this._onPositionSuccess.bind(this),
          this._onPositionError.bind(this),
          {
            enableHighAccuracy: true,
            maximumAge: 2000,
            timeout: 10000
          }
        );

        await this.onRefreshPath();
        MessageToast.show("Trip started");
      } catch (error) {
        MessageBox.error(error.message || "Unable to start tracking.");
      }
    },

    onStopTracking: async function () {
      var trip = this._viewModel.getProperty("/currentTrip");
      if (!trip) {
        return;
      }

      if (this._watchId !== null) {
        navigator.geolocation.clearWatch(this._watchId);
        this._watchId = null;
      }

      try {
        var token = localStorage.getItem("driver_token");
        var stoppedTrip = await this._post(token ? "/drivers/stop" : "/tracker/stopTrip", {
          tripId: trip.ID
        });

        this._viewModel.setProperty("/currentTrip", stoppedTrip);
        this._viewModel.setProperty("/tracking", false);
        this._viewModel.setProperty("/statusText", "Tracking stopped");
        MessageToast.show("Trip stopped");
      } catch (error) {
        MessageBox.error(error.message || "Unable to stop tracking.");
      }
    },

    onRefreshPath: async function () {
      var trip = this._viewModel.getProperty("/currentTrip");
      this._ensureMap();

      if (!trip || !trip.ID) {
        if (this._map) {
          this._map.invalidateSize();
        }
        return;
      }

      try {
        var points = await this._get("/tracker/path/" + trip.ID);
        this._points = (points.value || []).map(function (point) {
          return [Number(point.latitude), Number(point.longitude)];
        });

        var lastPoint = points.value && points.value.length ? points.value[points.value.length - 1] : null;
        this._viewModel.setProperty("/lastPoint", lastPoint);
        this._viewModel.setProperty("/totalPoints", this._points.length);
        this._syncPolyline();
      } catch (error) {
        MessageBox.error(error.message || "Unable to refresh the path.");
      }
    },

    _loadActiveTrip: async function () {
      try {
        var token = localStorage.getItem("driver_token");
        var trip = token
          ? await this._get("/drivers/activeTrip")
          : await this._get("/tracker/activeTrip()");

        if (trip && trip.ID) {
          this._viewModel.setProperty("/currentTrip", trip);
          this._viewModel.setProperty("/statusText", "Active trip restored");
          await this.onRefreshPath();
        } else {
          this._viewModel.setProperty("/statusText", "Backend reachable, no active trip loaded");
        }
      } catch (error) {
        this._viewModel.setProperty("/statusText", "Backend reachable, no active trip loaded");
      }
    },

    _loadUserContext: async function () {
      try {
        var token = localStorage.getItem("driver_token");
        if (token) {
          try {
            var driver = await this._get("/drivers/profile");
            this._viewModel.setProperty("/user", driver);
            this._viewModel.setProperty("/isDriver", true);
            this._viewModel.setProperty("/isAdmin", false);
            await this._loadActiveTrip();
            return;
          } catch (error) {
            localStorage.removeItem("driver_token");
          }
        }

        var user = await this._get("/tracker/me()");
        this._viewModel.setProperty("/user", user);
        this._viewModel.setProperty("/isAdmin", !!user.isAdmin);
        this._viewModel.setProperty("/isDriver", !!user.isDriver);

        if (user.isDriver) {
          await this._loadActiveTrip();
          return;
        }

        if (user.isAdmin) {
          this._viewModel.setProperty("/statusText", "Admin mode");
          this._viewModel.setProperty("/permissionText", "Monitor drivers and review live trips.");
          await this._loadDrivers();
          await this._loadAdminTrips();
          this._startAdminAutoRefresh();
          return;
        }

        this._viewModel.setProperty("/statusText", "No app role assigned");
        this._viewModel.setProperty("/permissionText", "Ask an administrator to assign FleetAdmin or Driver in BTP.");
      } catch (error) {
        this._viewModel.setProperty("/statusText", "Unable to load login context");
        this._viewModel.setProperty("/permissionText", error.message || "Authentication context unavailable");
      }
    },

    _loadDrivers: async function () {
      try {
        var response = await this._get("/tracker/Drivers");
        var drivers = (response.value || []).map(function (driver) {
          var name = driver.name || driver.email || "Driver";
          var parts = name.trim().split(/\s+/);

          return Object.assign({}, driver, {
            initials: parts.length > 1
              ? (parts[0][0] + parts[1][0]).toUpperCase()
              : name.substring(0, 2).toUpperCase(),
            statusState: driver.status === "ACTIVE" ? "Success" : "None",
            latestLat: null,
            latestLng: null,
            lastSeenText: "No live update",
            activeTripId: null
          });
        });

        this._viewModel.setProperty("/drivers", drivers);
        this._viewModel.setProperty("/adminStats/totalDrivers", drivers.length);
        this._viewModel.setProperty("/adminStats/activeDrivers", drivers.filter(function (driver) {
          return driver.status === "ACTIVE";
        }).length);
      } catch (error) {
        MessageBox.error(error.message || "Unable to load drivers.");
      }
    },

    _loadAdminTrips: async function () {
      try {
        var response = await this._get("/tracker/Trips?$expand=driver,points&$orderby=startedAt desc");
        var trips = response.value || [];
        var activeTrips = trips.filter(function (trip) {
          return trip.status === "ACTIVE";
        });

        this._viewModel.setProperty("/adminTrips", trips);
        this._viewModel.setProperty("/adminStats/activeTrips", activeTrips.length);
        this._viewModel.setProperty("/adminStats/completedTrips", trips.filter(function (trip) {
          return trip.status === "COMPLETED";
        }).length);

        this._applyTripDataToDrivers(activeTrips);
        this._renderAdminMarkers(activeTrips);
        this._updateRefreshText();
      } catch (error) {
        MessageBox.error(error.message || "Unable to load admin trips.");
      }
    },

    _applyTripDataToDrivers: function (activeTrips) {
      var drivers = this._viewModel.getProperty("/drivers") || [];

      var updatedDrivers = drivers.map(function (driver) {
        var activeTrip = activeTrips.find(function (trip) {
          return trip.driver && trip.driver.ID === driver.ID;
        });

        if (!activeTrip || !activeTrip.points || !activeTrip.points.length) {
          return driver;
        }

        var latestPoint = activeTrip.points.slice().sort(function (left, right) {
          return new Date(right.recordedAt || 0) - new Date(left.recordedAt || 0);
        })[0];

        return Object.assign({}, driver, {
          latestLat: latestPoint.latitude,
          latestLng: latestPoint.longitude,
          activeTripId: activeTrip.ID,
          lastSeenText: latestPoint.recordedAt
            ? "Last update " + new Date(latestPoint.recordedAt).toLocaleTimeString()
            : "Live"
        });
      });

      this._viewModel.setProperty("/drivers", updatedDrivers);
    },

    _startAdminAutoRefresh: function () {
      if (this._adminRefreshTimer) {
        clearInterval(this._adminRefreshTimer);
      }

      this._adminRefreshTimer = setInterval(function () {
        if (this._viewModel.getProperty("/isAdmin")) {
          this._loadAdminTrips();
        }
      }.bind(this), 8000);
    },

    _updateRefreshText: function () {
      this._viewModel.setProperty("/lastRefreshText", "Updated " + new Date().toLocaleTimeString());
    },

    _buildDriverMarkerIcon: function (driverName, active) {
      var initials = (driverName || "DR")
        .split(/\s+/)
        .map(function (part) {
          return part[0];
        })
        .join("")
        .substring(0, 2)
        .toUpperCase();

      return window.L.divIcon({
        className: "driverMapMarker",
        html: "<span class='" + (active ? "markerLive" : "markerIdle") + "'>" + initials + "</span>",
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
    },

    _renderAdminMarkers: function (activeTrips) {
      this._ensureMap();

      if (!this._map || !window.L) {
        return;
      }

      this._adminMarkers.forEach(function (marker) {
        marker.remove();
      });
      this._adminMarkers = [];

      var markerPoints = [];

      activeTrips.forEach(function (trip) {
        var points = trip.points || [];
        if (!points.length) {
          return;
        }

        var latestPoint = points.slice().sort(function (left, right) {
          return new Date(right.recordedAt || 0) - new Date(left.recordedAt || 0);
        })[0];

        var latLng = [
          Number(latestPoint.latitude),
          Number(latestPoint.longitude)
        ];

        if (!Number.isFinite(latLng[0]) || !Number.isFinite(latLng[1])) {
          return;
        }

        markerPoints.push(latLng);

        var driverName = trip.driver && trip.driver.name ? trip.driver.name : "Driver";
        var title = trip.title || "Active trip";
        var recordedAt = latestPoint.recordedAt ? new Date(latestPoint.recordedAt).toLocaleString() : "-";

        var marker = window.L.marker(latLng, {
          icon: this._buildDriverMarkerIcon(driverName, trip.status === "ACTIVE")
        })
          .addTo(this._map)
          .bindPopup(
            "<strong>" + driverName + "</strong><br>" +
            title + "<br>" +
            "Last update: " + recordedAt
          );

        this._adminMarkers.push(marker);
      }.bind(this));

      if (markerPoints.length > 1) {
        this._map.fitBounds(window.L.latLngBounds(markerPoints), { padding: [24, 24] });
      } else if (markerPoints.length === 1) {
        this._map.setView(markerPoints[0], 15);
      }
    },

    _onPositionSuccess: async function (position) {
      var trip = this._viewModel.getProperty("/currentTrip");
      if (!trip || !trip.ID) {
        return;
      }

      var payload = {
        tripId: trip.ID,
        latitude: Number(position.coords.latitude.toFixed(6)),
        longitude: Number(position.coords.longitude.toFixed(6)),
        accuracy: position.coords.accuracy != null ? Number(position.coords.accuracy.toFixed(2)) : null,
        altitude: position.coords.altitude != null ? Number(position.coords.altitude.toFixed(2)) : null,
        speed: position.coords.speed != null ? Number(position.coords.speed.toFixed(2)) : null,
        heading: position.coords.heading != null ? Number(position.coords.heading.toFixed(2)) : null,
        recordedAt: new Date(position.timestamp).toISOString(),
        source: "browser-geolocation"
      };

      try {
        var token = localStorage.getItem("driver_token");
        var point = await this._post(token ? "/drivers/recordLocation" : "/tracker/recordLocation", payload);
        var latLng = [Number(point.latitude), Number(point.longitude)];

        this._points.push(latLng);
        this._viewModel.setProperty("/lastPoint", point);
        this._viewModel.setProperty("/totalPoints", this._points.length);
        this._viewModel.setProperty("/statusText", "Tracking is live");
        this._syncPolyline(latLng);
      } catch (error) {
        MessageBox.error(error.message || "Unable to persist the current position.");
      }
    },

    _onPositionError: function (error) {
      this._viewModel.setProperty("/permissionText", error.message || "Location permission denied");
      this._viewModel.setProperty("/tracking", false);

      if (this._watchId !== null) {
        navigator.geolocation.clearWatch(this._watchId);
        this._watchId = null;
      }
    },

    _ensureMap: function () {
      var mapContainer = document.getElementById("tracker-map");

      if (!mapContainer) {
        return;
      }

      if (!window.L) {
        this._viewModel.setProperty("/statusText", "Leaflet failed to load");
        return;
      }

      if (this._map) {
        setTimeout(function () {
          this._map.invalidateSize();
        }.bind(this), 150);
        return;
      }

      try {
        this._map = window.L.map(mapContainer, {
          zoomControl: true
        }).setView([20.5937, 78.9629], 5);

        window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors"
        }).addTo(this._map);

        this._polyline = window.L.polyline([], {
          color: "#0a6ed1",
          weight: 5
        }).addTo(this._map);

        setTimeout(function () {
          if (this._map) {
            this._map.invalidateSize();
          }
        }.bind(this), 250);
      } catch (error) {
        this._viewModel.setProperty("/statusText", "Map initialization failed");
      }
    },

    _syncPolyline: function (latestPoint) {
      this._ensureMap();

      if (!this._map || !this._polyline) {
        return;
      }

      this._polyline.setLatLngs(this._points);

      if (latestPoint) {
        if (!this._marker) {
          this._marker = window.L.marker(latestPoint).addTo(this._map);
        } else {
          this._marker.setLatLng(latestPoint);
        }

        this._map.setView(latestPoint, 18);
        return;
      }

      if (this._points.length > 1) {
        this._map.fitBounds(this._polyline.getBounds(), { padding: [20, 20] });
      } else if (this._points.length === 1) {
        if (!this._marker) {
          this._marker = window.L.marker(this._points[0]).addTo(this._map);
        } else {
          this._marker.setLatLng(this._points[0]);
        }

        this._map.setView(this._points[0], 18);
      }

      setTimeout(function () {
        if (this._map) {
          this._map.invalidateSize();
        }
      }.bind(this), 150);
    },

    _get: async function (url) {
      var token = localStorage.getItem("driver_token");
      var headers = Object.assign({ Accept: "application/json" }, token ? { Authorization: "Bearer " + token } : {});
      var response = await fetch(url, { headers: headers });

      if (!response.ok) {
        throw new Error(await this._extractError(response));
      }

      return response.json();
    },

    _post: async function (url, payload) {
      var token = localStorage.getItem("driver_token");
      var headers = Object.assign({ "Content-Type": "application/json", Accept: "application/json" }, token ? { Authorization: "Bearer " + token } : {});
      var response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(await this._extractError(response));
      }

      return response.json();
    },

    _extractError: async function (response) {
      try {
        var data = await response.json();
        return data.error && data.error.message ? data.error.message : response.statusText;
      } catch (error) {
        return response.statusText || "Unknown request error";
      }
    }
  });
});