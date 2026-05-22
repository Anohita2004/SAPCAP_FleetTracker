sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast"
], function (Controller, MessageToast) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.DispatcherDashboard", {
    onInit: function () {
      this._viewModel = this.getOwnerComponent().getModel("view");

      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl._loadAdminTrips) {
        try { appCtrl._loadAdminTrips(); } catch (e) {}
      }
    },

    onRefresh: function () {
      var appCtrl = this.getOwnerComponent().getRootControl().getController && this.getOwnerComponent().getRootControl().getController();
      if (appCtrl && appCtrl._loadAdminTrips) {
        try { appCtrl._loadAdminTrips(); MessageToast.show('Dispatcher data refreshed'); } catch (e) { MessageToast.show('Refresh failed'); }
        return;
      }

      try { this._viewModel.setProperty('/lastRefreshText', 'Refreshed ' + new Date().toLocaleTimeString()); MessageToast.show('Dispatcher refreshed'); } catch (e) {}
    },

    onCreateTrip: function () {
      MessageToast.show('Create trip - not yet implemented');
    },

    onAssign: function () {
      MessageToast.show('Assign driver - not yet implemented');
    },

    onTrack: function () {
      MessageToast.show('Open trip on map');
    }
  });
});
