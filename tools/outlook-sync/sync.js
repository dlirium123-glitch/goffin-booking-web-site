/* eslint-disable no-console */
const { Firestore, FieldValue, Timestamp } = require("@google-cloud/firestore")
const fetch = require("node-fetch")
const ical = require("node-ical")

function mustEnv(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function toMs(d) {
  return d instanceof Date ? d.getTime() : new Date(d).getTime()
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

// freeSlots id = YYYYMMDD_HHMM
function pad2(n) {
  return String(n).padStart(2, "0")
}

function freeSlotIdFromDate(d) {
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mi = pad2(d.getMinutes())
  return `${yyyy}${mm}${dd}_${hh}${mi}`
}

function addDays(date, days) {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + days)
  return d
}

function safeText(s, max = 220) {
  const x = String(s || "").replace(/\s+/g, " ").trim()
  if (x.length <= max) return x
  return `${x.slice(0, max - 3)}...`
}

// ========= ICS parsing helpers =========
function normalizeEventWindow(ev) {
  // node-ical returns ev.start/ev.end as Date
  const start = ev.start instanceof Date ? ev.start : null
  const end = ev.end instanceof Date ? ev.end : null
  if (!start || !end) return null

  // ignore invalid
  if (end <= start) return null

  return { start, end, summary: ev.summary || "" }
}

function isBlockingEvent(ev) {
  // You can filter here if you want (ex: ignore "Free" events etc)
  // For now: every VEVENT blocks time.
  return true
}

// ========= Firestore sync =========
async function writeHealth(db, status, payload) {
  const ref = db.collection("syncHealth").doc("outlook")
  const base = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
  }
  await ref.set({ ...base, ...(payload || {}) }, { merge: true })
}

async function main() {
  const PROJECT_ID = mustEnv("FIREBASE_PROJECT_ID")
  const OUTLOOK_ICS_URL = mustEnv("OUTLOOK_ICS_URL")
  const DAYS_FORWARD = parseInt(process.env.DAYS_FORWARD || "90", 10)

  const db = new Firestore({ projectId: PROJECT_ID })
  const freeSlotsCol = db.collection("freeSlots")

  const now = new Date()
  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const windowEnd = addDays(windowStart, DAYS_FORWARD)

  console.log("Window:", windowStart.toISOString(), "→", windowEnd.toISOString())

  // ---------- Download ICS ----------
  let icsText = ""
  try {
    const res = await fetch(OUTLOOK_ICS_URL, { method: "GET" })
    if (!res.ok) {
      await writeHealth(db, "failed", {
        message: `ICS fetch failed: HTTP ${res.status}`,
      })
      throw new Error(`ICS fetch failed: HTTP ${res.status}`)
    }
    icsText = await res.text()
  } catch (e) {
    await writeHealth(db, "failed", { message: safeText(e.message) })
    throw e
  }

  if (!icsText || icsText.length < 20) {
    await writeHealth(db, "aborted", { reason: "empty_ics" })
    console.warn("ICS seems empty -> aborted")
    return
  }

  // ---------- Parse ICS ----------
  let parsed
  try {
    parsed = ical.parseICS(icsText)
  } catch (e) {
    await writeHealth(db, "failed", { message: `ICS parse error: ${safeText(e.message)}` })
    throw e
  }

  const busy = []
  for (const k of Object.keys(parsed)) {
    const ev = parsed[k]
    if (!ev || ev.type !== "VEVENT") continue

    const norm = normalizeEventWindow(ev)
    if (!norm) continue
    if (!isBlockingEvent(ev)) continue

    // Keep only within window (quick pruning)
    const s = norm.start
    const e = norm.end
    if (e <= windowStart) continue
    if (s >= windowEnd) continue

    busy.push({ start: s, end: e, summary: norm.summary })
  }

  busy.sort((a, b) => toMs(a.start) - toMs(b.start))

  console.log("Busy events in window:", busy.length)

  // ---------- Load freeSlots in window ----------
  console.log("Loading freeSlots in window…")
  const snap = await freeSlotsCol
    .where("start", ">=", Timestamp.fromDate(windowStart))
    .where("start", "<", Timestamp.fromDate(windowEnd))
    .get()

  console.log("freeSlots docs loaded:", snap.size)

  // ---------- Decide updates ----------
  const toBlock = []
  const toFree = []

  snap.forEach((doc) => {
    const d = doc.data() || {}
    const status = String(d.status || "free").toLowerCase()
    const reason = String(d.blockedReason || "").toLowerCase()

    // We NEVER override validated
    if (status === "blocked" && reason === "validated") return

    const start = d.start?.toDate ? d.start.toDate() : null
    const end = d.end?.toDate ? d.end.toDate() : null
    if (!start || !end) return

    const sMs = toMs(start)
    const eMs = toMs(end)

    // Determine if overlaps any busy event (simple scan)
    // Busy list is usually small; this is fine. If huge, we can optimize later.
    let isOccupied = false
    for (const ev of busy) {
      if (toMs(ev.start) >= eMs) break
      if (overlaps(sMs, eMs, toMs(ev.start), toMs(ev.end))) {
        isOccupied = true
        break
      }
    }

    if (isOccupied) {
      // Should be blocked(outlook) unless validated
      if (!(status === "blocked" && reason === "outlook")) {
        toBlock.push(doc.id)
      }
      return
    }

    // Not occupied -> if currently blocked by outlook, free it
    if (status === "blocked" && reason === "outlook") {
      toFree.push(doc.id)
    }
  })

  console.log("Will block:", toBlock.length, "Will free:", toFree.length)

  // ---------- Batch write ----------
  const batchSize = 400
  let batch = db.batch()
  let ops = 0
  let blockedCount = 0
  let freedCount = 0

  async function commitIfNeeded() {
    if (ops >= batchSize) {
      const b = batch
      batch = db.batch()
      ops = 0
      await b.commit()
    }
  }

  for (const id of toBlock) {
    const ref = freeSlotsCol.doc(id)
    batch.set(
      ref,
      {
        status: "blocked",
        blockedReason: "outlook",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    ops++
    blockedCount++
    await commitIfNeeded()
  }

  for (const id of toFree) {
    const ref = freeSlotsCol.doc(id)
    batch.set(
      ref,
      {
        status: "free",
        blockedReason: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    ops++
    freedCount++
    await commitIfNeeded()
  }

  if (ops > 0) await batch.commit()

  await writeHealth(db, "ok", {
    message: `blocked=${blockedCount} freed=${freedCount} events=${busy.length}`,
  })

  console.log("DONE ✅", { blockedCount, freedCount, events: busy.length })
}

main().catch(async (e) => {
  console.error("SYNC FAILED ❌", e)
  try {
    const PROJECT_ID = process.env.FIREBASE_PROJECT_ID
    if (PROJECT_ID) {
      const db = new Firestore({ projectId: PROJECT_ID })
      await writeHealth(db, "failed", { message: safeText(e.message) })
    }
  } catch {}
  process.exit(1)
})
