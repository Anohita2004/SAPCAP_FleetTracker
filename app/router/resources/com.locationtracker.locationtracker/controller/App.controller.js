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
      this._adminMarkers = []; // legacy array used in some places
      this._adminMarkerMap = {}; // driverId -> Leaflet marker
      this._adminPolylineMap = {}; // tripId -> Leaflet polyline
      this._driverColorMap = {};
      this._adminRefreshTimer = null;
      this._adminSocket = null;
      this._viewModel = this.getOwnerComponent().getModel("view");

      // expose highlight hook for other controllers
      window.__highlightAdminTrip = this._highlightTrip ? this._highlightTrip.bind(this) : null;
      // ensure cleanup on exit
      var originalOnExit = this.onExit.bind(this);
      this.onExit = function () {
        try { if (window.__highlightAdminTrip) delete window.__highlightAdminTrip; } catch (e) {}
        originalOnExit();
      }.bind(this);

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
          this._startAdminSocket();
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

    _buildDriverMarkerIcon: function (driverName, active, size) {
      // size default
      var s = size || 36;
      var anchor = Math.round(s/2);
      var cls = active ? "markerLiveIcon" : "markerIdleIcon";
      return window.L.icon({
        iconUrl: "img/truck.svg",
        iconSize: [s, s],
        iconAnchor: [anchor, anchor],
        className: cls
      });
    },

    _startAdminSocket: async function () {
      if (this._adminSocket) return;
      try {
        // Request a short-lived WS token from the backend via CDS action
        var tokenResponse = null;
        try {
          tokenResponse = await this._post('/tracker/issueWsToken', {});
        } catch (err) {
          // If action not available or failed, fall back to existing token behavior
          tokenResponse = null;
        }

        var token = tokenResponse && tokenResponse.token ? tokenResponse.token : (localStorage.getItem('admin_token') || localStorage.getItem('driver_token') || null);

        var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        var host = window.location.hostname;
        var port = window.location.port ? (Number(window.location.port) + 2) : 4006; // default WS port 4006
        var url = protocol + "//" + host + ":" + port + (token ? ('?access_token=' + encodeURIComponent(token)) : '');

        this._adminSocket = new WebSocket(url);

        this._adminSocket.addEventListener('open', function () {
          // If token wasn't provided via URL, try to send it in an auth message
          if (!token) {
            var user = this._viewModel.getProperty('/user') || {};
            if (localStorage.getItem('admin_token') || localStorage.getItem('driver_token')) {
              var t = localStorage.getItem('admin_token') || localStorage.getItem('driver_token');
              this._adminSocket.send(JSON.stringify({ type: 'auth', token: t }));
              return;
            }

            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || !window.location.hostname) {
              this._adminSocket.send(JSON.stringify({ type: 'auth', adminEmail: user.email }));
            }
          }
        }.bind(this));

        this._adminSocket.addEventListener('message', function (evt) {
          try {
            var data = JSON.parse(evt.data);
            if (data && data.type === 'location') {
              this._handleRealtimeLocation(data);
            }
          } catch (e) {
            // ignore
          }
        }.bind(this));

        this._adminSocket.addEventListener('close', function () {
          this._adminSocket = null;
        }.bind(this));
      } catch (e) {
        // ignore
      }
    },

    _stopAdminSocket: function () {
      if (this._adminSocket) {
        try { this._adminSocket.close(); } catch (e) {}
        this._adminSocket = null;
      }
    },

    _handleRealtimeLocation: function (data) {
      if (!data || !data.driverId) return;
      var drivers = this._viewModel.getProperty('/drivers') || [];
      var idx = drivers.findIndex(function (d) { return d.ID === data.driverId; });
      if (idx !== -1) {
        drivers[idx].latestLat = data.latitude;
        drivers[idx].latestLng = data.longitude;
        drivers[idx].lastSeenText = data.recordedAt ? ('Last update ' + new Date(data.recordedAt).toLocaleTimeString()) : 'Live';
        drivers[idx].activeTripId = data.tripId || drivers[idx].activeTripId;
        this._viewModel.setProperty('/drivers', drivers);
      }

      // update or create marker
      try {
        var latLng = [Number(data.latitude), Number(data.longitude)];
        var driverId = data.driverId;
        var marker = this._adminMarkerMap[driverId];
        var driverName = (drivers[idx] && drivers[idx].name) ? drivers[idx].name : 'Driver';

        if (marker && this._map) {
          marker.setLatLng(latLng);
          if (marker.getPopup) {
            marker.setPopupContent('<strong>' + driverName + '</strong><br>' + (data.recordedAt ? new Date(data.recordedAt).toLocaleString() : '-') );
          }
        } else if (this._map) {
          marker = window.L.marker(latLng, { icon: this._buildDriverMarkerIcon(driverName, true, 36) })
            .addTo(this._map)
            .bindPopup('<strong>' + driverName + '</strong><br>' + (data.recordedAt ? new Date(data.recordedAt).toLocaleString() : '-'));
          this._adminMarkerMap[driverId] = marker;
        }

        // update or create polyline for driver (keyed by tripId)
        try {
          var tripKey = data.tripId;
          var entry = this._adminPolylineMap[tripKey];
          if (entry && entry.poly && entry.poly.addLatLng) {
            entry.poly.addLatLng(latLng);
          } else if (this._map) {
            // create with driver's color
            var color = this._getColorForDriver(driverId);
            var p = window.L.polyline([latLng], { color: color, weight: 4, opacity: 0.9 }).addTo(this._map);
            this._adminPolylineMap[tripKey] = { poly: p, driverId: driverId };
          }

          // if this trip is selected, emphasize it
          var selectedTrip = this._viewModel.getProperty('/selectedAdminTripId');
          if (selectedTrip && selectedTrip === tripKey) {
            try { this._adminPolylineMap[tripKey].poly.setStyle({ color: '#ff6600', weight: 6, opacity: 1 }); this._adminPolylineMap[tripKey].poly.bringToFront(); } catch (e) {}
          } else {
            // ensure normal style
            try { this._adminPolylineMap[tripKey].poly.setStyle({ color: this._getColorForDriver(driverId), weight: 4, opacity: 0.9 }); } catch (e) {}
          }
        } catch (e) {
          // ignore polyline errors
        }
      } catch (e) {
        // ignore map errors
      }
    },

    _getColorForDriver: function (driverId) {
      if (!driverId) return '#0a6ed1';
      if (this._driverColorMap[driverId]) return this._driverColorMap[driverId];
      var palette = ['#0a6ed1','#1f9e3a','#ff6f61','#8e44ad','#f39c12','#16a085','#34495e','#c0392b'];
      var hash = 0;
      for (var i=0;i<driverId.length;i++) { hash = ((hash<<5)-hash) + driverId.charCodeAt(i); hash |= 0; }
      var color = palette[Math.abs(hash) % palette.length];
      this._driverColorMap[driverId] = color;
      return color;
    },

    _highlightTrip: function (tripId) {
      // set selectedAdminTripId for other logic
      this._viewModel.setProperty('/selectedAdminTripId', tripId);
      Object.keys(this._adminPolylineMap).forEach(function (k) {
        var entry = this._adminPolylineMap[k];
        try {
          if (k === tripId) {
            entry.poly.setStyle({ color: '#ff6600', weight: 6, opacity: 1 });
            entry.poly.bringToFront();
            // enlarge marker for this driver
            var m = this._adminMarkerMap[entry.driverId];
            if (m && m.setIcon) {
              var drivers = this._viewModel.getProperty('/drivers') || [];
              var d = drivers.find(function(dd){ return dd.ID === entry.driverId; }) || {};
              m.setIcon(this._buildDriverMarkerIcon(d.name || d.email || 'Driver', true, 48));
            }
          } else {
            var driverColor = this._getColorForDriver(entry.driverId);
            entry.poly.setStyle({ color: driverColor, weight: 4, opacity: 0.6 });
            // reset marker size
            var m2 = this._adminMarkerMap[entry.driverId];
            if (m2 && m2.setIcon) {
              var drivers2 = this._viewModel.getProperty('/drivers') || [];
              var d2 = drivers2.find(function(dd){ return dd.ID === entry.driverId; }) || {};
              m2.setIcon(this._buildDriverMarkerIcon(d2.name || d2.email || 'Driver', true, 36));
            }
          }
        } catch (e) {}
      }.bind(this));
    },



    _renderAdminMarkers: function (activeTrips) {
      this._ensureMap();

      if (!this._map || !window.L) {
        return;
      }

      // remove old markers
      this._adminMarkers.forEach(function (marker) {
        marker.remove();
      });
      this._adminMarkers = [];

      // remove old polylines
      Object.keys(this._adminPolylineMap).forEach(function (k) {
        try { var entry = this._adminPolylineMap[k]; if (entry && entry.poly && entry.poly.remove) entry.poly.remove(); } catch (e) {}
      }.bind(this));
      this._adminPolylineMap = {};

      var markerPoints = [];

      activeTrips.forEach(function (trip) {
        var points = trip.points || [];
        if (!points.length) {
          return;
        }

        // build full polyline for the trip
        var latLngs = points.slice().sort(function (left, right) {
          return new Date(left.recordedAt || 0) - new Date(right.recordedAt || 0);
        }).map(function (p) { return [Number(p.latitude), Number(p.longitude)]; }).filter(function (ll) { return Number.isFinite(ll[0]) && Number.isFinite(ll[1]); });

        if (!latLngs.length) return;

        var latestPoint = latLngs[latLngs.length - 1];

        var driverName = trip.driver && trip.driver.name ? trip.driver.name : "Driver";
        var title = trip.title || "Active trip";
        var recordedAt = (trip.points && trip.points.length && trip.points.slice().sort(function (a,b){return new Date(b.recordedAt||0)-new Date(a.recordedAt||0)})[0].recordedAt) ? new Date(trip.points.slice().sort(function (a,b){return new Date(b.recordedAt||0)-new Date(a.recordedAt||0)})[0].recordedAt).toLocaleString() : "-";

        // create polyline and store it per driver
        try {
          var driverId = trip.driver && trip.driver.ID ? trip.driver.ID : (trip.driver_ID || trip.driverId);
        var color = this._getColorForDriver(driverId);
        var poly = window.L.polyline(latLngs, { color: color, weight: 4, opacity: 0.9 }).addTo(this._map);
        var tripId = trip.ID || trip.ID;
        if (tripId) {
          this._adminPolylineMap[tripId] = { poly: poly, driverId: driverId };
        }
        } catch (e) {
          // ignore
        }

        var marker = window.L.marker(latestPoint, {
          icon: this._buildDriverMarkerIcon(driverName, trip.status === "ACTIVE", 36)
        })
          .addTo(this._map)
          .bindPopup(
            "<strong>" + driverName + "</strong><br>" +
            title + "<br>" +
            "Last update: " + recordedAt
          );

        markerPoints.push(latestPoint);
        this._adminMarkers.push(marker);
        // if admin has selected this trip, highlight it
        var selected = this._viewModel.getProperty('/selectedAdminTripId');
        if (selected && (selected === trip.ID)) {
          try { poly.setStyle({ color: '#ff6600', weight: 6, opacity: 1 }); poly.bringToFront(); } catch (e) {}
        }
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