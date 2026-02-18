/* eslint-disable no-console */
const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore")
const fetch = require("node-fetch")
const ical = require("node-ical")

function getEnv(name, fallback) {
  const v = process.env[name]
  if (v == null || v === "") return fallback
  return v
}

function pad2(n) {
  return String(n).padStart(2, "0")
}

function slotIdFromDate(d) {
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mi = pad2(d.getMinutes())
  return `${yyyy}${mm}${dd}_${hh}${mi}`
}

function addMinutes(d, minutes) {
  return new Date(d.getTime() + minutes * 60000)
}

function isWeekend(d) {
  const dow = d.getDay()
  return dow === 0 || dow === 6
}

function parseHHMM(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || ""))
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function clampToWorkHours(date, dayStartMin, dayEndMin) {
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  const mins = date.getHours() * 60 + date.getMinutes()
  if (mins < dayStartMin) {
    startOfDay.setMinutes(dayStartMin)
    return startOfDay
  }
  if (mins > dayEndMin) {
    startOfDay.setMinutes(dayEndMin)
    return startOfDay
  }
  return date
}

function roundDownToSlot(date, dayStartMin, slotMinutes) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0)
  base.setMinutes(dayStartMin)
  if (date <= base) return base

  const deltaMin = Math.floor((date.getTime() - base.getTime()) / 60000)
  const steps = Math.floor(deltaMin / slotMinutes)
  return addMinutes(base, steps * slotMinutes)
}

function isProtectedBlocked(doc) {
  const status = String(doc?.status || "").toLowerCase()
  const reason = String(doc?.blockedReason || "").toLowerCase()
  if (status !== "blocked") return false
  return reason === "validated"
}

async function setSyncHealth({ col, status, reason, message, meta }) {
  const nowServer = FieldValue.serverTimestamp()
  await col.doc("outlook").set(
    {
      status,
      reason: reason || null,
      message: message || null,
      meta: meta || null,
      updatedAt: nowServer,
    },
    { merge: true }
  )
}

// ✅ Expand VEVENT (RRULE) safely
function collectEventOccurrences({ ev, fromDate, toDate }) {
  const occurrences = []

  const start = ev.start instanceof Date ? ev.start : null
  const end = ev.end instanceof Date ? ev.end : null
  if (!start || !end) return occurrences

  // Non-récurrent
  if (!ev.rrule) {
    occurrences.push({ start, end })
    return occurrences
  }

  // Récurrent (RRULE)
  try {
    const between = ev.rrule.between(fromDate, toDate, true)
    between.forEach((occStart) => {
      const durationMs = end.getTime() - start.getTime()
      const occEnd = new Date(occStart.getTime() + durationMs)

      // exclusions (EXDATE)
      if (ev.exdate) {
        const iso = occStart.toISOString()
        const isExcluded = Object.values(ev.exdate).some((d) => d instanceof Date && d.toISOString() === iso)
        if (isExcluded) return
      }

      occurrences.push({ start: occStart, end: occEnd })
    })
  } catch (e) {
    // fallback: au moins l'event "master"
    occurrences.push({ start, end })
  }

  return occurrences
}

