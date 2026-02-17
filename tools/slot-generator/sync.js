/* eslint-disable no-console */
const { Firestore, Timestamp, FieldValue } = require("@google-cloud/firestore")

function getEnv(name, fallback) {
  const v = process.env[name]
  if (v == null || v === "") return fallback
  return v
}

function parseHHMM(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || ""))
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null
  return hh * 60 + mm
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

function buildDesiredSlots({
  now,
  daysForward,
  startOffsetDays,
  slotMinutes,
  dayStartMin,
  dayEndMin
}) {
  const lastStartMin = dayEndMin - slotMinutes
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + startOffsetDays)

  const desired = []
  for (let i = 0; i < daysForward; i++) {
    const day = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i)
    if (isWeekend(day)) continue

    for (let mins = dayStartMin; mins <= lastStartMin; mins += slotMinutes) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
      start.setMinutes(mins)
      const end = addMinutes(start, slotMinutes)

      desired.push({
        id: slotIdFromDate(start),
        start,
        end
      })
    }
  }
  return desired
}

async function loadExistingByRange({ col, fromDate, toDate }) {
  const fromTs = Timestamp.fromDate(fromDate)
  const toTs = Timestamp.fromDate(toDate)

  let query = col.where("start", ">=", fromTs).where("start", "<", toTs).orderBy("start")
  const map = new Map()

  while (true) {
    const snap = await query.limit(500).get()
    if (snap.empty) break

    snap.docs.forEach((doc) => {
      map.set(doc.id, doc.data() || {})
    })

    const last = snap.docs[snap.docs.length - 1]
    if (!last) break

    query = col
      .where("start", ">=", fromTs)
      .where("start", "<", toTs)
      .orderBy("start")
      .startAfter(last)

    if (snap.size < 500) break
  }

  return map
}

function isBlocked(doc) {
  const status = String(doc?.status || "").toLowerCase()
  return status === "blocked"
}

function toPublicStatusFromInternal(doc) {
  const status = String(doc?.status || "free").toLowerCase()
  if (status === "free") return "free"
  return "busy"
}

async function commitBatches({ db, writes }) {
  const MAX = 450
  for (let i = 0; i < writes.length; i += MAX) {
    const batch = db.batch()
    const chunk = writes.slice(i, i + MAX)
    chunk.forEach(({ ref, data, merge }) => {
      batch.set(ref, data, { merge: merge !== false })
    })
    await batch.commit()
  }
}

async function commitDeletes({ db, deletes }) {
  const MAX = 450
  for (let i = 0; i < deletes.length; i += MAX) {
    const batch = db.batch()
    const chunk = deletes.slice(i, i + MAX)
    chunk.forEach((ref) => batch.delete(ref))
    await batch.commit()
  }
}

function pickCreatedAt({ existingDoc, nowServer }) {
  if (existingDoc?.createdAt) return existingDoc.createdAt
  return nowServer
}

async function main() {
  const projectId = getEnv("FIREBASE_PROJECT_ID", null)
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID")

  const daysForward = Number(getEnv("DAYS_FORWARD", "90"))
  const slotMinutes = Number(getEnv("SLOT_MINUTES", "90"))
  const startOffsetDays = Number(getEnv("START_OFFSET_DAYS", "2"))

  const dayStartStr = getEnv("DAY_START", "09:30")
  const dayEndStr = getEnv("DAY_END", "17:30")
  const dayStartMin = parseHHMM(dayStartStr)
  const dayEndMin = parseHHMM(dayEndStr)
  if (dayStartMin == null || dayEndMin == null) throw new Error("Invalid DAY_START or DAY_END (expected HH:MM)")

  const cleanOrphanFree = getEnv("CLEAN_ORPHAN_FREE", "0") === "1"

  const db = new Firestore({ projectId })
  const freeSlotsCol = db.collection("freeSlots")      // interne (admin + sync)
  const publicSlotsCol = db.collection("publicSlots")  // public (client)

  const now = new Date()
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + startOffsetDays)
  const toDate = new Date(fromDate.getTime() + daysForward * 24 * 60 * 60000)

  console.log("Generate slots", {
    projectId,
    tz: getEnv("TZ", "system"),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    daysForward,
    slotMinutes,
    dayStartStr,
    dayEndStr,
    cleanOrphanFree
  })

  const desired = buildDesiredSlots({
    now,
    daysForward,
    startOffsetDays,
    slotMinutes,
    dayStartMin,
    dayEndMin
  })

  const desiredIds = new Set(desired.map((s) => s.id))
  console.log("Desired count:", desired.length)

  let existing = new Map()
  try {
    existing = await loadExistingByRange({ col: freeSlotsCol, fromDate, toDate })
  } catch (e) {
    console.error("Failed to read freeSlots range. Check indexes / permissions.", e)
    throw e
  }

  const nowServer = FieldValue.serverTimestamp()
  const writes = []

  let writtenFree = 0
  let skippedBlocked = 0
  let updatedPublic = 0

  for (const s of desired) {
    const ex = existing.get(s.id)
    const createdAt = pickCreatedAt({ existingDoc: ex, nowServer })

    // ✅ PRO: si le slot interne est "blocked", on ne le modifie JAMAIS
    if (ex && isBlocked(ex)) {
      skippedBlocked++

      const pubStatus = toPublicStatusFromInternal(ex) // blocked -> busy
      writes.push({
        ref: publicSlotsCol.doc(s.id),
        data: {
          start: Timestamp.fromDate(s.start),
          end: Timestamp.fromDate(s.end),
          status: pubStatus,
          createdAt,
          updatedAt: nowServer
        },
        merge: true
      })
      updatedPublic++
      continue
    }

    // ✅ interne = free (création/refresh safe)
    writes.push({
      ref: freeSlotsCol.doc(s.id),
      data: {
        start: Timestamp.fromDate(s.start),
        end: Timestamp.fromDate(s.end),
        status: "free",
        blockedReason: null,
        createdAt,
        updatedAt: nowServer
      },
      merge: true
    })
    writtenFree++

    // ✅ public mirror = free
    writes.push({
      ref: publicSlotsCol.doc(s.id),
      data: {
        start: Timestamp.fromDate(s.start),
        end: Timestamp.fromDate(s.end),
        status: "free",
        createdAt,
        updatedAt: nowServer
      },
      merge: true
    })
    updatedPublic++
  }

  // Optional cleanup: delete orphan FREE slots only (never delete blocked)
  const deletes = []
  if (cleanOrphanFree) {
    for (const [id, doc] of existing.entries()) {
      if (desiredIds.has(id)) continue

      const status = String(doc?.status || "").toLowerCase()
      if (status !== "free") continue

      deletes.push(freeSlotsCol.doc(id))
      deletes.push(publicSlotsCol.doc(id))
    }
  }

  await commitBatches({ db, writes })
  if (deletes.length) await commitDeletes({ db, deletes })

  console.log("Done ✅", {
    desired: desired.length,
    writtenFree,
    skippedBlocked,
    updatedPublic,
    deleted: deletes.length
  })
}

main().catch((e) => {
  console.error("Generator failed ❌", e)
  process.exit(1)
})
