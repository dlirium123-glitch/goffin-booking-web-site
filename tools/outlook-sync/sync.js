/* eslint-disable no-console */
const fetch = require("node-fetch")
const ical = require("node-ical")
const { Firestore } = require("@google-cloud/firestore")

function mustEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function envNum(name, fallback) {
  const v = process.env[name]
  if (v == null || v === "") return fallback
  const n = Number(v)
  if (Number.isNaN(n)) return fallback
  return n
}

// Overlap test: [aStart,aEnd) overlaps [bStart,bEnd)
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function toDateMaybe(ts) {
  if (!ts) return null
  if (ts.toDate) return ts.toDate()
  if (ts instanceof Date) return ts
  return null
}

async function fetchIcsText(url) {
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status} ${res.statusText}`)
  return await res.text()
}

function parseBusyIntervalsFromIcs(icsText, windowStart, windowEnd) {
  const data = ical.sync.parseICS(icsText)

  const busy = []
  for (const k of Object.keys(data)) {
    const ev = data[k]
    if (!ev || ev.type !== "VEVENT") continue

    const start = ev.start instanceof Date ? ev.start : null
    const end = ev.end instanceof Date ? ev.end : null
    if (!start || !end) continue

    if (overlaps(start, end, windowStart, windowEnd)) busy.push({ start, end })
  }

  busy.sort((a, b) => a.start - b.start)
  return busy
}

function isReservedStatus(status) {
  return status === "pending" || status === "validated" || status === "booked"
}

function isFreeStatus(status) {
  return status === "free" || status === "" || status == null
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID")
  const OUTLOOK_ICS_URL = mustEnv("OUTLOOK_ICS_URL")

  const DAYS_FORWARD = parseInt(process.env.DAYS_FORWARD || "60", 10)

  // ✅ Anti “conflict storm”
  const MAX_BLOCK_RATE = envNum("MAX_BLOCK_RATE", 0.6)       // 60% des slots touchés = suspect
  const MAX_CONFLICTS = envNum("MAX_CONFLICTS", 25)          // +25 conflits d’un coup = suspect

  const windowStart = new Date()
  windowStart.setHours(0, 0, 0, 0)

  const windowEnd = new Date(windowStart)
  windowEnd.setDate(windowEnd.getDate() + DAYS_FORWARD)

  console.log("Sync window:", windowStart.toISOString(), "→", windowEnd.toISOString())
  console.log("Guards:", { MAX_BLOCK_RATE, MAX_CONFLICTS })

  const db = new Firestore({ projectId: PROJECT_ID })

  console.log("Fetching ICS…")
  const icsText = await fetchIcsText(OUTLOOK_ICS_URL)

  const busy = parseBusyIntervalsFromIcs(icsText, windowStart, windowEnd)
  console.log("Busy intervals found:", busy.length)

  console.log("Loading freeSlots…")
  const snap = await db
    .collection("freeSlots")
    .where("start", ">=", windowStart)
    .where("start", "<", windowEnd)
    .get()

  console.log("freeSlots in range:", snap.size)

  // =========================================================
  // ✅ PRE-SCAN (circuit breaker): on calcule l'impact AVANT d'écrire
  // =========================================================
  let wouldBlock = 0
  let wouldConflicts = 0

  for (const doc of snap.docs) {
    const d = doc.data() || {}
    const start = toDateMaybe(d.start)
    const end = toDateMaybe(d.end)
    if (!start || !end) continue

    const status = String(d.status || "")
    const hasConflict = d.conflict === true

    let isBusy = false
    for (const it of busy) {
      if (overlaps(start, end, it.start, it.end)) {
        isBusy = true
        break
      }
    }

    if (!isBusy) continue

    if (isFreeStatus(status)) {
      wouldBlock++
      continue
    }

    // réservé + busy => conflit (si pas déjà)
    if (isReservedStatus(status) && !hasConflict) {
      wouldConflicts++
      continue
    }

    // autres statuts + busy => conflit (si pas déjà)
    if (!hasConflict) wouldConflicts++
  }

  const totalSlots = snap.size || 1
  const blockRate = wouldBlock / totalSlots

  console.log("Pre-scan impact:", { wouldBlock, wouldConflicts, totalSlots, blockRate })

  if (blockRate > MAX_BLOCK_RATE || wouldConflicts > MAX_CONFLICTS) {
    console.error("ABORT SAFE ❌ Impact too high (possible ICS/timezone issue). No writes done.")
    console.error("Details:", { blockRate, MAX_BLOCK_RATE, wouldConflicts, MAX_CONFLICTS })
    process.exit(2)
  }

  // =========================================================
  // ✅ APPLY CHANGES (identique à ta logique)
  // =========================================================
  let toBlock = 0
  let toFree = 0
  let conflicts = 0
  let conflictsCleared = 0

  const batchSize = 400
  let batch = db.batch()
  let ops = 0

  async function commitIfNeeded() {
    if (ops >= batchSize) {
      const b = batch
      batch = db.batch()
      ops = 0
      await b.commit()
    }
  }

  for (const doc of snap.docs) {
    const d = doc.data() || {}
    const start = toDateMaybe(d.start)
    const end = toDateMaybe(d.end)
    if (!start || !end) continue

    const status = String(d.status || "")
    const br = d.blockedReason == null ? "" : String(d.blockedReason)
    const hasConflict = d.conflict === true
    const conflictReason = d.conflictReason == null ? "" : String(d.conflictReason)

    let isBusy = false
    for (const it of busy) {
      if (overlaps(start, end, it.start, it.end)) {
        isBusy = true
        break
      }
    }

    if (isBusy) {
      if (isFreeStatus(status)) {
        batch.update(doc.ref, {
          status: "blocked",
          blockedReason: "outlook",
          conflict: false,
          conflictReason: Firestore.FieldValue.delete(),
          conflictAt: Firestore.FieldValue.delete(),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        })
        ops++; toBlock++
        await commitIfNeeded()
        continue
      }

      if (isReservedStatus(status)) {
        if (!hasConflict || conflictReason !== "outlook") {
          batch.update(doc.ref, {
            conflict: true,
            conflictReason: "outlook",
            conflictAt: Firestore.FieldValue.serverTimestamp(),
            updatedAt: Firestore.FieldValue.serverTimestamp()
          })
          ops++; conflicts++
          await commitIfNeeded()
        }
        continue
      }

      if (!hasConflict || conflictReason !== "outlook") {
        batch.update(doc.ref, {
          conflict: true,
          conflictReason: "outlook",
          conflictAt: Firestore.FieldValue.serverTimestamp(),
          updatedAt: Firestore.FieldValue.serverTimestamp()
        })
        ops++; conflicts++
        await commitIfNeeded()
      }
      continue
    }

    if (status === "blocked" && br === "outlook") {
      batch.update(doc.ref, {
        status: "free",
        blockedReason: Firestore.FieldValue.delete(),
        conflict: false,
        conflictReason: Firestore.FieldValue.delete(),
        conflictAt: Firestore.FieldValue.delete(),
        updatedAt: Firestore.FieldValue.serverTimestamp()
      })
      ops++; toFree++
      await commitIfNeeded()
      continue
    }

    if (hasConflict && conflictReason === "outlook") {
      batch.update(doc.ref, {
        conflict: false,
        conflictReason: Firestore.FieldValue.delete(),
        conflictAt: Firestore.FieldValue.delete(),
        updatedAt: Firestore.FieldValue.serverTimestamp()
      })
      ops++; conflictsCleared++
      await commitIfNeeded()
      continue
    }
  }

  if (ops > 0) await batch.commit()

  console.log("DONE ✅", { toBlock, toFree, conflicts, conflictsCleared })
}

main().catch((e) => {
  console.error("SYNC FAILED ❌", e)
  process.exit(1)
})
