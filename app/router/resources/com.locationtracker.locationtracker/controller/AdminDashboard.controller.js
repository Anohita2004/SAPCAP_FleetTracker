sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast"
], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.AdminDashboard", {
    onInit: function () {
      this._viewModel = this.getOwnerComponent().getModel("view");

      // attempt to reuse App controller methods for loading data and sockets
      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl) {
        try {
          if (appCtrl._loadDrivers) appCtrl._loadDrivers();
          if (appCtrl._loadAdminTrips) appCtrl._loadAdminTrips();
          if (appCtrl._startAdminAutoRefresh) appCtrl._startAdminAutoRefresh();
          if (appCtrl._startAdminSocket) appCtrl._startAdminSocket();
        } catch (e) {
          // ignore
        }
      }
    },

    onExit: function () {
      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl._stopAdminSocket) {
        try { appCtrl._stopAdminSocket(); } catch (e) {}
      }
    },

    onRefresh: function () {
      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl._loadDrivers && appCtrl._loadAdminTrips) {
        appCtrl._loadDrivers();
        appCtrl._loadAdminTrips();
        MessageToast.show("Refreshing fleet data...");
        return;
      }

      try { this._viewModel.setProperty('/lastRefreshText', 'Refreshed ' + new Date().toLocaleTimeString()); MessageToast.show('Refreshed'); } catch (e) {}
    }
  });
});
