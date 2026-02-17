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
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  return hh * 60 + mm
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

function isBlocked(doc) {
  const status = String(doc?.status || "").toLowerCase()
  return status === "blocked"
}

function isValidatedBlocked(doc) {
  const status = String(doc?.status || "").toLowerCase()
  const reason = String(doc?.blockedReason || "").toLowerCase()
  return status === "blocked" && reason === "validated"
}

function isOutlookBlocked(doc) {
  const status = String(doc?.status || "").toLowerCase()
  const reason = String(doc?.blockedReason || "").toLowerCase()
  return status === "blocked" && reason === "outlook"
}

function pickCreatedAt({ existingDoc, nowServer }) {
  if (existingDoc?.createdAt) return existingDoc.createdAt
  return nowServer
}

async function setSyncHealth({ col, status, reason, message, meta }) {
  const nowServer = FieldValue.serverTimestamp()
  await col.doc("outlook").set(
    {
      status,
      reason: reason || null,
      message: message || null,
      meta: meta || null,
      updatedAt: nowServer
    },
    { merge: true }
  )
}

async function fetchWithTimeout(url, timeoutMs = 20000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "goffin-booking-outlook-sync/1.0"
      }
    })
    return res
  } finally {
    clearTimeout(t)
  }
}

function eachDayBetween(fromDate, toDate) {
  const days = []
  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 0, 0, 0, 0)
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 0, 0, 0, 0)

  while (cursor < end) {
    days.push(new Date(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function buildBusyIdsFromEvents({
  events,
  fromDate,
  toDate,
  dayStartMin,
  dayEndMin,
  slotMinutes
}) {
  const busyIds = new Set()
  const lastStartMin = dayEndMin - slotMinutes

  for (const ev of events) {
    const start = ev.start instanceof Date ? ev.start : null
    const end = ev.end instanceof Date ? ev.end : null
    if (!start || !end) continue
    if (end <= fromDate || start >= toDate) continue

    const winStart = new Date(Math.max(start.getTime(), fromDate.getTime()))
    const winEnd = new Date(Math.min(end.getTime(), toDate.getTime()))
    const days = eachDayBetween(winStart, addMinutes(winEnd, 1))

    for (const day of days) {
      if (isWeekend(day)) continue

      // slots de la journée (heures ouvrées)
      for (let mins = dayStartMin; mins <= lastStartMin; mins += slotMinutes) {
        const slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
        slotStart.setMinutes(mins)
        const slotEnd = addMinutes(slotStart, slotMinutes)

        if (slotEnd <= winStart) continue
        if (slotStart >= winEnd) continue

        if (rangesOverlap(slotStart, slotEnd, start, end)) busyIds.add(slotIdFromDate(slotStart))
      }
    }
  }

  return busyIds
}

async function loadExistingByRange({ col, fromDate, toDate }) {
  const fromTs = Timestamp.fromDate(fromDate)
  const toTs = Timestamp.fromDate(toDate)
  const snap = await col.where("start", ">=", fromTs).where("start", "<", toTs).get()

  const map = new Map()
  snap.forEach((d) => map.set(d.id, d.data() || {}))
  return map
}

async function commitWrites({ db, writes }) {
  const MAX = 450
  for (let i = 0; i < writes.length; i += MAX) {
    const batch = db.batch()
    writes.slice(i, i + MAX).forEach(({ ref, data, merge }) => {
      batch.set(ref, data, { merge: merge !== false })
    })
    await batch.commit()
  }
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
      message: "OUTLOOK_ICS_URL absent"
    })
    console.log("Aborted: missing OUTLOOK_ICS_URL")
    return
  }

  const now = new Date()
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + startOffsetDays)
  const toDate = new Date(fromDate.getTime() + daysForward * 24 * 60 * 60000)

  console.log("Outlook sync", {
    projectId,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    daysForward,
    slotMinutes,
    dayStartStr,
    dayEndStr
  })

  // ---- Fetch ICS
  let icsText = ""
  try {
    const res = await fetchWithTimeout(icsUrl, 20000)
    if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`)
    icsText = await res.text()
  } catch (e) {
    await setSyncHealth({
      col: syncHealthCol,
      status: "failed",
      reason: "fetch_failed",
      message: String(e.message || e)
    })
    throw e
  }

  // ---- Parse ICS
  let parsed = null
  try {
    parsed = ical.sync.parseICS(icsText)
  } catch (e) {
    await setSyncHealth({
      col: syncHealthCol,
      status: "failed",
      reason: "parse_failed",
      message: String(e.message || e)
    })
    throw e
  }

  const events = Object.values(parsed).filter((ev) => ev && ev.type === "VEVENT")

  // ---- Compute busy slot ids
  const busyIds = buildBusyIdsFromEvents({
    events,
    fromDate,
    toDate,
    dayStartMin,
    dayEndMin,
    slotMinutes
  })

  console.log("Busy slots from Outlook:", busyIds.size)

  // ---- Load existing internal slots
  let existing = new Map()
  try {
    existing = await loadExistingByRange({ col: freeSlotsCol, fromDate, toDate })
  } catch (e) {
    await setSyncHealth({
      col: syncHealthCol,
      status: "failed",
      reason: "firestore_read_failed",
      message: String(e.message || e)
    })
    throw e
  }

  const nowServer = FieldValue.serverTimestamp()
  const writes = []

  let blockedApplied = 0
  let blockedSkippedValidated = 0
  let blockedSkippedOtherBlocked = 0
  let releasedOutlook = 0
  let conflictsMarked = 0

  // 1) Apply Outlook busy blocks
  for (const id of busyIds) {
    const ex = existing.get(id)
    const createdAt = pickCreatedAt({ existingDoc: ex, nowServer })

    // ✅ si VALIDATED => ne jamais toucher le statut, mais public doit être busy
    if (ex && isValidatedBlocked(ex)) {
      blockedSkippedValidated++

      // Option: marquer conflit (utile en admin)
      writes.push({
        ref: freeSlotsCol.doc(id),
        data: {
          conflict: true,
          conflictReason: "outlook_overlaps_validated",
          conflictUpdatedAt: nowServer
        },
        merge: true
      })
      conflictsMarked++

      writes.push({
        ref: publicSlotsCol.doc(id),
        data: {
          status: "busy",
          updatedAt: nowServer,
          createdAt
        },
        merge: true
      })
      continue
    }

    // ✅ si déjà blocked pour AUTRE raison (maintenance, manuel, etc.) => ne pas écraser
    if (ex && isBlocked(ex) && !isOutlookBlocked(ex)) {
      blockedSkippedOtherBlocked++

      writes.push({
        ref: publicSlotsCol.doc(id),
        data: {
          status: "busy",
          updatedAt: nowServer,
          createdAt
        },
        merge: true
      })
      continue
    }

    // ✅ OK: on bloque (ou re-bloque) en outlook
    writes.push({
      ref: freeSlotsCol.doc(id),
      data: {
        status: "blocked",
        blockedReason: "outlook",
        conflict: false,
        conflictReason: null,
        updatedAt: nowServer,
        createdAt
      },
      merge: true
    })

    writes.push({
      ref: publicSlotsCol.doc(id),
      data: {
        status: "busy",
        updatedAt: nowServer,
        createdAt
      },
      merge: true
    })

    blockedApplied++
  }

  // 2) Cleanup: release slots that were blocked by outlook but no longer busy
  for (const [id, doc] of existing.entries()) {
    if (!isOutlookBlocked(doc)) continue
    if (busyIds.has(id)) continue

    writes.push({
      ref: freeSlotsCol.doc(id),
      data: {
        status: "free",
        blockedReason: null,
        conflict: false,
        conflictReason: null,
        updatedAt: nowServer
      },
      merge: true
    })

    writes.push({
      ref: publicSlotsCol.doc(id),
      data: {
        status: "free",
        updatedAt: nowServer
      },
      merge: true
    })

    releasedOutlook++
  }

  // ---- Commit
  await commitWrites({ db, writes })

  await setSyncHealth({
    col: syncHealthCol,
    status: "ok",
    meta: {
      busySlots: busyIds.size,
      blockedApplied,
      blockedSkippedValidated,
      blockedSkippedOtherBlocked,
      releasedOutlook,
      conflictsMarked
    }
  })

  console.log("Outlook sync done ✅", {
    busySlots: busyIds.size,
    writes: writes.length,
    blockedApplied,
    blockedSkippedValidated,
    blockedSkippedOtherBlocked,
    releasedOutlook,
    conflictsMarked
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
          updatedAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      )
    }
  } catch {}
  process.exit(1)
})
