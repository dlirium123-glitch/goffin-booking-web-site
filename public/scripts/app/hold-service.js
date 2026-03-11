(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function buildHoldId(userId, addressTempKey) {
    return `hold_${String(userId || "").slice(0, 10)}_${String(addressTempKey || "").slice(0, 24)}`;
  }

  async function createOrReplaceHold({ db, auth, refs, address, sequence }) {
    const user = auth.currentUser;
    if (!user) throw new Error("Utilisateur non connecte.");
    if (!address || !sequence || !Array.isArray(sequence.slotIds) || sequence.slotIds.length === 0) {
      throw new Error("Selection de creneau invalide.");
    }

    const holdId = address.holdId || buildHoldId(user.uid, address.tempKey || address.id);
    const holds = refs(db).holds;
    const holdSlots = refs(db).holdSlots;
    const nowServer = firebase.firestore.FieldValue.serverTimestamp();
    const expiresAt = firebase.firestore.Timestamp.fromMillis(Date.now() + 20 * 60 * 1000);
    const oldSlotIds = Array.isArray(address.holdSlotIds) ? address.holdSlotIds : [];
    const newSlotIds = sequence.slotIds.slice();

    await holds.doc(holdId).set(
      {
        uid: user.uid,
        requestAddressTempKey: address.tempKey || address.id,
        slotIds: newSlotIds,
        start: firebase.firestore.Timestamp.fromDate(sequence.startDate),
        end: firebase.firestore.Timestamp.fromDate(sequence.endDate),
        expiresAt,
        status: "hold",
        createdAt: nowServer,
        updatedAt: nowServer,
      },
      { merge: true }
    )

    await db.runTransaction(async (tx) => {
      for (const slotId of newSlotIds) {
        const slotRef = holdSlots.doc(slotId);
        const snap = await tx.get(slotRef);
        if (snap.exists) {
          const data = snap.data() || {};
          const active = data.expiresAt?.toMillis?.() > Date.now();
          if (active && data.holdId !== holdId) {
            throw new Error("Un des creneaux est deja verrouille par une autre demande.");
          }
        }
      }

      for (const slot of sequence.slots || []) {
        tx.set(
          holdSlots.doc(slot.id),
          {
            holdId,
            start: slot.start,
            end: slot.end,
            expiresAt,
            status: "hold",
            createdAt: nowServer,
            updatedAt: nowServer,
          },
          { merge: true }
        );
      }

      for (const oldSlotId of oldSlotIds) {
        if (!newSlotIds.includes(oldSlotId)) {
          tx.delete(holdSlots.doc(oldSlotId));
        }
      }
    });

    return {
      holdId,
      holdSlotIds: newSlotIds,
      expiresAt,
    };
  }

  async function releaseHold({ db, refs, address }) {
    if (!address?.holdId) return;
    const holds = refs(db).holds;
    const holdSlots = refs(db).holdSlots;
    const batch = db.batch();

    (address.holdSlotIds || []).forEach((slotId) => batch.delete(holdSlots.doc(slotId)));
    batch.delete(holds.doc(address.holdId));
    await batch.commit();
  }

  root.holdService = {
    buildHoldId,
    createOrReplaceHold,
    releaseHold,
  };
})();
