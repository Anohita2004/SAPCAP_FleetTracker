sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (Controller, MessageToast, MessageBox) {
  "use strict";

  return Controller.extend("com.locationtracker.locationtracker.controller.Reports", {
    onInit: function () {
      this._viewModel = this.getOwnerComponent().getModel('view');
      this._viewModel.setProperty('/scheduledReports', []);
      this._loadScheduled();
    },

    _fetch: async function (url, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
      // Ensure Content-Type for JSON bodies when not explicitly provided
      if (opts.body && !opts.headers['Content-Type'] && !opts.headers['content-type']) {
        opts.headers['Content-Type'] = 'application/json';
      }
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },

    _loadScheduled: async function () {
      try {
        const resp = await this._fetch('/tracker/listScheduledReports', { method: 'POST', body: '{}' });
        this._viewModel.setProperty('/scheduledReports', resp || []);
      } catch (e) {
        // ignore
      }
    },

    onRefresh: function () { this._loadScheduled(); MessageToast.show('Refreshed'); },

    onOpenSchedule: function () { this.byId('scheduleDialog').open(); },
    onCloseSchedule: function () { this.byId('scheduleDialog').close(); },

    onCreateSchedule: async function () {
      try {
        const name = this.byId('rName').getValue();
        const entity = this.byId('rEntity').getSelectedKey();
        const format = this.byId('rFormat').getSelectedKey();
        const interval = Number(this.byId('rInterval').getValue()) || 60;
        if (!name || !entity) return MessageToast.show('Name and entity required');

        const payload = { name, entityName: entity, format, intervalMin: interval };
        await this._fetch('/tracker/scheduleReport', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        MessageToast.show('Schedule created');
        this.byId('scheduleDialog').close();
        this._loadScheduled();
      } catch (err) {
        MessageBox.error(err.message || 'Unable to create schedule');
      }
    },

    onCancel: async function (oEvent) {
      try {
        const ctx = oEvent.getSource().getBindingContext('view');
        const id = ctx.getObject().ID;
        await this._fetch('/tracker/cancelScheduledReport', { method: 'POST', body: JSON.stringify({ reportId: id }), headers: { 'Content-Type': 'application/json' } });
        MessageToast.show('Cancelled');
        this._loadScheduled();
      } catch (e) { MessageBox.error(e.message || 'Cancel failed'); }
    },

    onDownload: async function (oEvent) {
      try {
        const btn = oEvent.getSource();
        const ctx = btn && btn.getBindingContext && btn.getBindingContext('view');
        const obj = ctx && ctx.getObject ? ctx.getObject() : null;
        const id = obj && obj.ID ? obj.ID : null;
        if (!id) {
          return MessageBox.error('No report selected or missing report ID');
        }

        const res = await fetch('/tracker/generateReport', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/plain' }, body: JSON.stringify({ reportId: id }) });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(txt || 'Server error');
        }

        const text = await res.text();
        if ((obj && obj.format) === 'PDF') {
          const a = document.createElement('a');
          a.href = 'data:application/pdf;base64,' + text;
          a.download = (obj.name || 'report') + '.pdf';
          document.body.appendChild(a); a.click(); a.remove();
          return;
        }

        // CSV
        const csv = text;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = (obj.name || 'report') + '.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } catch (err) { MessageBox.error(err.message || 'Download failed'); }
    }
  });
});
