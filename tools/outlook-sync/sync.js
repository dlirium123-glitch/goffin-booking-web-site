/* eslint-disable no-console */

const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore")
const fetch = require("node-fetch")
const ical = require("node-ical")
const crypto = require("crypto")

/**
 * Outlook → Firestore sync
 * - Reads OUTLOOK_ICS_URL (secret in GitHub Actions)
 * - Blocks freeSlots overlapped by Outlook events
 * - Frees slots previously blocked by outlook when not overlapped anymore
 * - Never overrides validated slots
 * - Never overrides pending slots (but can flag conflict)
 * - Writes syncHealth/outlook for admin banner
 *
 * Optional SAFE debug fields (no sensitive data):
 * - outlookBusy: boolean
 * - outlookCount: number
 * - outlookHash: string (sha256 hash from overlapped outlook event ids)
 * - outlookUpdatedAt: timestamp
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
  console.log("• debug:", config.debugOutlookMeta ? "ON" : "OFF")

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
    debugOutlookMeta: config.debugOutlookMeta,
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
    debug: {
      outlookMeta: config.debugOutlookMeta ? "enabled" : "disabled",
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

  // SAFE debug (no sensitive payload stored)
  const debugOutlookMeta = toBool(process.env.DEBUG_OUTLOOK_META, true)

  if (!projectId) throw new Error("Missing env: FIREBASE_PROJECT_ID (or GCLOUD_PROJECT)")
  if (!icsUrl) throw new Error("Missing env: OUTLOOK_ICS_URL")

  return {
    projectId,
    icsUrl,
    daysForward,
    tz,
    debugOutlookMeta,
  }
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value || ""), 10)
  if (Number.isFinite(n) && n > 0) return n
  return fallback
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback
  const v = String(value).trim().toLowerCase()
  if (["1", "true", "yes", "y", "on"].includes(v)) return true
  if (["0", "false", "no", "n", "off"].includes(v)) return false
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
    })
  }

  intervals.sort((a, b) => a.start.getTime() - b.start.getTime())
  return mergeIntervalsKeepingIds(intervals)
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

/**
 * Merge intervals but keep a small "ids" list for hashing debug (uids only).
 * We keep ids as a SET merged.
 */
function mergeIntervalsKeepingIds(intervals) {
  if (!intervals.length) return []
  const out = []

  let cur = {
    start: intervals[0].start,
    end: intervals[0].end,
    ids: new Set([intervals[0].uid].filter(Boolean)),
  }

  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i]
    const overlaps = next.start <= cur.end

    if (overlaps) {
      cur.end = next.end > cur.end ? next.end : cur.end
      if (next.uid) cur.ids.add(next.uid)
      continue
    }

    out.push({
      start: cur.start,
      end: cur.end,
      ids: Array.from(cur.ids),
    })

    cur = {
      start: next.start,
      end: next.end,
      ids: new Set([next.uid].filter(Boolean)),
    }
  }

  out.push({
    start: cur.start,
    end: cur.end,
    ids: Array.from(cur.ids),
  })

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

