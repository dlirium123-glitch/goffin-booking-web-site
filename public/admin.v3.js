/* ===============================
   Admin — Goffin Booking (v3)
   Signature version + anti-cache
   =============================== */
/* eslint-disable no-console */
const ADMIN_VERSION = "admin-2026-02-07-3";
console.log("admin.v3.js chargé ✅", ADMIN_VERSION);

document.addEventListener("DOMContentLoaded", async () => {
  // UI version (dans admin.html : <span id="adminVersion">—</span>)
  const vEl = document.getElementById("adminVersion");
  if (vEl) vEl.textContent = ADMIN_VERSION;

  // Attendre que Firebase soit prêt (init.js + compat libs)
  async function waitForFirebase(maxMs = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (window.firebase && firebase.auth && firebase.firestore) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  const okFirebase = await waitForFirebase(10000);
  if (!okFirebase) {
    console.error("Firebase non chargé (/__/firebase/init.js ?) : admin.v3.js stop");
    return;
  }

  const auth = firebase.auth();
  const db = firebase.firestore();
  const FieldValue = firebase.firestore.FieldValue;

  try {
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch {
    // ignore
  }

  // Collections
  const appointmentsCol = db.collection("appointments");
  const modifsCol = db.collection("modificationRequests");
  const adminsCol = db.collection("admins");
  const slotsCol = db.collection("slots"); // locks privés
  const freeSlotsCol = db.collection("freeSlots"); // planning public

  // DOM
  const pill = document.getElementById("pillStatus");
  const statusText = document.getElementById("statusText");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  const apptList = document.getElementById("apptList");
  const apptEmpty = document.getElementById("apptEmpty");
  const apptMsg = document.getElementById("apptMsg");
  const apptOk = document.getElementById("apptOk");

  const modifList = document.getElementById("modifList");
  const modifEmpty = document.getElementById("modifEmpty");
  const modifMsg = document.getElementById("modifMsg");
  const modifOk = document.getElementById("modifOk");

  const overlay = document.getElementById("overlay");
  const loginErr = document.getElementById("loginErr");

  const btnGenFreeSlots = document.getElementById("btnGenFreeSlots");
  const btnGenPreview = document.getElementById("btnGenPreview");
  const slotsMsg = document.getElementById("slotsMsg");
  const slotsOk = document.getElementById("slotsOk");

  // Hard-stop si DOM essentiel manquant
  const required = [
    pill,
    statusText,
    btnLogin,
    btnLogout,
    apptList,
    apptEmpty,
    apptMsg,
    apptOk,
    modifList,
    modifEmpty,
    modifMsg,
    modifOk,
    overlay,
    loginErr,
    btnGenFreeSlots,
    btnGenPreview,
    slotsMsg,
    slotsOk,
  ];
  if (required.some((x) => !x)) {
    console.error("DOM manquant dans admin.html (un ou plusieurs IDs requis introuvables).");
    return;
  }

  let isAdmin = false;

  // ====== CONFIG (cohérente index) ======
  const SLOT_MINUTES = 90;
  const DAY_START_MIN = 9 * 60 + 30; // 09:30
  const DAY_END_MIN = 17 * 60 + 30; // 17:30
  const LAST_START_MIN = DAY_END_MIN - SLOT_MINUTES; // 16:00
  const WEEKS = 8;

  const BLOCK_REASON = {
    OUTLOOK: "outlook",
    VALIDATED: "validated",
  };

  // ====== UI helpers ======
  function setStatus(isAdminLogged) {
    if (isAdminLogged) {
      pill.classList.add("ok");
      statusText.textContent = "Connecté (admin)";
      btnLogout.style.display = "";
      btnLogin.style.display = "none";
    } else {
      pill.classList.remove("ok");
      statusText.textContent = "Non connecté";
      btnLogout.style.display = "none";
      btnLogin.style.display = "";
    }
  }

  function showErr(el, t) {
    el.style.display = "block";
    el.textContent = t;
  }
  function hideErr(el) {
    el.style.display = "none";
    el.textContent = "";
  }
  function showOk(el, t) {
    el.style.display = "block";
    el.textContent = t;
  }
  function hideOk(el) {
    el.style.display = "none";
    el.textContent = "";
  }

  function showSlotsErr(t) {
    slotsMsg.style.display = "block";
    slotsMsg.textContent = t;
    slotsOk.style.display = "none";
    slotsOk.textContent = "";
  }
  function showSlotsOk(t) {
    slotsOk.style.display = "block";
    slotsOk.textContent = t;
    slotsMsg.style.display = "none";
    slotsMsg.textContent = "";
  }
  function clearSlotsMsg() {
    slotsMsg.style.display = "none";
    slotsMsg.textContent = "";
    slotsOk.style.display = "none";
    slotsOk.textContent = "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fmtDate(ts) {
    try {
      const d = ts?.toDate ? ts.toDate() : new Date(ts);
      return d.toLocaleString("fr-BE", {
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function statusBadge(status) {
    const s = (status || "pending").toLowerCase();
    if (s === "validated") return { txt: "Validé", cls: "validated" };
    if (s === "refused") return { txt: "Refusé", cls: "refused" };
    if (s === "cancelled") return { txt: "Annulé", cls: "cancelled" };
    return { txt: "En attente", cls: "pending" };
  }

  async function ensureAdmin(user) {
    const snap = await adminsCol.doc(user.uid).get();
    return snap.exists;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  // ID doc freeSlots = YYYYMMDD_HHMM
  function freeSlotIdFromDate(d) {
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    return `${yyyy}${mm}${dd}_${hh}${mi}`;
  }

  function addMinutes(d, min) {
    return new Date(d.getTime() + min * 60000);
  }

  function computeLateCancel(startTs) {
    try {
      const start = startTs?.toDate ? startTs.toDate() : null;
      if (!start) return false;
      const now = new Date();
      return start.getTime() - now.getTime() < 48 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  // ==========================================================
  // ✅ NEW: verrouillage "VALIDATED" dans freeSlots (immuable)
  // ==========================================================
  async function markFreeSlotAsValidated(appt) {
    const start = appt.start?.toDate ? appt.start.toDate() : null;
    const end = appt.end?.toDate ? appt.end.toDate() : null;
    if (!start) return;

    const freeId = freeSlotIdFromDate(start);
    const freeRef = freeSlotsCol.doc(freeId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(freeRef);

      const payload = {
        status: "blocked",
        blockedReason: BLOCK_REASON.VALIDATED,
        updatedAt: FieldValue.serverTimestamp(),
      };

      // On ne perd jamais start/end
      if (!snap.exists) {
        payload.start = firebase.firestore.Timestamp.fromDate(start);
        payload.end = firebase.firestore.Timestamp.fromDate(end || addMinutes(start, SLOT_MINUTES));
        payload.createdAt = FieldValue.serverTimestamp();
      }

      // ✅ si Outlook avait déjà bloqué, on force validated (prioritaire)
      tx.set(freeRef, payload, { merge: true });
    });
  }

  // ==========================================================
  // ✅ PROTECTION release: ne pas libérer si Outlook/Validated
  // ==========================================================
  async function releaseSlotForAppointment(appt) {
    const start = appt.start?.toDate ? appt.start.toDate() : null;
    if (!start) return;

    const freeId = freeSlotIdFromDate(start);
    const freeRef = freeSlotsCol.doc(freeId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(freeRef);
      if (!snap.exists) return;

      const d = snap.data() || {};
      const reason = String(d.blockedReason || "").toLowerCase();
      const status = String(d.status || "").toLowerCase();

      // ✅ jamais libérer si outlook / validated
      if (
        status === "blocked" &&
        (reason === BLOCK_REASON.OUTLOOK || reason === BLOCK_REASON.VALIDATED)
      )
        return;

      tx.set(
        freeRef,
        {
          status: "free",
          blockedReason: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    // Supprime locks slots liés à cet appointmentId
    const lockSnap = await slotsCol.where("appointmentId", "==", appt.id).limit(25).get();

    const batch = db.batch();
    lockSnap.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  // ====== ACTIONS appointment ======
  async function setStatusWithSideEffects(appt, newStatus, opts) {
    const { releaseOnChange, askNote } = opts || {};
    hideErr(apptMsg);
    hideOk(apptOk);

    if (!appt || !appt.id) {
      showErr(apptMsg, "Rendez-vous introuvable.");
      return;
    }

    let cancelNote = "";
    if (askNote) {
      cancelNote = (window.prompt("Note (optionnel) :", "") || "").trim();
    }

    const isLate = newStatus === "cancelled" ? computeLateCancel(appt.start) : false;

    try {
      // 1) update appointment
      const payload = {
        status: newStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (newStatus === "cancelled") {
        payload.cancelledAt = firebase.firestore.Timestamp.now();
        payload.lateCancel = isLate;
        if (cancelNote) payload.cancelNote = cancelNote;
      }

      await appointmentsCol.doc(appt.id).set(payload, { merge: true });

      // 2) side-effects slots/freeSlots
      if (newStatus === "validated") {
        await markFreeSlotAsValidated(appt);
      }

      if (releaseOnChange) {
        await releaseSlotForAppointment(appt);
      }

      // 3) UI message
      if (newStatus === "validated") {
        showOk(apptOk, "Rendez-vous validé ✅ (slot verrouillé: validated)");
      } else if (newStatus === "refused") {
        showOk(apptOk, "Rendez-vous refusé ✅ — créneau libéré (si pas Outlook/validated)");
      } else {
        showOk(
          apptOk,
          isLate
            ? "Rendez-vous annulé ✅ (annulation tardive <48h) — créneau libéré (si pas Outlook/validated)"
            : "Rendez-vous annulé ✅ — créneau libéré (si pas Outlook/validated)"
        );
      }

      await refreshAppointments();
    } catch (e) {
      console.error(e);
      showErr(apptMsg, "Impossible d’appliquer l’action (droits, réseau, ou rules).");
    }
  }

  // ====== DATA (appointments) ======
  async function loadAppointments(filterStatus) {
    const snap = await appointmentsCol.limit(250).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    items.sort((a, b) => {
      const ta = a.start?.toDate ? a.start.toDate().getTime() : 0;
      const tb = b.start?.toDate ? b.start.toDate().getTime() : 0;
      return ta - tb;
    });

    if (filterStatus && filterStatus !== "all") {
      return items.filter((x) => (x.status || "pending") === filterStatus);
    }
    return items;
  }

  async function refreshAppointments() {
    if (!isAdmin) return;

    hideErr(apptMsg);
    hideOk(apptOk);

    const filterStatus = document.getElementById("statusFilter")?.value || "pending";
    const search = (document.getElementById("search")?.value || "").trim().toLowerCase();

    apptList.innerHTML = `<div class="muted">Chargement…</div>`;
    apptEmpty.style.display = "none";

    try {
      let items = await loadAppointments(filterStatus);

      if (search) {
        items = items.filter((a) => {
          const note = String(a.note || "").toLowerCase();
          const email = String(a.email || "").toLowerCase();
          return note.includes(search) || email.includes(search);
        });
      }

      if (!items.length) {
        apptList.innerHTML = "";
        apptEmpty.style.display = "block";
        return;
      }

      apptList.innerHTML = items
        .map((a) => {
          const st = statusBadge(a.status);
          const when = fmtDate(a.start);
          const uid = escapeHtml(a.uid || "");
          const note = escapeHtml(a.note || "");

          const isCancelled = String(a.status || "").toLowerCase() === "cancelled";
          const late = a.lateCancel === true;
          const cancelledAt = a.cancelledAt ? fmtDate(a.cancelledAt) : "";
          const cancelNote = escapeHtml(a.cancelNote || "");

          return `
          <div class="item" data-id="${a.id}">
            <div class="top">
              <div>
                <div style="font-weight:900">${when}</div>
                <div class="muted">${note ? note : "<span class='tiny'>(pas de note)</span>"}</div>
                <div class="tiny">uid: ${uid}</div>

                ${
                  isCancelled
                    ? `
                  <div class="hr"></div>
                  <div class="tiny"><b>Annulation :</b> ${cancelledAt ? cancelledAt : "—"}</div>
                  ${
                    late
                      ? `<div class="tiny" style="color:#b45309;font-weight:900">⚠️ Annulation tardive &lt;48h</div>`
                      : ``
                  }
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
        `;
        })
        .join("");

      const byId = new Map(items.map((x) => [x.id, x]));

      apptList.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          hideErr(apptMsg);
          hideOk(apptOk);

          const card = btn.closest("[data-id]");
          const id = card?.getAttribute("data-id");
          const action = btn.getAttribute("data-action");
          const appt = byId.get(id);

          if (action === "validate") {
            if (!window.confirm("Confirmer la VALIDATION ? Le créneau sera verrouillé (validated).")) return;
            return setStatusWithSideEffects(appt, "validated", { releaseOnChange: false });
          }

          if (action === "refuse") {
            if (!window.confirm("Confirmer le REFUS ? Le créneau sera libéré (si pas Outlook/validated).")) return;
            return setStatusWithSideEffects(appt, "refused", { releaseOnChange: true });
          }

          if (action === "cancel") {
            const isLate = computeLateCancel(appt?.start);
            const warning = isLate
              ? "⚠️ Annulation à moins de 48h. Confirmer ? Le créneau sera libéré (si pas Outlook/validated)."
              : "Confirmer l’annulation ? Le créneau sera libéré (si pas Outlook/validated).";
            if (!window.confirm(warning)) return;

            return setStatusWithSideEffects(appt, "cancelled", {
              releaseOnChange: true,
              askNote: true,
            });
          }
        });
      });
    } catch (e) {
      console.error(e);
      showErr(apptMsg, "Impossible de charger les rendez-vous.");
      apptList.innerHTML = "";
    }
  }

  // ====== DATA (modifs) ======
  async function loadModifs(filter) {
    let q = modifsCol.limit(200);
    if (filter !== "all") q = modifsCol.where("status", "==", filter).limit(200);

    const snap = await q.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    items.sort((a, b) => {
      const ta = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      const tb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
      return tb - ta;
    });

    return items;
  }

  async function refreshModifs() {
    if (!isAdmin) return;

    hideErr(modifMsg);
    hideOk(modifOk);

    const filter = document.getElementById("modifFilter")?.value || "new";

    modifList.innerHTML = `<div class="muted">Chargement…</div>`;
    modifEmpty.style.display = "none";

    try {
      const items = await loadModifs(filter);

      if (!items.length) {
        modifList.innerHTML = "";
        modifEmpty.style.display = "block";
        return;
      }

      modifList.innerHTML = items
        .map((m) => {
          const when = fmtDate(m.appointmentStart);
          const adr = escapeHtml(m.appointmentAddress || "");
          const msg = escapeHtml(m.message || "");
          const uid = escapeHtml(m.uid || "");
          const apptId = escapeHtml(m.appointmentId || "");
          const status = escapeHtml(m.status || "new");

          return `
          <div class="item" data-id="${m.id}">
            <div class="top">
              <div>
                <div style="font-weight:900">RDV: ${when}</div>
                <div class="muted">${adr}</div>
                <div class="tiny">uid: ${uid}</div>
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
        `;
        })
        .join("");

      modifList.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          hideErr(modifMsg);
          hideOk(modifOk);

          const card = btn.closest("[data-id]");
          const id = card?.getAttribute("data-id");
          const action = btn.getAttribute("data-action");

          try {
            if (action === "done") {
              await modifsCol.doc(id).update({
                status: "done",
                processedAt: FieldValue.serverTimestamp(),
              });
              showOk(modifOk, "Demande marquée comme traitée ✅");
              await refreshModifs();
              return;
            }

            if (action === "delete") {
              await modifsCol.doc(id).delete();
              showOk(modifOk, "Demande supprimée ✅");
              await refreshModifs();
              return;
            }
          } catch (e) {
            console.error(e);
            showErr(modifMsg, "Action impossible (droits ou réseau).");
          }
        });
      });
    } catch (e) {
      console.error(e);
      showErr(modifMsg, "Impossible de charger les demandes.");
      modifList.innerHTML = "";
    }
  }

  // ====== freeSlots generation (SAFE) ======
  function buildFreeSlots(weeks = WEEKS) {
    const res = [];
    const now = new Date();
    const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2); // J+2

    for (let i = 0; i < weeks * 7; i++) {
      const day = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + i);
      const dow = day.getDay(); // 0=dim,6=sam
      if (dow === 0 || dow === 6) continue;

      for (let mins = DAY_START_MIN; mins <= LAST_START_MIN; mins += SLOT_MINUTES) {
        const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
        start.setMinutes(mins);
        const end = addMinutes(start, SLOT_MINUTES);

        const id = freeSlotIdFromDate(start);

        res.push({
          id,
          start: firebase.firestore.Timestamp.fromDate(start),
          end: firebase.firestore.Timestamp.fromDate(end),
          status: "free",
          blockedReason: null,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    return res;
  }

  async function loadExistingFreeSlotsForRange(fromDate, toDate) {
    // on s’appuie sur le champ "start" timestamp
    const fromTs = firebase.firestore.Timestamp.fromDate(fromDate);
    const toTs = firebase.firestore.Timestamp.fromDate(toDate);

    const snap = await freeSlotsCol.where("start", ">=", fromTs).where("start", "<", toTs).get();

    const map = new Map();
    snap.forEach((d) => map.set(d.id, d.data() || {}));
    return map;
  }

  async function commitBatchesSafe(docs, existingMap) {
    // ✅ Ne jamais écraser outlook/validated
    const safe = docs.filter((s) => {
      const ex = existingMap.get(s.id);
      if (!ex) return true; // n’existe pas → OK
      const status = String(ex.status || "").toLowerCase();
      const reason = String(ex.blockedReason || "").toLowerCase();
      if (status === "blocked" && (reason === BLOCK_REASON.OUTLOOK || reason === BLOCK_REASON.VALIDATED)) {
        return false;
      }
      // si c'est déjà "blocked" autre raison, on évite aussi
      if (status === "blocked") return false;
      // si c'est free → OK
      return true;
    });

    const MAX = 450;
    for (let i = 0; i < safe.length; i += MAX) {
      const batch = db.batch();
      const chunk = safe.slice(i, i + MAX);

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
        );
      });

      await batch.commit();
    }

    return { written: safe.length, skipped: docs.length - safe.length };
  }

  async function generateFreeSlots(weeks = WEEKS, preview = false) {
    clearSlotsMsg();

    if (!isAdmin) {
      showSlotsErr("Connecte-toi en admin d’abord.");
      return;
    }

    const docs = buildFreeSlots(weeks);

    if (preview) {
      console.log("freeSlots preview:", docs.length, docs.slice(0, 10));
      showSlotsOk(`Prévisualisation ✅ ${docs.length} créneaux (voir console).`);
      return;
    }

    // 🔒 SAFE: charge existants sur la plage, skip outlook/validated
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const to = addMinutes(from, weeks * 7 * 24 * 60);

    let existing = new Map();
    try {
      existing = await loadExistingFreeSlotsForRange(from, to);
    } catch (e) {
      console.warn(
        "Impossible de précharger les freeSlots existants (index start?) — fallback: écriture simple désactivée.",
        e
      );
      showSlotsErr(
        "Index Firestore manquant sur freeSlots.start (range). Dis-moi si tu veux que je te donne le lien exact pour le créer."
      );
      return;
    }

    const { written, skipped } = await commitBatchesSafe(docs, existing);
    showSlotsOk(`Génération OK ✅ ${written} écrits / ${skipped} ignorés (déjà bloqués outlook/validated).`);
  }

  btnGenPreview.addEventListener("click", () => generateFreeSlots(WEEKS, true));
  btnGenFreeSlots.addEventListener("click", async () => {
    if (
      !confirm(
        `Générer les freeSlots sur ${WEEKS} semaines (90 min) ?\n⚠️ Ne remplacera pas les slots bloqués (outlook/validated).`
      )
    )
      return;
    try {
      await generateFreeSlots(WEEKS, false);
    } catch (e) {
      console.error(e);
      showSlotsErr("Erreur pendant la génération (droits/réseau).");
    }
  });

  // ========= UI EVENTS =========
  document.getElementById("btnRefresh")?.addEventListener("click", refreshAppointments);
  document.getElementById("btnRefreshModifs")?.addEventListener("click", refreshModifs);
  document.getElementById("statusFilter")?.addEventListener("change", refreshAppointments);
  document.getElementById("modifFilter")?.addEventListener("change", refreshModifs);

  let _debounce = null;
  document.getElementById("search")?.addEventListener("input", () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(refreshAppointments, 250);
  });

  // ========= LOGIN MODAL =========
  function openLogin() {
    loginErr.style.display = "none";
    loginErr.textContent = "";
    overlay.style.display = "flex";
    document.getElementById("loginEmail")?.focus();
  }
  function closeLogin() {
    overlay.style.display = "none";
  }

  btnLogin.addEventListener("click", openLogin);
  document.getElementById("closeLogin")?.addEventListener("click", closeLogin);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeLogin();
  });

  ["loginEmail", "loginPass"].forEach((id) => {
    document.getElementById(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("doLogin")?.click();
    });
  });

  document.getElementById("doLogin")?.addEventListener("click", async () => {
    loginErr.style.display = "none";
    loginErr.textContent = "";

    const email = (document.getElementById("loginEmail")?.value || "").trim().toLowerCase();
    const pass = (document.getElementById("loginPass")?.value || "").trim();

    if (!email || !pass) {
      loginErr.style.display = "block";
      loginErr.textContent = "Veuillez saisir l’e-mail et le mot de passe.";
      return;
    }

    try {
      await auth.signInWithEmailAndPassword(email, pass);
      closeLogin();
    } catch (e) {
      console.error(e);
      loginErr.style.display = "block";
      loginErr.textContent = "Connexion impossible. Vérifiez vos identifiants.";
    }
  });

  btnLogout.addEventListener("click", async () => {
    await auth.signOut();
  });

  // ========= PROTECTION =========
  auth.onAuthStateChanged(async (user) => {
    hideErr(apptMsg);
    hideOk(apptOk);
    hideErr(modifMsg);
    hideOk(modifOk);
    clearSlotsMsg();

    isAdmin = false;

    if (!user) {
      setStatus(false);
      apptList.innerHTML = `<div class="muted">Veuillez vous connecter.</div>`;
      modifList.innerHTML = `<div class="muted">Veuillez vous connecter.</div>`;
      return;
    }

    let ok = false;
    try {
      ok = await ensureAdmin(user);
    } catch (e) {
      console.error(e);
    }

    if (!ok) {
      setStatus(false);
      apptList.innerHTML = `<div class="muted"><b>Accès refusé</b> : ce compte n’est pas administrateur.<br/>Retour à l’accueil…</div>`;
      modifList.innerHTML = `<div class="muted"><b>Accès refusé</b> : ce compte n’est pas administrateur.<br/>Retour à l’accueil…</div>`;
      setTimeout(() => {
        window.location.href = "/";
      }, 2000);
      return;
    }

    isAdmin = true;
    setStatus(true);
    await refreshAppointments();
    await refreshModifs();
  });
});
