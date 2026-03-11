(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function createRefs(db) {
    return {
      users: db.collection("users"),
      serviceTypes: db.collection("serviceTypes"),
      requests: db.collection("requests"),
      requestAddresses: db.collection("requestAddresses"),
      requestServices: db.collection("requestServices"),
      appointments: db.collection("appointments"),
      holds: db.collection("holds"),
      holdSlots: db.collection("holdSlots"),
      bookings: db.collection("bookings"),
      publicSlots: db.collection("publicSlots"),
      freeSlots: db.collection("freeSlots"),
      syncHealth: db.collection("syncHealth"),
      outbox: db.collection("outbox"),
    };
  }

  root.firestoreRefs = {
    createRefs,
  };
})();
