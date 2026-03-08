/* public/shared.js — Utilitaires partagés client + admin */
(function () {
  "use strict";

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** slotId = YYYYMMDD_HHMM */
  function slotIdFromDate(d) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    return `${yyyy}${mm}${dd}_${hh}${mi}`;
  }

  function dateFromSlotId(slotId) {
    const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(String(slotId || ""));
    if (!m) return null;
    const yy = Number(m[1]);
    const mo = Number(m[2]);
    const dd = Number(m[3]);
    const hh = Number(m[4]);
    const mi = Number(m[5]);
    const date = new Date(yy, mo - 1, dd, hh, mi, 0, 0);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }

  function isWeekend(d) {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  /** Semaine lun–dim à partir d’une date d’ancrage */
  function computeWeekRange(anchorDate) {
    const d = startOfDay(anchorDate);
    const day = d.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = addDays(d, diffToMonday);
    const sunday = addDays(monday, 7);
    return { start: monday, end: sunday };
  }

  function assertFirebaseLoaded() {
    if (!window.firebase) throw new Error("Firebase SDK non chargé (firebase global manquant).");
    if (!firebase.auth) throw new Error("firebase-auth-compat non chargé.");
    if (!firebase.firestore) throw new Error("firebase-firestore-compat non chargé.");
  }

  function getApp() {
    assertFirebaseLoaded();
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp({});
    }
    return firebase.app();
  }

  function getServices() {
    getApp();
    const auth = firebase.auth();
    const db = firebase.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return { auth, db };
  }

  window.GoffinBooking = {
    escapeHtml,
    pad2,
    slotIdFromDate,
    dateFromSlotId,
    startOfDay,
    addDays,
    isWeekend,
    computeWeekRange,
    assertFirebaseLoaded,
    getApp,
    getServices,
  };
})();
