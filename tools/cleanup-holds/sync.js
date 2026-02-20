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

  const now = new Date()
  const nowTs = Timestamp.fromDate(now)

  const col = db.collection("holds")
  const snap = await col.where("expiresAt", "<=", nowTs).limit(limit).get()

  if (snap.empty) {
    console.log("No expired holds ✅")
    return
  }

  const refs = snap.docs.map((d) => d.ref)
  console.log("Expired holds:", refs.length)

  const MAX = 450
  for (let i = 0; i < refs.length; i += MAX) {
    const batch = db.batch()
    refs.slice(i, i + MAX).forEach((ref) => batch.delete(ref))
    await batch.commit()
  }

  console.log("Cleanup done ✅", { deleted: refs.length })
}

main().catch((e) => {
  console.error("Cleanup failed ❌", e)
  process.exit(1)
})