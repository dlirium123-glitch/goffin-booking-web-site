/* eslint-disable no-console */
const { Firestore, Timestamp } = require("@google-cloud/firestore")

function getEnv(name, fallback) {
  const v = process.env[name]
  if (v == null || v === "") return fallback
  return v
}

async function main() {
  const projectId = getEnv("FIREBASE_PROJECT_ID", null)
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID")

  const limit = Number(getEnv("LIMIT", "500"))
  const db = new Firestore({ projectId })
  const nowTs = Timestamp.fromDate(new Date())

  const expiredHoldRefs = await loadExpiredRefs({ col: db.collection("holds"), nowTs, limit })
  const expiredHoldSlotRefs = await loadExpiredRefs({ col: db.collection("holdSlots"), nowTs, limit })
  const refs = [...expiredHoldSlotRefs, ...expiredHoldRefs]

  if (refs.length === 0) {
    console.log("No expired holds")
    return
  }

  console.log("Expired hold docs:", expiredHoldRefs.length, "Expired hold slots:", expiredHoldSlotRefs.length)
  await deleteRefsInBatches({ db, refs })
  console.log("Cleanup done", {
    deleted: refs.length,
    holdDocs: expiredHoldRefs.length,
    holdSlots: expiredHoldSlotRefs.length,
  })
}

async function loadExpiredRefs({ col, nowTs, limit }) {
  const snap = await col.where("expiresAt", "<=", nowTs).limit(limit).get()
  return snap.docs.map((d) => d.ref)
}

async function deleteRefsInBatches({ db, refs }) {
  const MAX = 450
  for (let i = 0; i < refs.length; i += MAX) {
    const batch = db.batch()
    refs.slice(i, i + MAX).forEach((ref) => batch.delete(ref))
    await batch.commit()
  }
}

main().catch((e) => {
  console.error("Cleanup failed", e)
  process.exit(1)
})
