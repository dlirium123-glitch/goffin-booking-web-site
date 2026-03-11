(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  const REQUEST_STATUSES = Object.freeze(["pending", "scheduled", "completed", "cancelled"]);
  const EMAIL_STATUSES = Object.freeze(["pending", "sent", "failed"]);
  const OUTLOOK_STATUSES = Object.freeze(["not_created", "created", "cancelled"]);

  const STATUS_LABELS = Object.freeze({
    pending: "En attente",
    scheduled: "Planifie",
    completed: "Termine",
    cancelled: "Annule",
    sent: "Envoye",
    failed: "Echec",
    not_created: "Non cree",
    created: "Cree",
  });

  function isKnownStatus(status, allowedStatuses) {
    return allowedStatuses.includes(String(status || ""));
  }

  function getStatusLabel(status) {
    return STATUS_LABELS[String(status || "")] || String(status || "");
  }

  root.statuses = {
    REQUEST_STATUSES,
    ADDRESS_STATUSES: REQUEST_STATUSES,
    APPOINTMENT_STATUSES: REQUEST_STATUSES,
    EMAIL_STATUSES,
    OUTLOOK_STATUSES,
    STATUS_LABELS,
    isKnownStatus,
    getStatusLabel,
  };
})();
