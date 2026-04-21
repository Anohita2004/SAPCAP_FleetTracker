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
      this._viewModel = this.getOwnerComponent().getModel("view");

      this.getView().addEventDelegate({
        onAfterShow: this._ensureMap.bind(this)
      });

      this._loadActiveTrip();
    },

    onStartTracking: async function () {
      if (!navigator.geolocation) {
        MessageBox.error("This browser does not support geolocation.");
        return;
      }

      try {
        let trip = this._viewModel.getProperty("/currentTrip");

        if (!trip || trip.status !== "ACTIVE") {
          trip = await this._post("/tracker/startTrip", {
            title: `Trip ${new Date().toLocaleString()}`
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
      const trip = this._viewModel.getProperty("/currentTrip");
      if (!trip) {
        return;
      }

      if (this._watchId !== null) {
        navigator.geolocation.clearWatch(this._watchId);
        this._watchId = null;
      }

      try {
        const stoppedTrip = await this._post("/tracker/stopTrip", { tripId: trip.ID });
        this._viewModel.setProperty("/currentTrip", stoppedTrip);
        this._viewModel.setProperty("/tracking", false);
        this._viewModel.setProperty("/statusText", "Tracking stopped");
        MessageToast.show("Trip stopped");
      } catch (error) {
        MessageBox.error(error.message || "Unable to stop tracking.");
      }
    },

    onRefreshPath: async function () {
      const trip = this._viewModel.getProperty("/currentTrip");
      if (!trip || !trip.ID) {
        return;
      }

      try {
        const points = await this._get(`/tracker/path/${trip.ID}`);
        this._points = (points.value || []).map(function (point) {
          return [Number(point.latitude), Number(point.longitude)];
        });

        const lastPoint = points.value && points.value.length ? points.value[points.value.length - 1] : null;
        this._viewModel.setProperty("/lastPoint", lastPoint);
        this._viewModel.setProperty("/totalPoints", this._points.length);
        this._syncPolyline();
      } catch (error) {
        MessageBox.error(error.message || "Unable to refresh the path.");
      }
    },

    _loadActiveTrip: async function () {
      try {
        const trip = await this._get("/tracker/activeTrip()");
        if (trip && trip.ID) {
          this._viewModel.setProperty("/currentTrip", trip);
          this._viewModel.setProperty("/statusText", "Active trip restored");
          await this.onRefreshPath();
        }
      } catch (error) {
        this._viewModel.setProperty("/statusText", "Backend reachable, no active trip loaded");
      }
    },

    _onPositionSuccess: async function (position) {
      const trip = this._viewModel.getProperty("/currentTrip");
      if (!trip || !trip.ID) {
        return;
      }

      const payload = {
        tripId: trip.ID,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude,
        speed: position.coords.speed,
        heading: position.coords.heading,
        recordedAt: new Date(position.timestamp).toISOString(),
        source: "browser-geolocation"
      };

      try {
        const point = await this._post("/tracker/recordLocation", payload);
        const latLng = [Number(point.latitude), Number(point.longitude)];
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
      if (this._map || !window.L) {
        return;
      }

      const mapContainer = document.getElementById("tracker-map");
      if (!mapContainer) {
        return;
      }

      this._map = window.L.map(mapContainer).setView([20.5937, 78.9629], 5);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(this._map);

      this._polyline = window.L.polyline([], {
        color: "#0a6ed1",
        weight: 5
      }).addTo(this._map);

      setTimeout(function () {
        this._map.invalidateSize();
      }.bind(this), 0);
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
      } else if (this._points.length) {
        this._map.fitBounds(this._polyline.getBounds(), { padding: [20, 20] });
      }
    },

    _get: async function (url) {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(await this._extractError(response));
      }

      return response.json();
    },

    _post: async function (url, payload) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(await this._extractError(response));
      }

      return response.json();
    },

    _extractError: async function (response) {
      try {
        const data = await response.json();
        return data.error && data.error.message ? data.error.message : response.statusText;
      } catch (error) {
        return response.statusText || "Unknown request error";
      }
    }
  });
});