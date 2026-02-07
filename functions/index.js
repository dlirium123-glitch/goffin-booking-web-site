const {setGlobalOptions} = require("firebase-functions");
const {onDocumentCreated, onDocumentDeleted} =
  require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({maxInstances: 10});

const db = admin.firestore();

/**
 * Quand un slot est créé -> on crée un busySlot public (anonyme)
 */
exports.onSlotCreated = onDocumentCreated("slots/{slotId}", async (event) => {
  const slotId = event.params.slotId;

  const snap = event.data; // DocumentSnapshot
  if (!snap) return;

  const data = snap.data();
  if (!data) return;

  await db.collection("busySlots").doc(slotId).set({
    start: data.start,
    end: data.end,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
});

/**
 * Quand un slot est supprimé -> on supprime le busySlot
 */
exports.onSlotDeleted = onDocumentDeleted("slots/{slotId}", async (event) => {
  const slotId = event.params.slotId;

  await db.collection("busySlots").doc(slotId).delete().catch(() => null);
});
