/* ===== index.v3.js (CLEAN) ===== */
/* eslint-disable no-console */

(function () {
  "use strict"

  // ----------------------------
  // Boot / guard
  // ----------------------------
  if (!window.firebase) {
    console.error("Firebase SDK not loaded. Check <script> includes.")
    return
  }

  // Firebase (Compat)
  const app = firebase.app()
  const auth = firebase.auth()
  const db = firebase.firestore()

  // Firestore safety (optional)
  try {
    db.settings({ ignoreUndefinedProperties: true })
  } catch (_) {}

  // Collections (CANONIQUE)
  const usersCol = db.collection("users")
  const publicSlotsCol = db.collection("publicSlots")
  const holdsCol = db.collection("holds")
  const bookingsCol = db.collection("bookings")
  const requestsCol = db.collection("requests")

  // ----------------------------
  // Admin (custom claim only)
  // ----------------------------
  async function isAdminUser(user) {
    // Source de vérité: custom claim { admin: true }
    try {
      const token = await user.getIdTokenResult(true) // force refresh
      return token && token.claims && token.claims.admin === true
    } catch (e) {
      console.warn("isAdminUser() failed:", e)
      return false
    }
  }

  // ----------------------------
  // Profil user (CANONIQUE /users/{uid})
  // ----------------------------
  async function loadMyProfile(uid) {
    const snap = await usersCol.doc(uid).get()
    return snap.exists ? snap.data() : null
  }

  async function saveMyProfile(uid, data) {
    const payload = {
      email: String(data.email || "").trim(),
      company: String(data.company || "").trim(),
      vat: String(data.vat || "").trim(),
      phone: String(data.phone || "").trim(),
      hqAddress: String(data.hqAddress || "").trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }

    const ref = usersCol.doc(uid)
    const existing = await ref.get()
    if (!existing.exists) {
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp()
    }

    await ref.set(payload, { merge: true })
  }

  // ----------------------------
  // Utilitaires
  // ----------------------------
  function qs(sel) { return document.querySelector(sel) }
  function qsa(sel) { return Array.from(document.querySelectorAll(sel)) }

  function setText(sel, text) {
    const el = qs(sel)
    if (el) el.textContent = text
  }

  function show(sel, on = true) {
    const el = qs(sel)
    if (!el) return
    el.style.display = on ? "" : "none"
  }

  function toast(msg) {
    console.log(msg)
    // Si tu as déjà un UI toast, plug ici.
    // Sinon on garde console + éventuellement alert en debug :
    // alert(msg)
  }

  // ----------------------------
  // Slots: lecture public (client)
  // ----------------------------
  async function loadPublicSlots(rangeStart, rangeEnd) {
    // NOTE: ton code initial gère sûrement un range / rendu calendrier.
    // Ici on laisse le comportement existant si déjà codé ailleurs.
    // Cette fonction est volontairement “safe”: read-only sur publicSlots.
    const snap = await publicSlotsCol.get()
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  // ----------------------------
  // Holds / Booking / Request
  // ----------------------------
  function slotIdFromDate(d) {
    const pad2 = (n) => String(n).padStart(2, "0")
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

  async function createHoldForSlot(user, slot) {
    const slotId = slot.id || slot.slotId || slot.slotID || null
    if (!slotId) throw new Error("Slot id missing")

    const now = new Date()
    const expiresAt = addMinutes(now, 15)

    await holdsCol.doc(slotId).set({
      uid: user.uid,
      start: slot.start,
      end: slot.end,
      expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt),
      status: "hold",
    })
  }

  async function createBookingAndRequest(user, payload) {
    // payload attendu: { slotId, start, end, slotIds[], totalSlots, durationMinutes }
    const createdAt = firebase.firestore.FieldValue.serverTimestamp()

    // booking doc id = slotId (simple)
    await bookingsCol.doc(payload.slotId).set({
      slotId: payload.slotId,
      uid: user.uid,
      status: "pending",
      start: payload.start,
      end: payload.end,
      createdAt,
    })

    // request doc id = requestId (généré côté client)
    const requestId = payload.requestId || `REQ_${Date.now()}_${Math.random().toString(16).slice(2)}`
    await requestsCol.doc(requestId).set({
      requestId,
      uid: user.uid,
      status: "pending",
      start: payload.start,
      end: payload.end,
      slotIds: payload.slotIds || [payload.slotId],
      totalSlots: payload.totalSlots || 1,
      durationMinutes: payload.durationMinutes || 60,
      createdAt,
    })

    return requestId
  }

  // ----------------------------
  // Auth flows (conserve ton UI)
  // ----------------------------
  async function signIn(email, password) {
    const cred = await auth.signInWithEmailAndPassword(email, password)
    return cred.user
  }

  async function signUp(email, password) {
    const cred = await auth.createUserWithEmailAndPassword(email, password)
    return cred.user
  }

  async function signOut() {
    await auth.signOut()
  }

  // ----------------------------
  // App state
  // ----------------------------
  let currentUser = null
  let currentIsAdmin = false

  auth.onAuthStateChanged(async (user) => {
    currentUser = user || null
    currentIsAdmin = false

    if (!user) {
      // UI: show login form, hide app
      // ⚠️ ici je ne connais pas tes IDs exacts, donc je n’écrase pas ton DOM.
      console.log("Signed out")
      return
    }

    // refresh token result + admin claim
    currentIsAdmin = await isAdminUser(user)
    console.log("Signed in:", user.email, "admin:", currentIsAdmin)

    // Optionnel: afficher un lien / bouton admin si admin
    // show("#adminLink", currentIsAdmin)

    // Charger profil
    const profile = await loadMyProfile(user.uid)
    if (!profile) {
      console.log("No profile yet (users/{uid}). Show profile form step.")
      // Ton code UI existant doit déjà gérer l’étape profil.
      // Ici on ne casse pas ton DOM.
    } else {
      console.log("Profile loaded:", profile)
    }
  })

  // ----------------------------
  // Expose minimal hooks (si ton HTML appelle des fonctions globales)
  // ----------------------------
  window.GoffinApp = {
    auth,
    db,
    signIn,
    signUp,
    signOut,
    saveMyProfile,
    loadMyProfile,
    loadPublicSlots,
    createHoldForSlot,
    createBookingAndRequest,
    slotIdFromDate,
  }
})()