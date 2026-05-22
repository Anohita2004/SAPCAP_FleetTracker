sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.Dashboard", {
    onInit: function () {
      var vm = this.getOwnerComponent().getModel("view");
      var router = this.getOwnerComponent().getRouter();

      // small delay to ensure user context is loaded
      setTimeout(function () {
        if (vm.getProperty('/isAdmin')) {
          router.navTo('RouteAdminDashboard');
        } else if (vm.getProperty('/isDispatcher')) {
          router.navTo('RouteDispatcherDashboard');
        } else if (vm.getProperty('/isDriver')) {
          router.navTo('RouteDriverDashboard');
        } else {
          router.navTo('RouteApp');
        }
      }, 10);
    }
  });
});
