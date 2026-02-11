/* eslint-disable no-console */
const { Firestore } = require("@google-cloud/firestore");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function deleteCollection(db, collectionPath, batchSize = 400) {
  const col = db.collection(collectionPath);

  while (true) {
    const snap = await col.orderBy("__name__").limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    console.log(`Deleted ${snap.size} docs from ${collectionPath}...`);
    if (snap.size < batchSize) break;
  }
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID");
  const db = new Firestore({ projectId: PROJECT_ID });

  console.log("TZ =", process.env.TZ || "(not set)");
  console.log("Project =", PROJECT_ID);

  console.log("Cleaning collection: freeSlots");
  await deleteCollection(db, "freeSlots", 400);

  console.log("DONE ✅ freeSlots cleared");
}

main().catch((e) => {
  console.error("CLEAN FAILED ❌", e);
  process.exit(1);
});
