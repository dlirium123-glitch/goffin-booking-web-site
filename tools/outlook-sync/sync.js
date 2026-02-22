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

// slotId = YYYYMMDD_HHMM
function slotIdFromDate(d) {
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  const mi = pad2(d.getMinutes())
  return `${yyyy}${mm}${dd}_${hh}${mi}`
}

function dateFromSlotId(slotId) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(String(slotId || ""))
  if (!m) return null
  const yy = Number(m[1])
  const mo = Number(m[2])
  const dd = Number(m[3])
  const hh = Number(m[4])
  const mi = Number(m[5])
  const d = new Date(yy, mo - 1, dd, hh, mi, 0, 0)
  if (Number.isNaN(d.getTime())) return null
  return d
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

function isOutlookBlocked(doc) {
  const status = String(doc?.status || "").toLowerCase()
  const reason = String(doc?.blockedReason || "").toLowerCase()
  return status === "blocked" && reason === "outlook"
}

function publicStatusFromFreeSlot(doc) {
  const status = String(doc?.status || "free").toLowerCase()
  if (status === "blocked") return "busy"
  if (status === "pending") return "busy"
  if (status === "validated") return "busy"
  return "free"
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

  // 1) Fetch ICS
  let icsText = ""
  try {
    const res = await fetch(icsUrl)
    if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`)
    icsText = await res.text()
  } catch (e) {
    await setSyncHealth({ col: syncHealthCol, status: "failed", reason: "fetch_failed", message: String(e.message || e) })
    throw e
  }

  // 2) Parse ICS
  let parsed
  try {
    parsed = ical.sync.parseICS(icsText)
  } catch (e) {
    await setSyncHealth({ col: syncHealthCol, status: "failed", reason: "parse_failed", message: String(e.message || e) })
    throw e
  }

  // 3) Compute busyIds (RRULE supported)
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

  // 4) Load existing freeSlots range
  const existing = new Map()
  try {
    const fromTs = Timestamp.fromDate(fromDate)
    const toTs = Timestamp.fromDate(toDate)
    const snap = await freeSlotsCol.where("start", ">=", fromTs).where("start", "<", toTs).get()
    snap.forEach((d) => existing.set(d.id, { id: d.id, ...(d.data() || {}) }))
  } catch (e) {
    await setSyncHealth({
      col: syncHealthCol,
      status: "failed",
      reason: "firestore_read_failed",
      message: String(e.message || e),
    })
    throw e
  }

  // 5) Build EFFECTIVE state map (this is the key fix)
  const effective = new Map(existing) // clone
  const nowServer = FieldValue.serverTimestamp()
  const writes = []

  // Ensure any busy slot exists in effective (with start/end)
  for (const id of busyIds) {
    if (!effective.has(id)) {
      const d = dateFromSlotId(id)
      if (!d) continue
      effective.set(id, {
        id,
        start: Timestamp.fromDate(d),
        end: Timestamp.fromDate(addMinutes(d, slotMinutes)),
        status: "free",
        blockedReason: null,
      })
    }
  }

  // A) Apply Outlook busy blocks in effective + schedule writes
  for (const id of busyIds) {
    const ex = effective.get(id)

    // If validated => do NOT override freeSlots, but public must be busy
    if (ex && isProtectedBlocked(ex)) {
      // only public busy (mirror will also set busy, but we keep it safe)
      continue
    }

    const d = ex?.start?.toDate ? ex.start.toDate() : dateFromSlotId(id)
    const startTs = ex?.start || (d ? Timestamp.fromDate(d) : null)
    const endTs = ex?.end || (d ? Timestamp.fromDate(addMinutes(d, slotMinutes)) : null)

    effective.set(id, {
      ...(ex || { id }),
      start: startTs,
      end: endTs,
      status: "blocked",
      blockedReason: "outlook",
      updatedAt: nowServer,
      createdAt: ex?.createdAt || nowServer,
    })
  }

  // B) Cleanup: unblock old outlook blocks no longer busy
  for (const [id, doc] of effective.entries()) {
    if (!isOutlookBlocked(doc)) continue
    if (busyIds.has(id)) continue

    // Back to free (do not touch validated ever — but outlookBlocked implies not validated)
    effective.set(id, {
      ...doc,
      status: "free",
      blockedReason: null,
      updatedAt: nowServer,
    })
  }

  // 6) Generate writes from effective map
  //    - write freeSlots changes for outlook blocks/cleanup
  //    - mirror publicSlots for ALL docs in range (effective)
  for (const [id, doc] of effective.entries()) {
    // Only sync within [fromDate, toDate)
    const start = doc.start?.toDate ? doc.start.toDate() : null
    if (!start) continue
    if (start < fromDate || start >= toDate) continue

    const ex = existing.get(id)
    const protectedValidated = ex && isProtectedBlocked(ex)

    // Write freeSlots if not validated-protected and if we changed outlook-related state
    if (!protectedValidated) {
      // We only write if:
      // - busyIds has it (outlook block expected)
      // - OR it was outlook-blocked in existing and now freed
      const needOutlookBlock = busyIds.has(id)
      const wasOutlookBlocked = ex && isOutlookBlocked(ex)
      const isNowOutlookBlocked = isOutlookBlocked(doc)

      const shouldWriteFree =
        (needOutlookBlock && !protectedValidated) ||
        (wasOutlookBlocked && !needOutlookBlock) ||
        (isNowOutlookBlocked !== wasOutlookBlocked)

      if (shouldWriteFree) {
        // Ensure start/end always stored
        const startTs = doc.start || Timestamp.fromDate(start)
        const endTs = doc.end || Timestamp.fromDate(addMinutes(start, slotMinutes))

        writes.push({
          ref: freeSlotsCol.doc(id),
          data: {
            start: startTs,
            end: endTs,
            status: doc.status || "free",
            blockedReason: doc.blockedReason || null,
            updatedAt: nowServer,
            createdAt: ex ? ex.createdAt || nowServer : nowServer,
          },
          merge: true,
        })
      }
    }

    // Mirror publicSlots ALWAYS (full-range mirror)
    const startTs2 = doc.start || Timestamp.fromDate(start)
    const endTs2 = doc.end || Timestamp.fromDate(addMinutes(start, slotMinutes))

    // validated/outlook/blocked => busy; free => free
    const pubStatus = publicStatusFromFreeSlot(doc)

    writes.push({
      ref: publicSlotsCol.doc(id),
      data: {
        start: startTs2,
        end: endTs2,
        status: pubStatus,
        updatedAt: nowServer,
      },
      merge: true,
    })
  }

  // 7) Commit batches
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
    meta: {
      eventsSeen,
      occurrencesSeen,
      busySlots: busyIds.size,
      freeSlotsInRange: existing.size,
      effectiveSlotsInRange: effective.size,
      writes: writes.length,
    },
  })

  console.log("Outlook sync done ✅", {
    writes: writes.length,
    busy: busyIds.size,
    freeSlotsInRange: existing.size,
    effectiveSlotsInRange: effective.size,
  })
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