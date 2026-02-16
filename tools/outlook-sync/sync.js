/* eslint-disable no-console */

const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore")
const fetch = require("node-fetch")
const ical = require("node-ical")

/**
 * Outlook → Firestore sync
 * - Reads OUTLOOK_ICS_URL (secret in GitHub Actions)
 * - Blocks freeSlots overlapped by Outlook events
 * - Frees slots previously blocked by outlook when not overlapped anymore
 * - Never overrides validated slots
 * - Never overrides pending slots (but can flag conflict)
 * - Writes syncHealth/outlook for admin banner
 */

function main() {
  run().catch(async (error) => {
    console.error("❌ Fatal error:", error)
    try {
      await writeHealth({
        status: "failed",
        message: safeErrorMessage(error),
        details: safeErrorStack(error),
      })
    } catch (e) {
      console.error("❌ Could not write syncHealth:", e)
    }
    process.exitCode = 1
  })
}

async function run() {
  const config = readConfig()
  const db = new Firestore({ projectId: config.projectId })

  const now = new Date()
  const rangeStart = new Date(now)
  const rangeEnd = addDays(now, config.daysForward)

  console.log("🔄 Outlook sync start")
  console.log("• projectId:", config.projectId)
  console.log("• daysForward:", config.daysForward)
  console.log("• range:", rangeStart.toISOString(), "→", rangeEnd.toISOString())
  console.log("• tz:", config.tz)

  // 1) Fetch + parse ICS
  const icsText = await fetchIcs({ url: config.icsUrl })
  const busyIntervals = parseBusyIntervals({
    icsText,
    rangeStart,
    rangeEnd,
  })

  console.log("• busy intervals:", busyIntervals.length)

  // 2) Load freeSlots in range
  const freeSlots = await loadFreeSlotsInRange({
    db,
    rangeStart,
    rangeEnd,
  })

  console.log("• freeSlots loaded:", freeSlots.length)

  // 3) Compute desired updates
  const plan = buildUpdatePlan({
    freeSlots,
    busyIntervals,
  })

  console.log("• updates:", plan.toWrite.length, "• skipped:", plan.skipped)

  // 4) Commit updates (batch)
  const { committed } = await commitUpdates({
    db,
    toWrite: plan.toWrite,
  })

  // 5) Write health doc
  const summary = {
    status: "ok",
    message: "Sync completed",
    updatedAt: FieldValue.serverTimestamp(),
    counts: {
      scanned: freeSlots.length,
      committed,
      blockedByOutlook: plan.counts.blockedByOutlook,
      freedFromOutlook: plan.counts.freedFromOutlook,
      keptPending: plan.counts.keptPending,
      keptValidated: plan.counts.keptValidated,
      conflicts: plan.counts.conflicts,
      unchanged: plan.counts.unchanged,
    },
  }

  await db.collection("syncHealth").doc("outlook").set(summary, { merge: true })

  console.log("✅ Done")
  console.log("• committed:", committed)
  console.log("• blockedByOutlook:", plan.counts.blockedByOutlook)
  console.log("• freedFromOutlook:", plan.counts.freedFromOutlook)
  console.log("• keptValidated:", plan.counts.keptValidated)
  console.log("• keptPending:", plan.counts.keptPending)
  console.log("• conflicts:", plan.counts.conflicts)
  console.log("• unchanged:", plan.counts.unchanged)
}

/* ----------------------------- CONFIG ----------------------------- */

function readConfig() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT
  const icsUrl = process.env.OUTLOOK_ICS_URL
  const daysForward = toInt(process.env.DAYS_FORWARD, 90)
  const tz = process.env.TZ || "Europe/Brussels"

  if (!projectId) throw new Error("Missing env: FIREBASE_PROJECT_ID (or GCLOUD_PROJECT)")
  if (!icsUrl) throw new Error("Missing env: OUTLOOK_ICS_URL")

  return {
    projectId,
    icsUrl,
    daysForward,
    tz,
  }
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value || ""), 10)
  if (Number.isFinite(n) && n > 0) return n
  return fallback
}

/* ----------------------------- FETCH ICS ----------------------------- */

