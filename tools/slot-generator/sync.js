import admin from "firebase-admin";

// --- CONFIG par défaut (tu peux les mettre en Firestore settings aussi) ---
const CFG = {
  daysForward: parseInt(process.env.DAYS_FORWARD || "60", 10), // horizon
  daysToShow: 5,                 // Lun->Ven
  startMinutes: 9 * 60 + 30,     // 09:30
  endMinutes: 17 * 60 + 30,      // 17:30
  slotMinutes: 90                // 90 min
};

// Service account JSON depuis GitHub Secret
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT env var");

const serviceAccount = JSON.parse(raw);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function pad2(n) { return String(n).padStart(2, "0"); }

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// 0=Sun..6=Sat ; on veut Lun..Ven
function isWeekdayMonToFri(d) {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

// minutes -> Date sur la journée d
function dateAtMinutes(day, mins) {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(mins);
  return d;
}

function slotDocId(startDate) {
  // format: YYYYMMDD_HHMM  (ex: 20260209_0930)
  const y = startDate.getFullYear();
  const m = pad2(startDate.getMonth() + 1);
  const da = pad2(startDate.getDate());
  const hh = pad2(startDate.getHours());
  const mm = pad2(startDate.getMinutes());
  return `${y}${m}${da}_${hh}${mm}`;
}

function buildTimeRows() {
  const rows = [];
  const lastStart = CFG.endMinutes - CFG.slotMinutes;
  let mins = CFG.startMinutes;
  while (mins <= lastStart) {
    rows.push(mins);
    mins += CFG.slotMinutes;
  }
  return rows;
}

async function ensureFreeSlots() {
  const today = startOfDay(new Date());
  const timeRows = buildTimeRows();

  // Limite écriture: batch max 500
  let batch = db.batch();
  let ops = 0;
  let created = 0;
  let skipped = 0;

  for (let i = 0; i < CFG.daysForward; i++) {
    const day = addDays(today, i);
    if (!isWeekdayMonToFri(day)) continue;

    for (const mins of timeRows) {
      const start = dateAtMinutes(day, mins);
      const end = new Date(start.getTime() + CFG.slotMinutes * 60 * 1000);

      const id = slotDocId(start);
      const ref = db.collection("freeSlots").doc(id);

      // On lit pour éviter d'écraser (et pour rester safe)
      const snap = await ref.get();

      if (snap.exists) {
        const data = snap.data() || {};
        const st = String(data.status || "free");
        // ne touche pas aux slots déjà bloqués / bookés / validés
        if (st !== "free") {
          skipped++;
          continue;
        }
        // slot free existe déjà => skip
        skipped++;
        continue;
      }

      batch.set(ref, {
        start: admin.firestore.Timestamp.fromDate(start),
        end: admin.firestore.Timestamp.fromDate(end),
        status: "free",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      ops++;
      created++;

      if (ops >= 450) { // marge
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }

  if (ops > 0) await batch.commit();

  console.log(`✅ freeSlots generated: created=${created}, skipped=${skipped}`);
}

ensureFreeSlots()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ slot-generator error:", e);
    process.exit(1);
  });
