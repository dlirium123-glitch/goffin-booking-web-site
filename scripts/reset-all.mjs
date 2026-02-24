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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deleteCollection(name, batchSize = 400) {
  const col = db.collection(name);
  let deletedTotal = 0;

  while (true) {
    const snap = await col.limit(batchSize).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    deletedTotal += snap.size;

    // petite pause pour éviter le throttling
    await sleep(150);
  }

  console.log(`🗑️  ${name}: deleted ${deletedTotal} docs`);
}

async function deleteAllAuthUsers() {
  let nextPageToken = undefined;
  let total = 0;

  while (true) {
    const res = await auth.listUsers(1000, nextPageToken);
    if (res.users.length === 0) break;

    const uids = res.users.map((u) => u.uid);
    // deleteUsers accepte max 1000
    await auth.deleteUsers(uids);

    total += uids.length;
    console.log(`👤 Deleted ${uids.length} auth users (running total: ${total})`);

    if (!res.pageToken) break;
    nextPageToken = res.pageToken;

    await sleep(150);
  }

  console.log(`✅ Auth: deleted total ${total} users`);
}

(async () => {
  console.log("======================================");
  console.log("🔥 RESET ALL — PROJECT:", projectId);
  console.log("======================================");

  // ⚠️ Liste des collections qu’on wipe “à coup sûr”
  // Ajoute/enlève si tu en crées de nouvelles.
  const collections = [
    "admins",
    "clients",
    "profiles", // au cas où il reste des vieux tests
    "appointments",
    "bookings",
    "requests",
    "holds",
    "modificationRequests",
    "slots",
    "freeSlots",
    "publicSlots",
    "syncHealth",
    "settings",
  ];

  for (const c of collections) {
    try {
      await deleteCollection(c);
    } catch (e) {
      console.warn(`⚠️ ${c}: error while deleting (maybe empty / missing)`, e?.message || e);
    }
  }

  try {
    await deleteAllAuthUsers();
  } catch (e) {
    console.warn("⚠️ Auth delete failed:", e?.message || e);
  }

  console.log("======================================");
  console.log("✅ RESET DONE");
  console.log("======================================");
})().catch((e) => {
  console.error("❌ RESET FAILED", e);
  process.exit(1);
});