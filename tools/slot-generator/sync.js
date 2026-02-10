/* eslint-disable no-console */
const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore");

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Bad time format for ${s}. Use HH:MM`);
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  return hh * 60 + mm;
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ID doc freeSlots = YYYYMMDD_HHMM
function freeSlotIdFromDate(d) {
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function addMinutes(d, min) {
  return new Date(d.getTime() + min * 60000);
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID");

  const DAYS_FORWARD = parseInt(process.env.DAYS_FORWARD || "60", 10);
  const SLOT_MINUTES = parseInt(process.env.SLOT_MINUTES || "90", 10);
  const DAY_START_MIN = parseHHMM(process.env.DAY_START || "09:30");
  const DAY_END_MIN = parseHHMM(process.env.DAY_END || "17:30");
  const START_OFFSET_DAYS = parseInt(process.env.START_OFFSET_DAYS || "2", 10);

  const LAST_START_MIN = DAY_END_MIN - SLOT_MINUTES;

  const db = new Firestore({ projectId: PROJECT_ID });
  const col = db.collection("freeSlots");

  const now = new Date();
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + START_OFFSET_DAYS, 0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + DAYS_FORWARD);

  console.log("Generate window:", windowStart.toISOString(), "→", windowEnd.toISOString());

  // Charge existants sur la plage
  console.log("Loading existing freeSlots…");
  const snap = await col
    .where("start", ">=", Timestamp.fromDate(windowStart))
    .where("start", "<", Timestamp.fromDate(windowEnd))
    .get();

  const existing = new Map();
  snap.forEach((d) => existing.set(d.id, d.data() || {}));
  console.log("Existing docs:", existing.size);

  const docs = [];
  // build desired slots
  for (let day = new Date(windowStart); day < windowEnd; day = addMinutes(day, 24 * 60)) {
    const dow = day.getDay(); // 0=dim,6=sam
    if (dow === 0 || dow === 6) continue;

    for (let mins = DAY_START_MIN; mins <= LAST_START_MIN; mins += SLOT_MINUTES) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
      start.setMinutes(mins);
      const end = addMinutes(start, SLOT_MINUTES);

      const id = freeSlotIdFromDate(start);
      docs.push({
        id,
        start: Timestamp.fromDate(start),
        end: Timestamp.fromDate(end),
      });
    }
  }

  console.log("Desired slots:", docs.length);

  // SAFE write: n’écrase jamais outlook/validated, ni d'autres blocked
  const BLOCK_REASON_OUTLOOK = "outlook";
  const BLOCK_REASON_VALIDATED = "validated";

  const safe = [];
  let skipped = 0;

  for (const s of docs) {
    const ex = existing.get(s.id);
    if (!ex) {
      safe.push({ ...s, mode: "create" });
      continue;
    }
    const status = String(ex.status || "").toLowerCase();
    const reason = String(ex.blockedReason || "").toLowerCase();

    if (status === "blocked") {
      // On ne touche pas les blocked (outlook/validated/manuel/…)
      skipped++;
      continue;
    }
    // free (ou autre): OK merge
    safe.push({ ...s, mode: "merge" });
  }

  console.log("Will write:", safe.length, "skipped:", skipped);

  // Batch commits
  const batchSize = 400;
  let batch = db.batch();
  let ops = 0;
  let written = 0;

  async function commitIfNeeded() {
    if (ops >= batchSize) {
      const b = batch;
      batch = db.batch();
      ops = 0;
      await b.commit();
    }
  }

  for (const s of safe) {
    const ref = col.doc(s.id);
    batch.set(ref, {
      start: s.start,
      end: s.end,
      status: "free",
      blockedReason: null,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });

    ops++;
    written++;
    await commitIfNeeded();
  }

  if (ops > 0) await batch.commit();

  console.log("DONE ✅", { written, skipped });
}

main().catch((e) => {
  console.error("GEN FAILED ❌", e);
  process.exit(1);
});
