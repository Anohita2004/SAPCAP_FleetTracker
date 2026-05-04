sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("com.locationtracker.locationtracker.Component", {
    metadata: {
      manifest: "json"
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      this.setModel(new JSONModel({
        busy: false,
        tracking: false,
        user: null,
        isAdmin: false,
        isDriver: false,
        driverDraft: {
          name: "",
          email: "",
          phone: ""
        },
        currentTrip: null,
        totalPoints: 0,
        lastPoint: null,
        statusText: "Tracking is idle",
        permissionText: "Awaiting browser location permission"
      }), "view");

      this.getRouter().initialize();
    }
  });
});
