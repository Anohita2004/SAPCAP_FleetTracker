sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.Login", {
    onInit: function () {
      this._viewModel = this.getOwnerComponent().getModel("view");
      this._viewModel.setProperty("/login", { email: "", password: "", mode: null });

      this._checkBtpLogin();
    },

    onSelectDriver: function () {
      this._viewModel.setProperty("/login/mode", "driver");
    },

    onSelectAdmin: function () {
      this._viewModel.setProperty("/login/mode", "admin");
    },

    onBackToChoice: function () {
      this._viewModel.setProperty("/login/mode", null);
    },

onAdminLogin: function () {
  const deployedLoginTrigger =
    "https://8cdc8e79trial-dev-location-tracker-approuter.cfapps.ap21.hana.ondemand.com/tracker/me()";

  const isLocal =
    window.location.hostname.includes("localhost") ||
    window.location.hostname.includes("applicationstudio.cloud.sap") ||
    window.location.hostname.startsWith("port4004");

  window.location.assign(isLocal ? deployedLoginTrigger : "/tracker/me()");
},


_checkBtpLogin: async function () {
  try {
    const res = await fetch("/tracker/me()", {
      headers: { Accept: "application/json" }
    });

    const contentType = res.headers.get("content-type") || "";
    if (!res.ok || contentType.indexOf("application/json") === -1) {
      return;
    }

    const user = await res.json();

    this._viewModel.setProperty("/user", user);
    this._viewModel.setProperty("/isAdmin", !!user.isAdmin);
    this._viewModel.setProperty("/isDriver", !!user.isDriver);

    if (user.isAdmin || user.isDriver) {
      this.getOwnerComponent().getRouter().navTo("RouteApp");
    }
  } catch (err) {
    // Stay on login page when not authenticated through XSUAA.
  }
},



    onLogin: async function () {
      const creds = this._viewModel.getProperty("/login") || {};

      try {
        const res = await fetch("/drivers/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: creds.email, password: creds.password })
        });

        if (!res.ok) throw new Error(await res.text());

        const data = await res.json();
        localStorage.setItem("driver_token", data.token);
        this._viewModel.setProperty("/user", data.driver);
        this._viewModel.setProperty("/isDriver", true);

        MessageToast.show("Welcome " + (data.driver && data.driver.name));
        this.getOwnerComponent().getRouter().navTo("RouteApp");
      } catch (err) {
        MessageBox.error(err.message || "Login failed");
      }
    },

    onRegister: function () {
      MessageToast.show("Use the admin UI to register drivers or implement in-app registration.");
    }
  });
});

