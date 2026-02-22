/* ===============================
   Admin — Goffin Booking (v3)
   Version: 2026-02-21-1 (Spark-only, IDs fixed)
   =============================== */
/* eslint-disable no-console */
const ADMIN_VERSION = "admin-2026-02-21-1"
console.log("admin.v3.js chargé ✅", ADMIN_VERSION)

document.addEventListener("DOMContentLoaded", async () => {
  const vEl = document.getElementById("adminVersion")
  if (vEl) vEl.textContent = ADMIN_VERSION

  async function waitForFirebase(maxMs = 10000) {
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      if (window.firebase && firebase.auth && firebase.firestore) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return false
  }

  const okFirebase = await waitForFirebase(10000)
  if (!okFirebase) {
    console.error("Firebase non chargé (/__/firebase/init.js ?) : admin.v3.js stop")
    return
  }

  const auth = firebase.auth()
  const db = firebase.firestore()
  const FieldValue = firebase.firestore.FieldValue

  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  } catch {
    // ignore
  }

  // Collections
  const appointmentsCol = db.collection("appointments")
  const modifsCol = db.collection("modificationRequests")
  const adminsCol = db.collection("admins")
  const slotsCol = db.collection("slots")
  const freeSlotsCol = db.collection("freeSlots")
  const syncHealthCol = db.collection("syncHealth")

  // DOM essentiels
  const pill = document.getElementById("pillStatus")
  const statusText = document.getElementById("statusText")
  const btnLogin = document.getElementById("btnLogin")
  const btnLogout = document.getElementById("btnLogout")
  const overlay = document.getElementById("overlay")
  const loginErr = document.getElementById("loginErr")

  // Sync health
  const syncHealthBanner = document.getElementById("syncHealthBanner")

  // Appointments
  const apptList = document.getElementById("apptList")
  const apptEmpty = document.getElementById("apptEmpty")
  const apptMsg = document.getElementById("apptMsg")
  const apptOk = document.getElementById("apptOk")

  // Modifs (optionnels)
  const modifList = document.getElementById("modifList")
  const modifEmpty = document.getElementById("modifEmpty")
  const modifMsg = document.getElementById("modifMsg")
  const modifOk = document.getElementById("modifOk")

  // FreeSlots gen
  const btnGenFreeSlots = document.getElementById("btnGenFreeSlots")
  const btnGenPreview = document.getElementById("btnGenPreview")
  const slotsMsg = document.getElementById("slotsMsg")
  const slotsOk = document.getElementById("slotsOk")

  // Planning semaine
  const planningGrid = document.getElementById("planningGrid")

  // Liens GitHub (présents dans admin.html)
  const btnOpenOutlookWorkflow = document.getElementById("btnOpenOutlookWorkflow")
  const btnOpenActionsAll = document.getElementById("btnOpenActionsAll")

  const mustHave = [pill, statusText, btnLogin, btnLogout, overlay, loginErr, apptList, apptEmpty, apptMsg, apptOk]
  if (mustHave.some((x) => !x)) {
    console.error("admin.html: IDs essentiels manquants (pill/status/login/appointments).")
    return
  }

  // ✅ Spark-only : on ne fait PAS de déclenchement workflow via API
  // (on garde juste les liens dans admin.html)
  if (btnOpenOutlookWorkflow) btnOpenOutlookWorkflow.rel = "noopener noreferrer"
  if (btnOpenActionsAll) btnOpenActionsAll.rel = "noopener noreferrer"

  let isAdmin = false
  let _unsubSyncHealth = null

  // ====== CONFIG ======
  const SLOT_MINUTES = 90
  const DAY_START_MIN = 9 * 60 + 30
  const DAY_END_MIN = 17 * 60 + 30
  const LAST_START_MIN = DAY_END_MIN - SLOT_MINUTES
  const WEEKS = 8

  const BLOCK_REASON = {
    OUTLOOK: "outlook",
    VALIDATED: "validated",
  }

  // ====== UI helpers ======
  function setStatus(isAdminLogged) {
    if (isAdminLogged) {
      pill.classList.add("ok")
      statusText.textContent = "Connecté (admin)"
      btnLogout.hidden = false
      btnLogin.hidden = true
    } else {
      pill.classList.remove("ok")
      statusText.textContent = "Non connecté"
      btnLogout.hidden = true
      btnLogin.hidden = false
    }
  }

  function showErr(el, t) {
    if (!el) return
    el.style.display = "block"
    el.hidden = false
    el.textContent = t
  }

  function hideErr(el) {
    if (!el) return
    el.style.display = "none"
    el.hidden = true
    el.textContent = ""
  }

  function showOk(el, t) {
    if (!el) return
    el.style.display = "block"
    el.hidden = false
    el.textContent = t
  }

  function hideOk(el) {
    if (!el) return
    el.style.display = "none"
    el.hidden = true
    el.textContent = ""
  }

  function showSlotsErr(t) {
    if (!slotsMsg || !slotsOk) return
    slotsMsg.style.display = "block"
    slotsMsg.hidden = false
    slotsMsg.textContent = t
    slotsOk.style.display = "none"
    slotsOk.hidden = true
    slotsOk.textContent = ""
  }

  function showSlotsOk(t) {
    if (!slotsMsg || !slotsOk) return
    slotsOk.style.display = "block"
    slotsOk.hidden = false
    slotsOk.textContent = t
    slotsMsg.style.display = "none"
    slotsMsg.hidden = true
    slotsMsg.textContent = ""
  }

  function clearSlotsMsg() {
    if (!slotsMsg || !slotsOk) return
    slotsMsg.style.display = "none"
    slotsMsg.hidden = true
    slotsMsg.textContent = ""
    slotsOk.style.display = "none"
    slotsOk.hidden = true
    slotsOk.textContent = ""
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function fmtDate(ts) {
    try {
      const d = ts?.toDate ? ts.toDate() : new Date(ts)
      return d.toLocaleString("fr-BE", {
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return ""
    }
  }

  function statusBadge(status) {
    const s = (status || "pending").toLowerCase()
    if (s === "validated") return { txt: "Validé", cls: "validated" }
    if (s === "refused") return { txt: "Refusé", cls: "refused" }
    if (s === "cancelled") return { txt: "Annulé", cls: "cancelled" }
    return { txt: "En attente", cls: "pending" }
  }

  async function ensureAdmin(user) {
    const snap = await adminsCol.doc(user.uid).get()
    return snap.exists
  }

  function pad2(n) {
    return String(n).padStart(2, "0")
  }

  function freeSlotIdFromDate(d) {
    const yyyy = d.getFullYear()
    const mm = pad2(d.getMonth() + 1)
    const dd = pad2(d.getDate())
    const hh = pad2(d.getHours())
    const mi = pad2(d.getMinutes())
    return `${yyyy}${mm}${dd}_${hh}${mi}`
  }

  function addMinutes(d, min) {
    return new Date(d.getTime() + min * 60000)
  }

  function computeLateCancel(startTs) {
    try {
      const start = startTs?.toDate ? startTs.toDate() : null
      if (!start) return false
      const now = new Date()
      return start.getTime() - now.getTime() < 48 * 60 * 60 * 1000
    } catch {
      return false
    }
  }

  // ==========================================================
  // SYNC HEALTH (Outlook) — banner vert/orange/rouge
  // ==========================================================
  function hideSyncHealth() {
    if (!syncHealthBanner) return
    syncHealthBanner.style.display = "none"
    syncHealthBanner.hidden = true
    syncHealthBanner.textContent = ""
    syncHealthBanner.className = "warn"
  }

  function formatAge(ms) {
    const m = Math.floor(ms / 60000)
    if (m < 1) return "à l’instant"
    if (m < 60) return `il y a ${m} min`
    const h = Math.floor(m / 60)
    if (h < 24) return `il y a ${h} h`
    const d = Math.floor(h / 24)
    return `il y a ${d} j`
  }

  function showSyncHealth(kind, text) {
    if (!syncHealthBanner) return
    syncHealthBanner.className = kind === "ok" ? "ok" : kind === "warn" ? "warn" : "alert"
    syncHealthBanner.style.display = "block"
    syncHealthBanner.hidden = false
    syncHealthBanner.textContent = text
  }

  async function refreshSyncHealthOnce() {
    if (!isAdmin) return

    try {
      const snap = await syncHealthCol.doc("outlook").get()
      if (!snap.exists) {
        showSyncHealth("warn", "⚠️ Outlook sync : aucun état trouvé (syncHealth/outlook absent).")
        return
      }

      const d = snap.data() || {}
      const st = String(d.status || "unknown").toLowerCase()
      const updatedAt = d.updatedAt?.toDate ? d.updatedAt.toDate() : null

      const ageTxt = updatedAt ? formatAge(Date.now() - updatedAt.getTime()) : "date inconnue"
      const whenTxt = updatedAt ? updatedAt.toLocaleString("fr-BE") : "—"

      if (st === "ok") {
        showSyncHealth("ok", `✅ Outlook sync OK — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
        return
      }

      if (st === "aborted") {
        const reason = String(d.reason || "aborted")
        showSyncHealth("warn", `⚠️ Outlook sync ABORTÉ (${reason}) — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
        return
      }

      if (st === "failed") {
        const msg = String(d.message || "Erreur")
        showSyncHealth("alert", `❌ Outlook sync ÉCHEC — ${msg} — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
        return
      }

      showSyncHealth("warn", `⚠️ Outlook sync statut: ${st} — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
    } catch (e) {
      console.warn("refreshSyncHealthOnce error:", e)
      showSyncHealth("warn", "⚠️ Impossible de lire syncHealth/outlook (rules / réseau).")
    }
  }

  function bindSyncHealthRealtime() {
    if (!isAdmin) return
    if (_unsubSyncHealth) {
      try { _unsubSyncHealth() } catch {}
      _unsubSyncHealth = null
    }

    _unsubSyncHealth = syncHealthCol.doc("outlook").onSnapshot(
      (snap) => {
        if (!snap.exists) {
          showSyncHealth("warn", "⚠️ Outlook sync : aucun état trouvé (syncHealth/outlook absent).")
          return
        }

        const d = snap.data() || {}
        const st = String(d.status || "unknown").toLowerCase()
        const updatedAt = d.updatedAt?.toDate ? d.updatedAt.toDate() : null

        const ageTxt = updatedAt ? formatAge(Date.now() - updatedAt.getTime()) : "date inconnue"
        const whenTxt = updatedAt ? updatedAt.toLocaleString("fr-BE") : "—"

        if (st === "ok") {
          showSyncHealth("ok", `✅ Outlook sync OK — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
          return
        }

        if (st === "aborted") {
          const reason = String(d.reason || "aborted")
          showSyncHealth("warn", `⚠️ Outlook sync ABORTÉ (${reason}) — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
          return
        }

        if (st === "failed") {
          const msg = String(d.message || "Erreur")
          showSyncHealth("alert", `❌ Outlook sync ÉCHEC — ${msg} — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
          return
        }

        showSyncHealth("warn", `⚠️ Outlook sync statut: ${st} — Dernière mise à jour: ${whenTxt} (${ageTxt})`)
      },
      (err) => {
        console.warn("syncHealth onSnapshot error:", err)
        showSyncHealth("warn", "⚠️ Impossible de suivre syncHealth/outlook (rules / réseau).")
      }
    )
  }

  function unbindSyncHealthRealtime() {
    if (_unsubSyncHealth) {
      try { _unsubSyncHealth() } catch {}
      _unsubSyncHealth = null
    }
  }

  // ==========================================================
  // Verrouillage VALIDATED dans freeSlots (prioritaire)
  // ==========================================================
  async function markFreeSlotAsValidated(appt) {
    const start = appt.start?.toDate ? appt.start.toDate() : null
    const end = appt.end?.toDate ? appt.end.toDate() : null
    if (!start) return

    const freeId = freeSlotIdFromDate(start)
    const freeRef = freeSlotsCol.doc(freeId)

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(freeRef)

      const payload = {
        status: "blocked",
        blockedReason: BLOCK_REASON.VALIDATED,
        updatedAt: FieldValue.serverTimestamp(),
      }

      if (!snap.exists) {
        payload.start = firebase.firestore.Timestamp.fromDate(start)
        payload.end = firebase.firestore.Timestamp.fromDate(end || addMinutes(start, SLOT_MINUTES))
        payload.createdAt = FieldValue.serverTimestamp()
      }

      tx.set(freeRef, payload, { merge: true })
    })
  }

  async function releaseSlotForAppointment(appt) {
    const start = appt.start?.toDate ? appt.start.toDate() : null
    if (!start) return

    const freeId = freeSlotIdFromDate(start)
    const freeRef = freeSlotsCol.doc(freeId)

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(freeRef)
      if (!snap.exists) return

      const d = snap.data() || {}
      const reason = String(d.blockedReason || "").toLowerCase()
      const status = String(d.status || "").toLowerCase()

      if (status === "blocked" && (reason === BLOCK_REASON.OUTLOOK || reason === BLOCK_REASON.VALIDATED)) return

      tx.set(
        freeRef,
        {
          status: "free",
          blockedReason: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
    })

    const lockSnap = await slotsCol.where("appointmentId", "==", appt.id).limit(25).get()
    const batch = db.batch()
    lockSnap.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }

  async function setStatusWithSideEffects(appt, newStatus, opts) {
    const { releaseOnChange, askNote } = opts || {}
    hideErr(apptMsg)
    hideOk(apptOk)

    if (!appt || !appt.id) {
      showErr(apptMsg, "Rendez-vous introuvable.")
      return
    }

    let cancelNote = ""
    if (askNote) cancelNote = (window.prompt("Note (optionnel) :", "") || "").trim()

    const isLate = newStatus === "cancelled" ? computeLateCancel(appt.start) : false

    try {
      const payload = { status: newStatus, updatedAt: FieldValue.serverTimestamp() }

      if (newStatus === "cancelled") {
        payload.cancelledAt = firebase.firestore.Timestamp.now()
        payload.lateCancel = isLate
        if (cancelNote) payload.cancelNote = cancelNote
      }

      await appointmentsCol.doc(appt.id).set(payload, { merge: true })

      if (newStatus === "validated") await markFreeSlotAsValidated(appt)
      if (releaseOnChange) await releaseSlotForAppointment(appt)

      if (newStatus === "validated") showOk(apptOk, "Rendez-vous validé ✅ (slot verrouillé: validated)")
      else if (newStatus === "refused") showOk(apptOk, "Rendez-vous refusé ✅ — créneau libéré (si pas Outlook/validated)")
      else {
        showOk(
          apptOk,
          isLate
            ? "Rendez-vous annulé ✅ (annulation tardive <48h) — créneau libéré (si pas Outlook/validated)"
            : "Rendez-vous annulé ✅ — créneau libéré (si pas Outlook/validated)"
        )
      }

      await refreshAppointments()
      await refreshPlanningWeek()
      await refreshSyncHealthOnce()
    } catch (e) {
      console.error(e)
      showErr(apptMsg, "Impossible d’appliquer l’action (droits, réseau, ou rules).")
    }
  }

  async function loadAppointments(filterStatus) {
    const snap = await appointmentsCol.limit(250).get()
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

    items.sort((a, b) => {
      const ta = a.start?.toDate ? a.start.toDate().getTime() : 0
      const tb = b.start?.toDate ? b.start.toDate().getTime() : 0
      return ta - tb
    })

    if (filterStatus && filterStatus !== "all") return items.filter((x) => (x.status || "pending") === filterStatus)
    return items
  }

  async function refreshAppointments() {
    if (!isAdmin) return

    hideErr(apptMsg)
    hideOk(apptOk)

    const filterStatus = document.getElementById("statusFilter")?.value || "pending"
    const search = (document.getElementById("search")?.value || "").trim().toLowerCase()

    apptList.innerHTML = `<div class="muted">Chargement…</div>`
    if (apptEmpty) apptEmpty.hidden = true

    try {
      let items = await loadAppointments(filterStatus)

      if (search) {
        items = items.filter((a) => {
          const note = String(a.note || "").toLowerCase()
          const email = String(a.email || "").toLowerCase()
          return note.includes(search) || email.includes(search)
        })
      }

      if (!items.length) {
        apptList.innerHTML = ""
        if (apptEmpty) apptEmpty.hidden = false
        return
      }

      apptList.innerHTML = items.map((a) => {
        const st = statusBadge(a.status)
        const when = fmtDate(a.start)
        const uidTxt = escapeHtml(a.uid || "")
        const note = escapeHtml(a.note || "")

        const isCancelled = String(a.status || "").toLowerCase() === "cancelled"
        const late = a.lateCancel === true
        const cancelledAt = a.cancelledAt ? fmtDate(a.cancelledAt) : ""
        const cancelNote = escapeHtml(a.cancelNote || "")

        return `
          <div class="item" data-id="${a.id}">
            <div class="top">
              <div>
                <div style="font-weight:900">${when}</div>
                <div class="muted">${note ? note : "<span class='tiny'>(pas de note)</span>"}</div>
                <div class="tiny">uid: ${uidTxt}</div>

                ${
                  isCancelled
                    ? `
                  <div class="hr"></div>
                  <div class="tiny"><b>Annulation :</b> ${cancelledAt ? cancelledAt : "—"}</div>
                  ${late ? `<div class="tiny" style="color:#b45309;font-weight:900">⚠️ Annulation tardive &lt;48h</div>` : ``}
                  ${cancelNote ? `<div class="tiny"><b>Note :</b> ${cancelNote}</div>` : ``}
                `
                    : ``
                }
              </div>

              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px">
                <span class="badge ${st.cls}">${st.txt}</span>
                ${late ? `<span class="badge late">⚠️ &lt;48h</span>` : ``}
              </div>
            </div>

            <div class="row" style="margin-top:10px">
              <button class="btn good" data-action="validate" ${isCancelled ? "disabled" : ""}>Valider</button>
              <button class="btn bad" data-action="refuse" ${isCancelled ? "disabled" : ""}>Refuser</button>
              <button class="btn warn" data-action="cancel" ${isCancelled ? "disabled" : ""}>Annuler</button>
            </div>
          </div>
        `
      }).join("")

      const byId = new Map(items.map((x) => [x.id, x]))

      apptList.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          hideErr(apptMsg)
          hideOk(apptOk)

          const card = btn.closest("[data-id]")
          const id = card?.getAttribute("data-id")
          const action = btn.getAttribute("data-action")
          const appt = byId.get(id)

          if (action === "validate") {
            if (!window.confirm("Confirmer la VALIDATION ? Le créneau sera verrouillé (validated).")) return
            return setStatusWithSideEffects(appt, "validated", { releaseOnChange: false })
          }

          if (action === "refuse") {
            if (!window.confirm("Confirmer le REFUS ? Le créneau sera libéré (si pas Outlook/validated).")) return
            return setStatusWithSideEffects(appt, "refused", { releaseOnChange: true })
          }

          if (action === "cancel") {
            const isLate = computeLateCancel(appt?.start)
            const warning = isLate
              ? "⚠️ Annulation à moins de 48h. Confirmer ? Le créneau sera libéré (si pas Outlook/validated)."
              : "Confirmer l’annulation ? Le créneau sera libéré (si pas Outlook/validated)."
            if (!window.confirm(warning)) return

            return setStatusWithSideEffects(appt, "cancelled", { releaseOnChange: true, askNote: true })
          }
        })
      })
    } catch (e) {
      console.error(e)
      showErr(apptMsg, "Impossible de charger les rendez-vous.")
      apptList.innerHTML = ""
    }
  }

  async function loadModifs(filter) {
    if (!modifList) return []
    let q = modifsCol.limit(200)
    if (filter !== "all") q = modifsCol.where("status", "==", filter).limit(200)

    const snap = await q.get()
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))

    items.sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0
      return tb - ta
    })

    return items
  }

  async function refreshModifs() {
    if (!isAdmin || !modifList) return

    hideErr(modifMsg)
    hideOk(modifOk)

    const filter = document.getElementById("modifFilter")?.value || "new"

    modifList.innerHTML = `<div class="muted">Chargement…</div>`
    if (modifEmpty) modifEmpty.hidden = true

    try {
      const items = await loadModifs(filter)

      if (!items.length) {
        modifList.innerHTML = ""
        if (modifEmpty) modifEmpty.hidden = false
        return
      }

      modifList.innerHTML = items.map((m) => {
        const when = fmtDate(m.appointmentStart)
        const adr = escapeHtml(m.appointmentAddress || "")
        const msg = escapeHtml(m.message || "")
        const uidTxt = escapeHtml(m.uid || "")
        const apptId = escapeHtml(m.appointmentId || "")
        const status = escapeHtml(m.status || "new")

        return `
          <div class="item" data-id="${m.id}">
            <div class="top">
              <div>
                <div style="font-weight:900">RDV: ${when}</div>
                <div class="muted">${adr}</div>
                <div class="tiny">uid: ${uidTxt}</div>
                <div class="tiny">appointmentId: ${apptId}</div>
              </div>
              <span class="badge pending">${status}</span>
            </div>

            <div class="hr"></div>

            <div style="white-space:pre-wrap;font-size:13px">${msg}</div>

            <div class="row" style="margin-top:10px">
              <button class="btn primary" data-action="done">Marquer “traité”</button>
              <button class="btn" data-action="delete">Supprimer</button>
            </div>
          </div>
        `
      }).join("")

      modifList.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          hideErr(modifMsg)
          hideOk(modifOk)

          const card = btn.closest("[data-id]")
          const id = card?.getAttribute("data-id")
          const action = btn.getAttribute("data-action")

          try {
            if (action === "done") {
              await modifsCol.doc(id).update({
                status: "done",
                processedAt: FieldValue.serverTimestamp(),
              })
              showOk(modifOk, "Demande marquée comme traitée ✅")
              await refreshModifs()
              return
            }

            if (action === "delete") {
              await modifsCol.doc(id).delete()
              showOk(modifOk, "Demande supprimée ✅")
              await refreshModifs()
              return
            }
          } catch (e) {
            console.error(e)
            showErr(modifMsg, "Action impossible (droits ou réseau).")
          }
        })
      })
    } catch (e) {
      console.error(e)
      showErr(modifMsg, "Impossible de charger les demandes.")
      modifList.innerHTML = ""
    }
  }

  // ====== freeSlots generation (SAFE) ======
  function buildFreeSlots(weeks = WEEKS) {
    const res = []
    const now = new Date()
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)

    for (let i = 0; i < weeks * 7; i++) {
      const day = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i)
      const dow = day.getDay()
      if (dow === 0 || dow === 6) continue

      for (let mins = DAY_START_MIN; mins <= LAST_START_MIN; mins += SLOT_MINUTES) {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
        start.setMinutes(mins)
        const end = addMinutes(start, SLOT_MINUTES)
        const id = freeSlotIdFromDate(start)

        res.push({
          id,
          start: firebase.firestore.Timestamp.fromDate(start),
          end: firebase.firestore.Timestamp.fromDate(end),
          status: "free",
          blockedReason: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
    }

    return res
  }

  async function loadExistingFreeSlotsForRange(fromDate, toDate) {
    const fromTs = firebase.firestore.Timestamp.fromDate(fromDate)
    const toTs = firebase.firestore.Timestamp.fromDate(toDate)

    const snap = await freeSlotsCol.where("start", ">=", fromTs).where("start", "<", toTs).get()
    const map = new Map()
    snap.forEach((d) => map.set(d.id, d.data() || {}))
    return map
  }

  async function commitBatchesSafe(docs, existingMap) {
    const safe = docs.filter((s) => {
      const ex = existingMap.get(s.id)
      if (!ex) return true

      const status = String(ex.status || "").toLowerCase()
      const reason = String(ex.blockedReason || "").toLowerCase()

      if (status === "blocked" && (reason === BLOCK_REASON.OUTLOOK || reason === BLOCK_REASON.VALIDATED)) return false
      if (status === "blocked") return false
      return true
    })

    const MAX = 450
    for (let i = 0; i < safe.length; i += MAX) {
      const batch = db.batch()
      const chunk = safe.slice(i, i + MAX)

      chunk.forEach((s) => {
        batch.set(
          freeSlotsCol.doc(s.id),
          {
            start: s.start,
            end: s.end,
            status: s.status,
            blockedReason: s.blockedReason ?? null,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          },
          { merge: true }
        )
      })

      await batch.commit()
    }

    return { written: safe.length, skipped: docs.length - safe.length }
  }

  async function generateFreeSlots(weeks = WEEKS, preview = false) {
    clearSlotsMsg()

    if (!isAdmin) {
      showSlotsErr("Connecte-toi en admin d’abord.")
      return
    }

    const docs = buildFreeSlots(weeks)

    if (preview) {
      console.log("freeSlots preview:", docs.length, docs.slice(0, 10))
      showSlotsOk(`Prévisualisation ✅ ${docs.length} créneaux (voir console).`)
      return
    }

    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2)
    const to = addMinutes(from, weeks * 7 * 24 * 60)

    let existing = new Map()
    try {
      existing = await loadExistingFreeSlotsForRange(from, to)
    } catch (e) {
      console.warn("Impossible de précharger les freeSlots existants (index start?)", e)
      showSlotsErr("Index Firestore manquant sur freeSlots.start (range).")
      return
    }

    const { written, skipped } = await commitBatchesSafe(docs, existing)
    showSlotsOk(`Génération OK ✅ ${written} écrits / ${skipped} ignorés (déjà bloqués outlook/validated).`)
    await refreshPlanningWeek()
    await refreshSyncHealthOnce()
  }

  if (btnGenPreview) btnGenPreview.addEventListener("click", () => generateFreeSlots(WEEKS, true))
  if (btnGenFreeSlots) {
    btnGenFreeSlots.addEventListener("click", async () => {
      if (!confirm(`Générer les freeSlots sur ${WEEKS} semaines (90 min) ?\n⚠️ Ne remplacera pas les slots bloqués (outlook/validated).`)) return
      try {
        await generateFreeSlots(WEEKS, false)
      } catch (e) {
        console.error(e)
        showSlotsErr("Erreur pendant la génération (droits/réseau).")
      }
    })
  }

  // ====== PLANNING SEMAINE ======
  function mondayOfWeek(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const day = x.getDay()
    const diff = day === 0 ? -6 : 1 - day
    x.setDate(x.getDate() + diff)
    x.setHours(0, 0, 0, 0)
    return x
  }

  function minutesToLabel(mins) {
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${pad2(h)}:${pad2(m)}`
  }

  function slotClassFromDoc(d) {
    const status = String(d.status || "free").toLowerCase()
    const reason = String(d.blockedReason || "").toLowerCase()
    const conflict = d.conflict === true

    if (conflict) return "conflict"
    if (status === "blocked") {
      if (reason === BLOCK_REASON.VALIDATED) return "validated"
      return "blocked"
    }
    if (status === "pending") return "pending"
    if (status === "validated") return "validated"
    return "free"
  }

  async function refreshPlanningWeek() {
    if (!planningGrid) return
    if (!isAdmin) {
      planningGrid.innerHTML = `<div class="muted">Connecte-toi pour voir le planning.</div>`
      return
    }

    const now = new Date()
    const mon = mondayOfWeek(now)
    const fri = new Date(mon)
    fri.setDate(mon.getDate() + 5)
    const fromTs = firebase.firestore.Timestamp.fromDate(mon)
    const toTs = firebase.firestore.Timestamp.fromDate(fri)

    planningGrid.innerHTML = `<div class="muted">Chargement planning…</div>`

    let map = new Map()
    try {
      const snap = await freeSlotsCol.where("start", ">=", fromTs).where("start", "<", toTs).get()
      snap.forEach((doc) => map.set(doc.id, doc.data() || {}))
    } catch (e) {
      console.warn("Planning: query freeSlots (index start?)", e)
      planningGrid.innerHTML = `<div class="muted">Index Firestore manquant pour afficher le planning.</div>`
      return
    }

    const days = ["Lun", "Mar", "Mer", "Jeu", "Ven"]
    const cols = []
    for (let d = 0; d < 5; d++) {
      const day = new Date(mon)
      day.setDate(mon.getDate() + d)
      cols.push(day)
    }

    const timeSlots = []
    for (let mins = DAY_START_MIN; mins <= LAST_START_MIN; mins += SLOT_MINUTES) timeSlots.push(mins)

    let html = ""

    html += `<div class="timeCell"></div>`
    cols.forEach((day, i) => {
      const dd = pad2(day.getDate())
      const mm = pad2(day.getMonth() + 1)
      html += `<div class="slot slotHead" style="justify-content:center">${days[i]} ${dd}/${mm}</div>`
    })

    timeSlots.forEach((mins) => {
      html += `<div class="timeCell">${minutesToLabel(mins)}</div>`

      cols.forEach((day) => {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0)
        start.setMinutes(mins)
        const id = freeSlotIdFromDate(start)

        const d = map.get(id)
        if (!d) {
          html += `<div class="slot slotEmpty free" style="opacity:.55">—</div>`
          return
        }

        const cls = slotClassFromDoc(d)

        let label = "Libre"
        const status = String(d.status || "free").toLowerCase()
        const reason = String(d.blockedReason || "").toLowerCase()
        const conflict = d.conflict === true

        if (conflict) label = "⚠ Conflit"
        else if (status === "blocked" && reason === BLOCK_REASON.VALIDATED) label = "Validé"
        else if (status === "blocked" && reason === BLOCK_REASON.OUTLOOK) label = "Occupé (Outlook)"
        else if (status === "blocked") label = "Bloqué"
        else if (status === "pending") label = "En attente"

        html += `<div class="slot ${cls}">${label}</div>`
      })
    })

    planningGrid.innerHTML = html
  }

  // ========= UI EVENTS =========
  document.getElementById("btnRefresh")?.addEventListener("click", async () => {
    await refreshAppointments()
    await refreshModifs()
    await refreshPlanningWeek()
    await refreshSyncHealthOnce()
  })

  document.getElementById("statusFilter")?.addEventListener("change", refreshAppointments)

  let _debounce = null
  document.getElementById("search")?.addEventListener("input", () => {
    clearTimeout(_debounce)
    _debounce = setTimeout(refreshAppointments, 250)
  })

  document.getElementById("btnRefreshModifs")?.addEventListener("click", refreshModifs)
  document.getElementById("modifFilter")?.addEventListener("change", refreshModifs)

  // ========= LOGIN MODAL =========
  function openLogin() {
    loginErr.hidden = true
    loginErr.style.display = "none"
    loginErr.textContent = ""
    overlay.style.display = "flex"
    document.getElementById("loginEmail")?.focus()
  }

  function closeLogin() {
    overlay.style.display = "none"
  }

  btnLogin.addEventListener("click", openLogin)
  document.getElementById("closeLogin")?.addEventListener("click", closeLogin)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLogin()
  })

  ;["loginEmail", "loginPass"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("doLogin")?.click()
    })
  })

  document.getElementById("doLogin")?.addEventListener("click", async () => {
    loginErr.hidden = true
    loginErr.style.display = "none"
    loginErr.textContent = ""

    const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase()
    const pass = (document.getElementById("loginPass")?.value || "").trim()

    if (!email || !pass) {
      loginErr.hidden = false
      loginErr.style.display = "block"
      loginErr.textContent = "Veuillez saisir l’e-mail et le mot de passe."
      return
    }

    try {
      await auth.signInWithEmailAndPassword(email, pass)
      closeLogin()
    } catch (e) {
      console.error(e)
      loginErr.hidden = false
      loginErr.style.display = "block"
      loginErr.textContent = "Connexion impossible. Vérifiez vos identifiants."
    }
  })

  btnLogout.addEventListener("click", async () => {
    await auth.signOut()
  })

  // ========= PROTECTION =========
  auth.onAuthStateChanged(async (user) => {
    hideErr(apptMsg)
    hideOk(apptOk)
    hideErr(modifMsg)
    hideOk(modifOk)
    clearSlotsMsg()

    isAdmin = false
    unbindSyncHealthRealtime()
    hideSyncHealth()

    if (!user) {
      setStatus(false)
      apptList.innerHTML = `<div class="muted">Veuillez vous connecter.</div>`
      if (modifList) modifList.innerHTML = `<div class="muted">Veuillez vous connecter.</div>`
      await refreshPlanningWeek()
      return
    }

    let ok = false
    try {
      ok = await ensureAdmin(user)
    } catch (e) {
      console.error(e)
    }

    if (!ok) {
      setStatus(false)
      apptList.innerHTML = `<div class="muted"><b>Accès refusé</b> : ce compte n’est pas administrateur.<br/>Retour à l’accueil…</div>`
      if (modifList) modifList.innerHTML = `<div class="muted"><b>Accès refusé</b> : ce compte n’est pas administrateur.<br/>Retour à l’accueil…</div>`
      setTimeout(() => { window.location.href = "/" }, 2000)
      return
    }

    isAdmin = true
    setStatus(true)

    await refreshSyncHealthOnce()
    bindSyncHealthRealtime()

    await refreshAppointments()
    await refreshModifs()
    await refreshPlanningWeek()
  })
})