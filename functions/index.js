/**
 * functions/index.js
 * ✅ Sync "slots" (locks privés) -> "busySlots" (public/anonyme)
 * - AUCUNE info sensible (pas d'uid/email)
 * - Support: create / update / delete
 *
 * Dépendances: firebase-admin, firebase-functions (v2)
 */

const { setGlobalOptions } = require("firebase-functions");
const {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentDeleted,
} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

// Init
admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const db = admin.firestore();

/**
 * Convertit un doc "slots" -> payload "busySlots" anonyme
 * ⚠️ Ne met PAS d'uid/email.
 * ✅ On garde éventuellement appointmentId si tu veux l'utiliser plus tard (sinon mets KEEP_APPOINTMENT_ID=false)
 */
const KEEP_APPOINTMENT_ID = true;

function buildBusySlotPayload(slotData) {
  const payload = {
    start: slotData.start,
    end: slotData.end,
    status: slotData.status || "booked",        // debug / info
    source: slotData.source || "booking",       // "booking" | "outlook" | "manual"
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (KEEP_APPOINTMENT_ID) {
    payload.appointmentId = slotData.appointmentId || null;
  }

  return payload;
}

/**
 * Quand un lock (slots/{slotId}) est créé -> crée/met à jour busySlots/{slotId}
 * ✅ On publie seulement si status === "booked" ET start/end existent
 */
exports.onSlotCreated = onDocumentCreated("slots/{slotId}", async (event) => {
  const slotId = event.params.slotId;
  const snap = event.data;
  if (!snap) return;

  const data = snap.data();
  if (!data) return;

  // Sécurité: intervalle obligatoire
  if (!data.start || !data.end) return;

  // Option stricte: publier uniquement les slots "booked"
  if ((data.status || "booked") !== "booked") return;

  const ref = db.collection("busySlots").doc(slotId);

  await ref.set(
    {
      ...buildBusySlotPayload(data),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
});

/**
 * Quand un lock (slots/{slotId}) est modifié -> synchronise busySlots/{slotId}
 * - si plus "booked" => supprime busySlots (anti-busy fantôme)
 * - si start/end changent => met à jour
 */
exports.onSlotUpdated = onDocumentUpdated("slots/{slotId}", async (event) => {
  const slotId = event.params.slotId;

  const afterSnap = event.data?.after;
  if (!afterSnap) return;

  const after = afterSnap.data();
  if (!after) return;

  const ref = db.collection("busySlots").doc(slotId);

  const status = after.status || "booked";
  if (status !== "booked") {
    await ref.delete().catch(() => null);
    return;
  }

  // Si start/end manquent => on supprime (évite un busySlots incomplet)
  if (!after.start || !after.end) {
    await ref.delete().catch(() => null);
    return;
  }

  await ref.set(buildBusySlotPayload(after), { merge: true });
});

/**
 * Quand un lock (slots/{slotId}) est supprimé -> supprime busySlots/{slotId}
 */
exports.onSlotDeleted = onDocumentDeleted("slots/{slotId}", async (event) => {
  const slotId = event.params.slotId;

  await db.collection("busySlots").doc(slotId).delete().catch(() => null);
});
