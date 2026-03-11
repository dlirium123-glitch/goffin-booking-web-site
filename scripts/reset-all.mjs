import admin from "firebase-admin";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return true;
  return v;
}

const projectId = arg("project");
if (!projectId || typeof projectId !== "string") {
  console.error("Missing --project <PROJECT_ID>");
  process.exit(1);
}

admin.initializeApp({ projectId });

const db = admin.firestore();
const auth = admin.auth();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deleteCollection(name, batchSize = 400) {
  const col = db.collection(name);
  let deletedTotal = 0;

  while (true) {
    const snap = await col.limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    deletedTotal += snap.size;
    await sleep(150);
  }

  console.log(`[reset] ${name}: deleted ${deletedTotal} docs`);
}

async function deleteAllAuthUsers() {
  let nextPageToken = undefined;
  let total = 0;

  while (true) {
    const res = await auth.listUsers(1000, nextPageToken);
    if (res.users.length === 0) break;

    const uids = res.users.map((user) => user.uid);
    await auth.deleteUsers(uids);

    total += uids.length;
    console.log(`[reset] auth users deleted: ${uids.length} (running total: ${total})`);

    if (!res.pageToken) break;
    nextPageToken = res.pageToken;
    await sleep(150);
  }

  console.log(`[reset] auth total deleted: ${total}`);
}

(async () => {
  console.log("======================================");
  console.log("RESET ALL - PROJECT:", projectId);
  console.log("======================================");

  const collections = [
    "users",
    "serviceTypes",
    "appointments",
    "bookings",
    "requests",
    "requestAddresses",
    "requestServices",
    "holds",
    "holdSlots",
    "outbox",
    "modificationRequests",
    "slots",
    "freeSlots",
    "publicSlots",
    "syncHealth",
    "settings",
  ];

  for (const name of collections) {
    try {
      await deleteCollection(name);
    } catch (error) {
      console.warn(`[reset] ${name}: delete failed`, error?.message || error);
    }
  }

  try {
    await deleteAllAuthUsers();
  } catch (error) {
    console.warn("[reset] auth delete failed:", error?.message || error);
  }

  console.log("======================================");
  console.log("RESET DONE");
  console.log("======================================");
})().catch((error) => {
  console.error("RESET FAILED", error);
  process.exit(1);
});
