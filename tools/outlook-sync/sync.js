/* eslint-disable no-console */
const fetch = require("node-fetch");
const ical = require("node-ical");
const { Firestore } = require("@google-cloud/firestore");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Overlap test: [aStart,aEnd) overlaps [bStart,bEnd)
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Firestore Timestamp or Date -> Date
function toDateMaybe(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  return null;
}

async function fetchIcsText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

function parseBusyIntervalsFromIcs(icsText, windowStart, windowEnd) {
  const data = ical.sync.parseICS(icsText);

  const busy = [];
  for (const k of Object.keys(data)) {
    const ev = data[k];
    if (!ev || ev.type !== "VEVENT") continue;

    const start = ev.start instanceof Date ? ev.start : null;
    const end = ev.end instanceof Date ? ev.end : null;
    if (!start || !end) continue;

    // ignore all-day? (option: treat as busy)
    // Here: treat everything as busy
    if (overlaps(start, end, windowStart, windowEnd)) {
      busy.push({ start, end });
    }
  }

  // Optional: sort
  busy.sort((a, b) => a.start - b.start);
  return busy;
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID");
  const OUTLOOK_ICS_URL = mustEnv("OUTLOOK_ICS_URL");

  const DAYS_FORWARD = parseInt(process.env.DAYS_FORWARD || "60", 10);
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + DAYS_FORWARD);

  console.log("Sync window:", windowStart.toISOString(), "→", windowEnd.toISOString());

  // Firestore client uses GOOGLE_APPLICATION_CREDENTIALS set by GitHub Action auth step
  const db = new Firestore({ projectId: PROJECT_ID });

  // 1) Read ICS
  console.log("Fetching ICS…");
  const icsText = await fetchIcsText(OUTLOOK_ICS_URL);

  // 2) Parse busy intervals
  const busy = parseBusyIntervalsFromIcs(icsText, windowStart, windowEnd);
  console.log("Busy intervals found:", busy.length);

  // 3) Load freeSlots in range
  console.log("Loading freeSlots…");
  const snap = await db.collection("freeSlots")
    .where("start", ">=", windowStart)
    .where("start", "<", windowEnd)
    .get();

  console.log("freeSlots in range:", snap.size);

  let toBlock = 0;
  let toFree = 0;

  const batchSize = 400;
  let batch = db.batch();
  let ops = 0;

  function commitIfNeeded() {
    if (ops >= batchSize) {
      const b = batch;
      batch = db.batch();
      ops = 0;
      return b.commit();
    }
    return Promise.resolve();
  }

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    const start = toDateMaybe(d.start);
    const end = toDateMaybe(d.end);

    if (!start || !end) continue;

    const status = String(d.status || "");
    const br = String(d.blockedReason || "");

    // Decide if Outlook overlaps this slot
    let isBusy = false;
    for (const it of busy) {
      if (overlaps(start, end, it.start, it.end)) { isBusy = true; break; }
    }

    // We only manage Outlook blocks:
    // - if currently free and busy => block (outlook)
    // - if currently blocked/outlook and not busy => free
    // - never touch booking/validated/manual/etc
    if (status === "free" && isBusy) {
      batch.update(doc.ref, {
        status: "blocked",
        blockedReason: "outlook",
        updatedAt: Firestore.FieldValue.serverTimestamp(),
      });
      ops++; toBlock++;
      await commitIfNeeded();
      continue;
    }

    if (status === "blocked" && br === "outlook" && !isBusy) {
      batch.update(doc.ref, {
        status: "free",
        blockedReason: Firestore.FieldValue.delete(),
        updatedAt: Firestore.FieldValue.serverTimestamp(),
      });
      ops++; toFree++;
      await commitIfNeeded();
      continue;
    }
  }

  if (ops > 0) await batch.commit();

  console.log("DONE ✅", { toBlock, toFree });
}

main().catch((e) => {
  console.error("SYNC FAILED ❌", e);
  process.exit(1);
});