async function fetchIcs({ url }) {
  const res = await fetch(url, { method: "GET" })
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status} ${res.statusText}`)
  const text = await res.text()
  if (!text || text.length < 50) throw new Error("ICS content looks empty")
  return text
}

/* ----------------------------- PARSE ICS ----------------------------- */

function parseBusyIntervals({ icsText, rangeStart, rangeEnd }) {
  const parsed = ical.parseICS(icsText)
  const intervals = []

  for (const key of Object.keys(parsed)) {
    const item = parsed[key]
    if (!item) continue
    if (item.type !== "VEVENT") continue

    const start = toDate(item.start)
    const end = toDate(item.end)

    if (!start || !end) continue
    if (end <= start) continue

    // Skip events completely outside the window
    if (end <= rangeStart) continue
    if (start >= rangeEnd) continue

    // Clamp within our window
    const clampedStart = start < rangeStart ? rangeStart : start
    const clampedEnd = end > rangeEnd ? rangeEnd : end

    intervals.push({
      start: clampedStart,
      end: clampedEnd,
      uid: String(item.uid || key || ""),
      summary: String(item.summary || ""),
    })
  }

  intervals.sort((a, b) => a.start.getTime() - b.start.getTime())
  return mergeIntervals(intervals)
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function mergeIntervals(intervals) {
  if (!intervals.length) return []
  const out = []
  let cur = { ...intervals[0] }

  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i]
    if (next.start <= cur.end) {
      // merge overlap
      cur.end = next.end > cur.end ? next.end : cur.end
      continue
    }
    out.push(cur)
    cur = { ...next }
  }
  out.push(cur)
  return out
}

/* ----------------------------- FIRESTORE LOAD ----------------------------- */

async function loadFreeSlotsInRange({ db, rangeStart, rangeEnd }) {
  const fromTs = Timestamp.fromDate(rangeStart)
  const toTs = Timestamp.fromDate(rangeEnd)

  const snap = await db
    .collection("freeSlots")
    .where("start", ">=", fromTs)
    .where("start", "<", toTs)
    .get()

  return snap.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data() || {},
  }))
}

/* ----------------------------- PLAN UPDATES ----------------------------- */

function buildUpdatePlan({ freeSlots, busyIntervals }) {
  const BLOCK_REASON = {
    OUTLOOK: "outlook",
    VALIDATED: "validated",
  }

  const counts = {
    blockedByOutlook: 0,
    freedFromOutlook: 0,
    keptPending: 0,
    keptValidated: 0,
    conflicts: 0,
    unchanged: 0,
  }

  const toWrite = []
  let skipped = 0

  for (const slot of freeSlots) {
    const data = slot.data || {}

    const start = toDateFromTs(data.start)
    const end = toDateFromTs(data.end)

    if (!start || !end) {
      skipped++
      continue
    }

    const currentStatus = String(data.status || "free").toLowerCase()
    const currentReason = String(data.blockedReason || "").toLowerCase()

    const isValidated = currentStatus === "blocked" && currentReason === BLOCK_REASON.VALIDATED
    if (isValidated) {
      // Never change validated slots
      counts.keptValidated++
      // Ensure conflict is false for validated (clean UI)
      if (data.conflict === true) {
        toWrite.push({
          ref: slot.ref,
          patch: {
            conflict: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
          reason: "validated-conflict-reset",
        })
      } else {
        counts.unchanged++
      }
      continue
    }

    const isPending = currentStatus === "pending"

    const isBusy = overlapsAny({ start, end, intervals: busyIntervals })

    // Desired state for non-protected slots
    const desired = isBusy
      ? { status: "blocked", blockedReason: BLOCK_REASON.OUTLOOK }
      : { status: "free", blockedReason: null }

    // Pending is protected: do not change status, but flag conflict if Outlook overlaps
    if (isPending) {
      counts.keptPending++

      const shouldConflict = isBusy
      if (shouldConflict) counts.conflicts++

      const needsWrite = (data.conflict === true) !== shouldConflict
      if (!needsWrite) {
        counts.unchanged++
        continue
      }

      toWrite.push({
        ref: slot.ref,
        patch: {
          conflict: shouldConflict,
          updatedAt: FieldValue.serverTimestamp(),
        },
        reason: "pending-conflict",
      })
      continue
    }

    // Normal slots: we enforce desired state AND we RESET conflict every run
    const nextConflict = false

    const willChangeStatus = currentStatus !== desired.status
    const willChangeReason = String(currentReason || "") !== String(desired.blockedReason || "")
    const willChangeConflict = (data.conflict === true) !== nextConflict

    if (!willChangeStatus && !willChangeReason && !willChangeConflict) {
      counts.unchanged++
      continue
    }

    if (desired.status === "blocked" && desired.blockedReason === BLOCK_REASON.OUTLOOK) counts.blockedByOutlook++
    if (currentStatus === "blocked" && currentReason === BLOCK_REASON.OUTLOOK && !isBusy) counts.freedFromOutlook++

    toWrite.push({
      ref: slot.ref,
      patch: {
        status: desired.status,
        blockedReason: desired.blockedReason,
        conflict: nextConflict,
        updatedAt: FieldValue.serverTimestamp(),
      },
      reason: "enforce-desired",
    })
  }

  return { toWrite, skipped, counts }
}

function toDateFromTs(ts) {
  try {
    if (!ts) return null
    if (typeof ts.toDate === "function") return ts.toDate()
    return toDate(ts)
  } catch {
    return null
  }
}

/* ----------------------------- OVERLAP CHECK ----------------------------- */

function overlapsAny({ start, end, intervals }) {
  // intervals are sorted and merged; we can early-break
  const startMs = start.getTime()
  const endMs = end.getTime()

  for (const it of intervals) {
    const itStart = it.start.getTime()
    const itEnd = it.end.getTime()

    if (itStart >= endMs) return false // no further overlaps
    if (itEnd <= startMs) continue
    return true
  }

  return false
}

/* ----------------------------- COMMIT ----------------------------- */

async function commitUpdates({ db, toWrite }) {
  if (!toWrite.length) return { committed: 0 }

  const MAX_BATCH = 450
  let committed = 0

  for (let i = 0; i < toWrite.length; i += MAX_BATCH) {
    const chunk = toWrite.slice(i, i + MAX_BATCH)
    const batch = db.batch()

    for (const item of chunk) batch.set(item.ref, item.patch, { merge: true })

    await batch.commit()
    committed += chunk.length

    console.log("• batch committed:", chunk.length, "• total:", committed)
  }

  return { committed }
}

/* ----------------------------- HEALTH HELPERS ----------------------------- */

async function writeHealth({ status, message, details }) {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT
  if (!projectId) return

  const db = new Firestore({ projectId })

  const payload = {
    status,
    message: String(message || ""),
    details: String(details || ""),
    updatedAt: FieldValue.serverTimestamp(),
  }

  await db.collection("syncHealth").doc("outlook").set(payload, { merge: true })
}

function safeErrorMessage(error) {
  try {
    if (!error) return "Unknown error"
    return String(error.message || error)
  } catch {
    return "Unknown error"
  }
}

function safeErrorStack(error) {
  try {
    return String(error && error.stack ? error.stack : "")
  } catch {
    return ""
  }
}

/* ----------------------------- DATE HELPERS ----------------------------- */

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

main()
