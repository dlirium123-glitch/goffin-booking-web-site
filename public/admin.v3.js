/* ===== admin.v3.js (CLEAN) ===== */
/* eslint-disable no-console */

(function () {
  "use strict"

  if (!window.firebase) {
    console.error("Firebase SDK not loaded. Check <script> includes.")
    return
  }

  const auth = firebase.auth()
  const db = firebase.firestore()

  try {
    db.settings({ ignoreUndefinedProperties: true })
  } catch (_) {}

  // Admin-only collections
  const freeSlotsCol = db.collection("freeSlots")
  const slotsCol = db.collection("slots")
  const syncHealthCol = db.collection("syncHealth")
  const settingsCol = db.collection("settings")
  const requestsCol = db.collection("requests")
  const bookingsCol = db.collection("bookings")
  const holdsCol = db.collection("holds")
  const usersCol = db.collection("users")
  const publicSlotsCol = db.collection("publicSlots")

  async function ensureAdmin(user) {
    // Source de vérité: custom claim { admin: true }
    try {
      const token = await user.getIdTokenResult(true)
      return token && token.claims && token.claims.admin === true
    } catch (e) {
      console.warn("ensureAdmin() failed:", e)
      return false
    }
  }

  function redirectToHome() {
    window.location.href = "/"
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.warn("Not signed in → redirect /")
      redirectToHome()
      return
    }

    const ok = await ensureAdmin(user)
    if (!ok) {
      console.warn("Not admin → redirect /")
      redirectToHome()
      return
    }

    console.log("Admin OK:", user.email)

    // Ton code admin UI peut commencer ici.
    // Je n’écrase pas ton DOM: je te laisse brancher tes fonctions existantes.
  })

  // Expose tools (si ton UI appelle des fonctions globales)
  window.GoffinAdmin = {
    auth,
    db,
    cols: {
      freeSlotsCol,
      slotsCol,
      syncHealthCol,
      settingsCol,
      requestsCol,
      bookingsCol,
      holdsCol,
      usersCol,
      publicSlotsCol,
    },
    ensureAdmin,
  }
})()