async function main() {
  const projectId = getEnv("FIREBASE_PROJECT_ID", null)
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID")

  const icsUrl = getEnv("OUTLOOK_ICS_URL", null)
  const daysForward = Number(getEnv("DAYS_FORWARD", "90"))
  const slotMinutes = Number(getEnv("SLOT_MINUTES", "90"))
  const startOffsetDays = Number(getEnv("START_OFFSET_DAYS", "0"))

  const dayStartStr = getEnv("DAY_START", "09:30")
  const dayEndStr = getEnv("DAY_END", "17:30")
  const dayStartMin = parseHHMM(dayStartStr)
  const dayEndMin = parseHHMM(dayEndStr)
  if (dayStartMin == null || dayEndMin == null) throw new Error("Invalid DAY_START/DAY_END")

  const db = new Firestore({ projectId })
  const freeSlotsCol = db.collection("freeSlots")
  const publicSlotsCol = db.collection("publicSlots")
  const syncHealthCol = db.collection("syncHealth")

  if (!icsUrl) {
    await setSyncHealth({
      col: syncHealthCol,
      status: "aborted",
      reason: "missing_ics_url",
      message: "OUTLOOK_ICS_URL absent",
    })
    console.log("Aborted: missing OUTLOOK_ICS_URL")
    return
  }

  const now = new Date()
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + startOffsetDays)
  const toDate = new Date(fromDate.getTime() + daysForward * 24 * 60 * 60000)

  console.log("Outlook sync", { projectId, from: fromDate.toISOString(), to: toDate.toISOString() })

  let icsText = ""
  try {
    const res = await fetch(icsUrl)
    if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`)
    icsText = await res.text()
  } catch (e) {
    await setSyncHealth({ col: syncHealthCol, status: "failed", reason: "fetch_failed", message: String(e.message || e) })
    throw e
  }

  let parsed
  try {
    parsed = ical.sync.parseICS(icsText)
  } catch (e) {
    await setSyncHealth({ col: syncHealthCol, status: "failed", reason: "parse_failed", message: String(e.message || e) })
    throw e
  }

  // Build busy slot ids from events (RRULE supported)
  const busyIds = new Set()
  let eventsSeen = 0
  let occurrencesSeen = 0

  Object.values(parsed).forEach((ev) => {
    if (!ev || ev.type !== "VEVENT") return
    eventsSeen++

    // ignore cancelled / transparent
    if (String(ev.status || "").toUpperCase() === "CANCELLED") return
    if (String(ev.transp || "").toUpperCase() === "TRANSPARENT") return

    const occs = collectEventOccurrences({ ev, fromDate, toDate })
    occs.forEach(({ start, end }) => {
      if (end <= fromDate || start >= toDate) return
      occurrencesSeen++

      let cursor = new Date(Math.max(start.getTime(), fromDate.getTime()))
      const windowEnd = new Date(Math.min(end.getTime(), toDate.getTime()))

      while (cursor < windowEnd) {
        if (!isWeekend(cursor)) {
          const dayClamped = clampToWorkHours(cursor, dayStartMin, dayEndMin)
          const slotStart = roundDownToSlot(dayClamped, dayStartMin, slotMinutes)
          const slotEnd = addMinutes(slotStart, slotMinutes)

          const slotStartMin = slotStart.getHours() * 60 + slotStart.getMinutes()
          if (slotStartMin >= dayStartMin && slotStartMin <= (dayEndMin - slotMinutes)) {
            if (rangesOverlap(slotStart, slotEnd, start, end)) busyIds.add(slotIdFromDate(slotStart))
          }
        }
        cursor = addMinutes(cursor, 15)
      }
    })
  })

  console.log("Events seen:", eventsSeen, "Occurrences:", occurrencesSeen, "Busy slots:", busyIds.size)

  // Load existing freeSlots range to avoid overwriting validated + cleanup old outlook blocks
  const existing = new Map()
  try {
    const fromTs = Timestamp.fromDate(fromDate)
    const toTs = Timestamp.fromDate(toDate)
    const snap = await freeSlotsCol.where("start", ">=", fromTs).where("start", "<", toTs).get()
    snap.forEach((d) => existing.set(d.id, d.data() || {}))
  } catch (e) {
    await setSyncHealth({ col: syncHealthCol, status: "failed", reason: "firestore_read_failed", message: String(e.message || e) })
    throw e
  }

  const nowServer = FieldValue.serverTimestamp()
  const writes = []

  // 1) Apply Outlook busy blocks
  for (const id of busyIds) {
    const ex = existing.get(id)

    if (ex && isProtectedBlocked(ex)) {
      writes.push({
        ref: publicSlotsCol.doc(id),
        data: { status: "busy", updatedAt: nowServer },
        merge: true,
      })
      continue
    }

    writes.push({
      ref: freeSlotsCol.doc(id),
      data: {
        status: "blocked",
        blockedReason: "outlook",
        updatedAt: nowServer,
        createdAt: ex ? ex.createdAt || nowServer : nowServer,
      },
      merge: true,
    })

    writes.push({
      ref: publicSlotsCol.doc(id),
      data: {
        status: "busy",
        updatedAt: nowServer,
      },
      merge: true,
    })
  }

  // 2) Cleanup: unblock old outlook blocks
  for (const [id, doc] of existing.entries()) {
    const status = String(doc?.status || "").toLowerCase()
    const reason = String(doc?.blockedReason || "").toLowerCase()
    if (status !== "blocked" || reason !== "outlook") continue
    if (busyIds.has(id)) continue

    writes.push({
      ref: freeSlotsCol.doc(id),
      data: {
        status: "free",
        blockedReason: null,
        updatedAt: nowServer,
      },
      merge: true,
    })

    writes.push({
      ref: publicSlotsCol.doc(id),
      data: {
        status: "free",
        updatedAt: nowServer,
      },
      merge: true,
    })
  }

  // Commit batches
  const MAX = 450
  for (let i = 0; i < writes.length; i += MAX) {
    const batch = db.batch()
    writes.slice(i, i + MAX).forEach(({ ref, data, merge }) => {
      batch.set(ref, data, { merge: merge !== false })
    })
    await batch.commit()
  }

  await setSyncHealth({
    col: syncHealthCol,
    status: "ok",
    meta: { eventsSeen, occurrencesSeen, busySlots: busyIds.size, writes: writes.length },
  })

  console.log("Outlook sync done ✅", { writes: writes.length, busy: busyIds.size })
}

main().catch(async (e) => {
  console.error("Outlook sync failed ❌", e)
  try {
    const projectId = getEnv("FIREBASE_PROJECT_ID", null)
    if (projectId) {
      const db = new Firestore({ projectId })
      await db.collection("syncHealth").doc("outlook").set(
        {
          status: "failed",
          reason: "exception",
          message: String(e.message || e),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    }
  } catch {}
  process.exit(1)
})
