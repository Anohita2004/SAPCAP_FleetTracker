sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.Login", {
    onInit: function () {
      this._viewModel = this.getOwnerComponent().getModel("view");
      this._viewModel.setProperty('/login', { email: '', password: '' });
    },

    onLogin: async function () {
      const creds = this._viewModel.getProperty('/login') || {};
      try {
        const res = await fetch('/drivers/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ email: creds.email, password: creds.password })
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        localStorage.setItem('driver_token', data.token);
        this._viewModel.setProperty('/user', data.driver);
        this._viewModel.setProperty('/isDriver', true);
        MessageToast.show('Welcome ' + data.driver.name);
        this.getOwnerComponent().getRouter().navTo('RouteApp');
      } catch (err) {
        MessageBox.error(err.message || 'Login failed');
      }
    },

    onRegister: function () {
      MessageToast.show('Use the admin UI to register drivers or implement in-app registration.');
    }
  });
});