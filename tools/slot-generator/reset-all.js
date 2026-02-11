/* eslint-disable no-console */
const { Firestore } = require("@google-cloud/firestore");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function optEnv(name) {
  const v = process.env[name];
  return v ? String(v).trim() : "";
}

async function deleteCollection(db, collectionPath, { batchSize = 400, keepIds = new Set() } = {}) {
  const col = db.collection(collectionPath);

  while (true) {
    const snap = await col.orderBy("__name__").limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    let delCount = 0;

    for (const doc of snap.docs) {
      if (keepIds.has(doc.id)) continue;
      batch.delete(doc.ref);
      delCount++;
    }

    // Si on n'a rien à supprimer dans ce batch (car tout est "keep"), on sort.
    if (delCount === 0) break;

    await batch.commit();
    console.log(`Deleted ${delCount} docs from ${collectionPath}...`);

    if (snap.size < batchSize) break;
  }
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID");
  const ADMIN_UID = optEnv("ADMIN_UID"); // optionnel (si tu veux conserver le doc clients/<ADMIN_UID>)

  console.log("TZ =", process.env.TZ || "(not set)");
  console.log("Project =", PROJECT_ID);
  console.log("ADMIN_UID =", ADMIN_UID || "(not set)");

  const db = new Firestore({ projectId: PROJECT_ID });

  // ✅ On NE TOUCHE PAS à: admins / settings
  // ❌ On reset tout le reste (tests)
  const toWipe = [
    "appointments",
    "slots",
    "freeSlots",
    "busySlots",
    "modificationRequests",
    "clients",
  ];

  for (const col of toWipe) {
    const keep = new Set();
    if (col === "clients" && ADMIN_UID) keep.add(ADMIN_UID); // optionnel : conserve ton profil client
    console.log(`\n--- WIPING ${col} (keep=${[...keep].join(",") || "none"}) ---`);
    await deleteCollection(db, col, { batchSize: 400, keepIds: keep });
  }

  console.log("\nDONE ✅ Reset completed (admins/settings preserved).");
}

main().catch((e) => {
  console.error("RESET FAILED ❌", e);
  process.exit(1);
});
