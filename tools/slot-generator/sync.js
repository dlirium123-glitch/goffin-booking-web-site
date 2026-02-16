/* eslint-disable no-console */
const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore")

function mustEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function parseHHMM(s) {
  const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) throw new Error(`Bad time format for ${s}. Use HH:MM`)
  const hh = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  return hh * 60 + mm
}

function pad2(n) {
  return String(n).padStart(2, "0")
}

// ID doc freeSlots = YYYYMMDD_HHMM
function freeSlotIdFromDate(d) {
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mi = pad2(d.getMinutes())
  return `${yyyy}${mm}${dd}_${hh}${mi}`
}

function addMinutes(d, min) {
  return new Date(d.getTime() + min * 60000)
}

function isBlocked(ex) {
  return String(ex?.status || "").toLowerCase() === "blocked"
}

function isFreeish(ex) {
  const s = String(ex?.status || "").toLowerCase()
  return s === "free" || s === "" || s == null
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID")

  const DAYS_FORWARD = parseInt(process.env.DAYS_FORWARD || "60", 10)
  const SLOT_MINUTES = parseInt(process.env.SLOT_MINUTES || "30", 10)
  const DAY_START_MIN = parseHHMM(process.env.DAY_START || "09:30")
  const DAY_END_MIN = parseHHMM(process.env.DAY_END || "17:30")
  const START_OFFSET_DAYS = parseInt(process.env.START_OFFSET_DAYS || "2", 10)

  if (![15, 30, 60, 90].includes(SLOT_MINUTES)) {
    console.warn("⚠️ SLOT_MINUTES inhabituel:", SLOT_MINUTES)
  }

  const LAST_START_MIN = DAY_END_MIN - SLOT_MINUTES

  const db = new Firestore({ projectId: PROJECT_ID })
  const col = db.collection("freeSlots")

  const now = new Date()
  const windowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + START_OFFSET_DAYS,
    0, 0, 0, 0
  )
  const windowEnd = new Date(windowStart)
  windowEnd.setDate(windowEnd.getDate() + DAYS_FORWARD)

  console.log("Generate window (local):", windowStart.toString(), "→", windowEnd.toString())
  console.log("Generate window (ISO):  ", windowStart.toISOString(), "→", windowEnd.toISOString())
  console.log("Config:", {
    DAYS_FORWARD,
    SLOT_MINUTES,
    DAY_START: process.env.DAY_START,
    DAY_END: process.env.DAY_END,
    START_OFFSET_DAYS
  })

  // Load existing docs in range
  console.log("Loading existing freeSlots…")
  const snap = await col
    .where("start", ">=", Timestamp.fromDate(windowStart))
    .where("start", "<", Timestamp.fromDate(windowEnd))
    .get()

  const existing = new Map()
  snap.forEach((d) => existing.set(d.id, d.data() || {}))
  console.log("Existing docs in window:", existing.size)

  // Build desired slots
  const desired = []
  for (let day = new Date(windowStart); day < windowEnd; day = addMinutes(day, 24 * 60)) {
    const dow = day.getDay()
    if (dow === 0 || dow === 6) continue // skip weekend

    for (let mins = DAY_START_MIN; mins <= LAST_START_MIN; mins += SLOT_MINUTES) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
      start.setMinutes(mins)

      const end = addMinutes(start, SLOT_MINUTES)
      const id = freeSlotIdFromDate(start)

      desired.push({
        id,
        start: Timestamp.fromDate(start),
        end: Timestamp.fromDate(end)
      })
    }
  }

  console.log("Desired slots:", desired.length)

  // SAFE write: never touch blocked slots (outlook/validated/whatever)
  const toWrite = []
  let skippedBlocked = 0

  for (const s of desired) {
    const ex = existing.get(s.id)

    if (!ex) {
      toWrite.push({ ...s, mode: "create" })
      continue
    }

    if (isBlocked(ex)) {
      skippedBlocked++
      continue
    }

    toWrite.push({ ...s, mode: "merge" })
  }

  // Optional cleanup of orphans:
  // delete ONLY free-ish docs that are not in desiredIds
  const CLEAN_ORPHAN_FREE = String(process.env.CLEAN_ORPHAN_FREE || "1") === "1"
  const desiredIds = new Set(desired.map((x) => x.id))

  const toDelete = []
  if (CLEAN_ORPHAN_FREE) {
    for (const [id, ex] of existing.entries()) {
      if (isBlocked(ex)) continue
      if (!desiredIds.has(id) && isFreeish(ex)) toDelete.push(id)
    }
  }

  console.log("Will write:", toWrite.length, "skippedBlocked:", skippedBlocked, "orphansToDelete:", toDelete.length)

  // Batch commits
  const batchSize = 400
  let batch = db.batch()
  let ops = 0

  async function commitIfNeeded() {
    if (ops < batchSize) return
    const b = batch
    batch = db.batch()
    ops = 0
    await b.commit()
  }

  // Writes
  for (const s of toWrite) {
    const ref = col.doc(s.id)

    const payload = {
      start: s.start,
      end: s.end,
      status: "free",
      blockedReason: null,
      updatedAt: FieldValue.serverTimestamp()
    }

    // createdAt only once
    if (s.mode === "create") payload.createdAt = FieldValue.serverTimestamp()

    batch.set(ref, payload, { merge: true })
    ops++
    await commitIfNeeded()
  }

  // Deletes (orphans)
  for (const id of toDelete) {
    batch.delete(col.doc(id))
    ops++
    await commitIfNeeded()
  }

  if (ops > 0) await batch.commit()

  console.log("DONE ✅", { written: toWrite.length, deleted: toDelete.length, skippedBlocked })
}

main().catch((e) => {
  console.error("GEN FAILED ❌", e)
  process.exit(1)
})