function buildUpdatePlan({ freeSlots, busyIntervals, debugOutlookMeta }) {
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
      counts.keptValidated++

      // Ensure conflict is false for validated (clean UI)
      if (data.conflict === true) {
        toWrite.push({
          ref: slot.ref,
          patch: {
            conflict: false,
            updatedAt: FieldValue.serverTimestamp(),
          },
        })
      } else {
        counts.unchanged++
      }
      continue
    }

    const isPending = currentStatus === "pending"

    // Find overlap info
    const overlap = getOverlapMeta({ start, end, intervals: busyIntervals })
    const isBusy = overlap.isBusy

    // Desired state for non-protected slots
    const desired = isBusy
      ? { status: "blocked", blockedReason: BLOCK_REASON.OUTLOOK }
      : { status: "free", blockedReason: null }

    // Build safe debug meta
    const outlookMetaPatch = buildOutlookMetaPatch({
      isBusy,
      overlapIds: overlap.ids,
      debugOutlookMeta,
    })

    // Pending is protected: do not change status, but flag conflict if Outlook overlaps
    if (isPending) {
      counts.keptPending++

      const shouldConflict = isBusy
      if (shouldConflict) counts.conflicts++

      const needsConflictWrite = (data.conflict === true) !== shouldConflict
      const needsMetaWrite = hasMetaDiff({ data, patch: outlookMetaPatch })

      if (!needsConflictWrite && !needsMetaWrite) {
        counts.unchanged++
        continue
      }

      toWrite.push({
        ref: slot.ref,
        patch: {
          conflict: shouldConflict,
          ...outlookMetaPatch,
          updatedAt: FieldValue.serverTimestamp(),
        },
      })
      continue
    }

    // Normal slots: enforce desired state AND reset conflict every run
    const nextConflict = false

    const willChangeStatus = currentStatus !== desired.status
    const willChangeReason = String(currentReason || "") !== String(desired.blockedReason || "")
    const willChangeConflict = (data.conflict === true) !== nextConflict
    const willChangeMeta = hasMetaDiff({ data, patch: outlookMetaPatch })

    if (!willChangeStatus && !willChangeReason && !willChangeConflict && !willChangeMeta) {
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
        ...outlookMetaPatch,
        updatedAt: FieldValue.serverTimestamp(),
      },
    })
  }

  return { toWrite, skipped, counts }
}

function buildOutlookMetaPatch({ isBusy, overlapIds, debugOutlookMeta }) {
  // If debug disabled -> strip meta fields (keep clean)
  if (!debugOutlookMeta) {
    return {
      outlookBusy: FieldValue.delete(),
      outlookCount: FieldValue.delete(),
      outlookHash: FieldValue.delete(),
      outlookUpdatedAt: FieldValue.delete(),
    }
  }

  if (!isBusy) {
    // Not busy -> clean meta
    return {
      outlookBusy: false,
      outlookCount: 0,
      outlookHash: null,
      outlookUpdatedAt: FieldValue.serverTimestamp(),
    }
  }

  const ids = Array.isArray(overlapIds) ? overlapIds.filter(Boolean) : []
  const hash = sha256(ids.sort().join("|"))

  return {
    outlookBusy: true,
    outlookCount: ids.length,
    outlookHash: hash,
    outlookUpdatedAt: FieldValue.serverTimestamp(),
  }
}

function hasMetaDiff({ data, patch }) {
  // Quick check to avoid writes if unchanged
  if (!patch) return false

  // When debug disabled we delete fields -> write only if they exist
  const deleting =
    patch.outlookBusy && typeof patch.outlookBusy === "object" && patch.outlookBusy._methodName === "FieldValue.delete"
  if (deleting) {
    const hasAny =
      data.outlookBusy !== undefined ||
      data.outlookCount !== undefined ||
      data.outlookHash !== undefined ||
      data.outlookUpdatedAt !== undefined
    return hasAny
  }

  // Compare primitives only (updatedAt is serverTimestamp -> ignore)
  const isBusy = Boolean(patch.outlookBusy)
  const count = Number(patch.outlookCount || 0)
  const hash = patch.outlookHash || null

  if (Boolean(data.outlookBusy) !== isBusy) return true
  if (Number(data.outlookCount || 0) !== count) return true
  if ((data.outlookHash || null) !== hash) return true

  return false
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex")
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

function getOverlapMeta({ start, end, intervals }) {
  // intervals are sorted and merged; we can early-break
  const startMs = start.getTime()
  const endMs = end.getTime()

  const ids = new Set()

  for (const it of intervals) {
    const itStart = it.start.getTime()
    const itEnd = it.end.getTime()

    if (itStart >= endMs) break
    if (itEnd <= startMs) continue

    // overlap
    if (Array.isArray(it.ids)) it.ids.forEach((x) => ids.add(x))
    else if (it.uid) ids.add(it.uid)
  }

  return {
    isBusy: ids.size > 0,
    ids: Array.from(ids),
  }
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
