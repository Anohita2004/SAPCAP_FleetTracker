sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast"
], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.DriverDashboard", {
    onInit: function () {
      this._viewModel = this.getOwnerComponent().getModel("view");

      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl._loadActiveTrip) {
        try { appCtrl._loadActiveTrip(); } catch (e) {}
      }
    },

    onStartTracking: function () {
      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl.onStartTracking) {
        appCtrl.onStartTracking();
        return;
      }
      MessageToast.show('Starting trip...');
    },

    onStopTracking: function () {
      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl.onStopTracking) {
        appCtrl.onStopTracking();
        return;
      }
      MessageToast.show('Stopping trip...');
    }
  });
});
