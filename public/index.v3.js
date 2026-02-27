/* public/index.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  // ------------------------------------------------------------
  // Version (affichage)
  // ------------------------------------------------------------
  const APP_VERSION = "v3-2026-02-27-PRO-clean";

  // ------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const pillStatus = $("pillStatus");
  const statusText = $("statusText");
  const btnLogout = $("btnLogout");
  const clientVersion = $("clientVersion");
  const rightPanel = $("rightPanel");

  if (clientVersion) clientVersion.textContent = APP_VERSION;

  function setStatus(kind, text) {
    // kind: "ok" | "warn" | "err" | "idle"
    if (!pillStatus || !statusText) return;
    pillStatus.classList.remove("ok", "warn", "err");
    if (kind === "ok") pillStatus.classList.add("ok");
    if (kind === "warn") pillStatus.classList.add("warn");
    if (kind === "err") pillStatus.classList.add("err");
    statusText.textContent = text;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render(html) {
    if (!rightPanel) return;
    rightPanel.innerHTML = html;
  }

  function nowMs() {
    return Date.now();
  }

  // ------------------------------------------------------------
  // Firebase (Compat) bootstrap
  // ------------------------------------------------------------
  function assertFirebaseLoaded() {
    if (!window.firebase) throw new Error("Firebase SDK non chargé (firebase global manquant).");
    if (!firebase.auth) throw new Error("firebase-auth-compat non chargé.");
    if (!firebase.firestore) throw new Error("firebase-firestore-compat non chargé.");
  }

  function getServices() {
    assertFirebaseLoaded();

    // Auto-init via /__/firebase/init.js (Firebase Hosting)
    // => firebase.apps[0] existe normalement.
    if (!firebase.apps || firebase.apps.length === 0) {
      throw new Error("Firebase app non initialisée. Vérifie /__/firebase/init.js dans index.html.");
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    // Debug-friendly
    db.settings({ ignoreUndefinedProperties: true });

    return { auth, db };
  }

  // ------------------------------------------------------------
  // Firestore refs (canon)
  // ------------------------------------------------------------
  function refs(db) {
    return {
      users: db.collection("users"),
      publicSlots: db.collection("publicSlots"),
      holds: db.collection("holds"),
      bookings: db.collection("bookings"),
      requests: db.collection("requests"),
    };
  }

  // ------------------------------------------------------------
  // Admin check = custom claim ONLY
  // ------------------------------------------------------------
  async function getAdminClaim(auth) {
    const u = auth.currentUser;
    if (!u) return false;
    // Force refresh si tu viens de mettre le claim
    const token = await u.getIdTokenResult(true);
    return token?.claims?.admin === true;
  }

  // ------------------------------------------------------------
  // User profile (users/{uid})
  // - Respecte tes rules: pas de "role", "admin", etc.
  // ------------------------------------------------------------
  function normalizeProfilePayload(payload) {
    return {
      email: String(payload.email || ""),
      company: String(payload.company || ""),
      vat: String(payload.vat || ""),
      phone: String(payload.phone || ""),
      hqAddress: String(payload.hqAddress || ""),
    };
  }

  async function ensureUserProfile(db, uid, payload) {
    const { users } = refs(db);
    const ref = users.doc(uid);

    const snap = await ref.get();
    if (snap.exists) return;

    const base = normalizeProfilePayload(payload);

    const safe = {
      ...base,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(safe, { merge: false });
  }

  async function updateUserProfile(db, uid, payload) {
    const { users } = refs(db);
    const ref = users.doc(uid);

    const base = normalizeProfilePayload(payload);

    const safe = {
      ...base,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(safe, { merge: true });
  }

  // ------------------------------------------------------------
  // Slots helpers
  // ------------------------------------------------------------
  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
  }

  function isWeekend(d) {
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  function computeWeekRange(anchorDate) {
    const d = startOfDay(anchorDate);
    // lundi comme début
    const day = d.getDay(); // 0=dim
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = addDays(d, diffToMonday);
    const sundayExclusive = addDays(monday, 7);
    return { start: monday, end: sundayExclusive };
  }

  // ------------------------------------------------------------
  // UI
  // ------------------------------------------------------------
  function uiAuth() {
    render(`
      <h2>Étape 1/3 — Connexion</h2>
      <p class="muted">Réservé aux professionnels (GN). Utilise ton e-mail + mot de passe.</p>

      <div class="grid2">
        <div class="cardInner">
          <h3>Se connecter</h3>
          <label>E-mail</label>
          <input id="loginEmail" type="email" placeholder="ex: pro@entreprise.be" />
          <label>Mot de passe</label>
          <input id="loginPass" type="password" placeholder="••••••••" />
          <button id="btnLogin" class="btn primary">Me connecter</button>
          <p id="loginErr" class="err"></p>
        </div>

        <div class="cardInner">
          <h3>Créer un compte</h3>
          <label>E-mail</label>
          <input id="regEmail" type="email" placeholder="ex: pro@entreprise.be" />
          <label>Mot de passe</label>
          <input id="regPass" type="password" placeholder="min 6 caractères" />

          <hr />

          <h4>Profil entreprise</h4>
          <label>Société</label>
          <input id="regCompany" type="text" placeholder="Nom société" />
          <label>TVA</label>
          <input id="regVat" type="text" placeholder="BE0xxx.xxx.xxx" />
          <label>Téléphone</label>
          <input id="regPhone" type="text" placeholder="+32 ..." />
          <label>Adresse siège</label>
          <input id="regAddr" type="text" placeholder="Rue, n°, CP, Ville" />

          <button id="btnRegister" class="btn">Créer le compte</button>
          <p id="regErr" class="err"></p>
        </div>
      </div>
    `);
  }

  function uiBookingShell() {
    render(`
      <h2>Étape 2/3 — Choix du créneau</h2>
      <div class="toolbar">
        <button id="btnPrev" class="btn secondary">← Semaine -1</button>
        <div>
          <strong id="weekTitle"></strong>
          <div class="tiny muted">Règle: pas de réservation à moins de 48h.</div>
        </div>
        <button id="btnNext" class="btn secondary">Semaine +1 →</button>
      </div>

      <div id="calendar" class="calendar"></div>

      <hr />

      <h2>Étape 3/3 — Confirmer</h2>
      <div id="selectionBox" class="cardInner">
        <p class="muted">Sélectionne un créneau “Libre”.</p>
      </div>

      <div class="actions">
        <button id="btnConfirm" class="btn primary" disabled>Envoyer la demande</button>
      </div>

      <p id="bookingErr" class="err"></p>
      <p class="tiny muted">
        Tes demandes sont visibles uniquement par toi et l’administrateur.
      </p>
    `);
  }

  function uiAdminShortcut(isAdmin) {
    if (!rightPanel) return;

    const el = document.createElement("div");
    el.className = "cardInner";
    el.innerHTML = `
      <h3>Espace admin</h3>
      <p class="muted">Compte détecté ${isAdmin ? "ADMIN ✅" : "non-admin"}.</p>
      <button class="btn" ${isAdmin ? "" : "disabled"} id="btnGoAdmin">Aller sur /admin</button>
    `;

    rightPanel.prepend(el);

    const btn = $("btnGoAdmin");
    if (btn && isAdmin) btn.addEventListener("click", () => (window.location.href = "/admin"));
  }

  // ------------------------------------------------------------
  // Firestore reads/writes
  // ------------------------------------------------------------
  async function loadPublicSlotsForWeek(db, weekStart, weekEnd) {
    const { publicSlots } = refs(db);

    const snap = await publicSlots
      .where("start", ">=", firebase.firestore.Timestamp.fromDate(weekStart))
      .where("start", "<", firebase.firestore.Timestamp.fromDate(weekEnd))
      .get();

    const slots = [];
    snap.forEach((doc) => {
      const data = doc.data() || {};
      slots.push({ id: doc.id, ...data });
    });

    slots.sort((a, b) => (a.start?.toMillis?.() || 0) - (b.start?.toMillis?.() || 0));
    return slots;
  }

  // ✅ FIX: compat Firestore n’a pas .create()
  // => transaction + tx.set + checks (hold absent + publicSlots free)
  async function tryCreateHold(db, auth, slot) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { holds, publicSlots } = refs(db);
    const slotId = slot.id;

    const expiresAt = firebase.firestore.Timestamp.fromMillis(nowMs() + 20 * 60 * 1000);

    const payload = {
      uid: u.uid,
      start: slot.start,
      end: slot.end,
      expiresAt,
      status: "hold",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
      const holdRef = holds.doc(slotId);
      const pubRef = publicSlots.doc(slotId);

      const [holdSnap, pubSnap] = await Promise.all([tx.get(holdRef), tx.get(pubRef)]);

      if (holdSnap.exists) throw new Error("Ce créneau est déjà verrouillé (hold existant).");
      if (!pubSnap.exists) throw new Error("Créneau introuvable (publicSlots manquant).");

      const pub = pubSnap.data() || {};
      if ((pub.status || "").toLowerCase() !== "free") {
        throw new Error("Créneau non libre (déjà occupé).");
      }

      tx.set(holdRef, payload, { merge: false });
    });

    return payload;
  }

  async function createRequestAndBooking(db, auth, slot, holdPayload) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { bookings, requests, holds } = refs(db);

    const slotId = slot.id;
    const requestId = `REQ_${slotId}_${u.uid.slice(0, 6)}`;

    const bookingDoc = {
      slotId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      requestId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const durationMinutes = Math.round((slot.end.toMillis() - slot.start.toMillis()) / 60000);

    const requestDoc = {
      requestId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      slotIds: [slotId],
      totalSlots: 1,
      durationMinutes,
      holdExpiresAt: holdPayload?.expiresAt || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
      const bookingRef = bookings.doc(slotId);
      const requestRef = requests.doc(requestId);
      const holdRef = holds.doc(slotId);

      const [bookingSnap, holdSnap] = await Promise.all([tx.get(bookingRef), tx.get(holdRef)]);

      if (bookingSnap.exists) {
        throw new Error("Créneau déjà réservé (booking existant).");
      }

      // Optionnel mais utile : vérifier que le hold est bien à toi
      if (!holdSnap.exists) {
        throw new Error("Hold introuvable. Réessaie de sélectionner le créneau.");
      }
      const hold = holdSnap.data() || {};
      if (hold.uid !== u.uid) {
        throw new Error("Ce créneau est verrouillé par un autre utilisateur.");
      }

      tx.set(requestRef, requestDoc, { merge: false });
      tx.set(bookingRef, bookingDoc, { merge: false });

      // Optionnel : supprimer le hold après création request/booking
      tx.delete(holdRef);
    });

    return { requestId };
  }

  // ------------------------------------------------------------
  // Render calendar (group by day)
  // ------------------------------------------------------------
  function renderCalendarInto(calendarEl, slots) {
    const byDay = new Map();

    for (const s of slots) {
      const d = s.start?.toDate?.();
      if (!d) continue;
      const key = startOfDay(d).toISOString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(s);
    }

    const keys = Array.from(byDay.keys()).sort();
    let html = "";

    for (const dayKey of keys) {
      const d = new Date(dayKey);
      const dayLabel = d.toLocaleDateString(undefined, {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
      });

      const weekend = isWeekend(d);

      html += `<div class="dayBlock ${weekend ? "weekend" : ""}">
        <div class="dayTitle">${escapeHtml(dayLabel)}</div>
        <div class="slots">`;

      for (const s of byDay.get(dayKey)) {
        const startD = s.start.toDate();
        const endD = s.end.toDate();
        const hhmm = `${pad2(startD.getHours())}:${pad2(startD.getMinutes())} → ${pad2(endD.getHours())}:${pad2(
          endD.getMinutes()
        )}`;

        const status = (s.status || "").toLowerCase(); // "free" attendu
        const isFree = status === "free";

        html += `
          <button class="slot ${isFree ? "free" : "busy"}"
            data-slotid="${escapeHtml(s.id)}"
            ${isFree ? "" : "disabled"}
            title="${escapeHtml(status)}">
            ${escapeHtml(hhmm)} • ${isFree ? "Libre" : "Occupé"}
          </button>
        `;
      }

      html += `</div></div>`;
    }

    calendarEl.innerHTML = html;
  }

  // ------------------------------------------------------------
  // Wire Auth UI actions (login/register)
  // ------------------------------------------------------------
  function wireAuthUI(auth, db) {
    const loginErr = $("loginErr");
    const regErr = $("regErr");

    const btnLogin = $("btnLogin");
    const btnRegister = $("btnRegister");

    if (btnLogin) {
      btnLogin.addEventListener("click", async () => {
        if (loginErr) loginErr.textContent = "";
        try {
          const email = $("loginEmail")?.value?.trim() || "";
          const pass = $("loginPass")?.value || "";
          await auth.signInWithEmailAndPassword(email, pass);
        } catch (e) {
          console.error(e);
          if (loginErr) loginErr.textContent = e?.message || String(e);
        }
      });
    }

    if (btnRegister) {
      btnRegister.addEventListener("click", async () => {
        if (regErr) regErr.textContent = "";

        const payload = {
          email: $("regEmail")?.value?.trim() || "",
          pass: $("regPass")?.value || "",
          company: $("regCompany")?.value?.trim() || "",
          vat: $("regVat")?.value?.trim() || "",
          phone: $("regPhone")?.value?.trim() || "",
          hqAddress: $("regAddr")?.value?.trim() || "",
        };

        try {
          const cred = await auth.createUserWithEmailAndPassword(payload.email, payload.pass);
          await ensureUserProfile(db, cred.user.uid, payload);
        } catch (e) {
          console.error(e);
          if (regErr) regErr.textContent = e?.message || String(e);
        }
      });
    }
  }

  // ------------------------------------------------------------
  // Wire Booking UI actions
  // ------------------------------------------------------------
  function wireBookingUI({ auth, db, isAdmin }) {
    uiBookingShell();
    uiAdminShortcut(isAdmin);

    let weekAnchor = new Date();
    let selectedSlot = null;
    let selectedHold = null;

    const weekTitle = $("weekTitle");
    const calendar = $("calendar");
    const selectionBox = $("selectionBox");
    const btnPrev = $("btnPrev");
    const btnNext = $("btnNext");
    const btnConfirm = $("btnConfirm");
    const bookingErr = $("bookingErr");

    if (!calendar || !weekTitle || !selectionBox || !btnPrev || !btnNext || !btnConfirm || !bookingErr) {
      throw new Error("DOM booking incomplet. Vérifie index.html.");
    }

    async function refreshCalendar() {
      bookingErr.textContent = "";
      selectedSlot = null;
      selectedHold = null;
      btnConfirm.disabled = true;
      selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;

      const { start, end } = computeWeekRange(weekAnchor);
      const title = `${start.toLocaleDateString()} → ${addDays(end, -1).toLocaleDateString()}`;
      weekTitle.textContent = `Semaine: ${title}`;

      calendar.innerHTML = `<p class="muted">Chargement des créneaux…</p>`;

      let slots = [];
      try {
        slots = await loadPublicSlotsForWeek(db, start, end);
      } catch (e) {
        console.error(e);
        calendar.innerHTML = `<p class="err">Erreur chargement calendrier: ${escapeHtml(e.message || String(e))}</p>`;
        return;
      }

      if (slots.length === 0) {
        calendar.innerHTML = `<p class="muted">Aucun créneau public sur cette semaine.</p>`;
        return;
      }

      renderCalendarInto(calendar, slots);

      // Click handler (uniquement sur free)
      calendar.querySelectorAll("button.slot.free").forEach((btn) => {
        btn.addEventListener("click", async () => {
          bookingErr.textContent = "";
          const slotId = btn.getAttribute("data-slotid");
          const slot = slots.find((x) => x.id === slotId);
          if (!slot) return;

          // UX 48h rule (les rules feront foi)
          const minTs = firebase.firestore.Timestamp.fromMillis(Date.now() + 48 * 3600 * 1000);
          if (slot.start.toMillis() < minTs.toMillis()) {
            bookingErr.textContent = "Ce créneau est à moins de 48h. Non réservable.";
            return;
          }

          btnConfirm.disabled = true;
          selectionBox.innerHTML = `<p class="muted">Création d’un hold…</p>`;

          try {
            const hold = await tryCreateHold(db, auth, slot);
            selectedSlot = slot;
            selectedHold = hold;

            selectionBox.innerHTML = `
              <p><strong>Créneau sélectionné</strong></p>
              <p>${escapeHtml(slot.id)}</p>
              <p class="tiny muted">Hold jusqu’à: ${escapeHtml(hold.expiresAt.toDate().toLocaleString())}</p>
            `;
            btnConfirm.disabled = false;
          } catch (e) {
            console.error(e);
            selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;
            bookingErr.textContent = e?.message || String(e);
          }
        });
      });
    }

    btnPrev.addEventListener("click", async () => {
      weekAnchor = addDays(weekAnchor, -7);
      await refreshCalendar();
    });

    btnNext.addEventListener("click", async () => {
      weekAnchor = addDays(weekAnchor, +7);
      await refreshCalendar();
    });

    btnConfirm.addEventListener("click", async () => {
      bookingErr.textContent = "";
      if (!selectedSlot || !selectedHold) return;

      btnConfirm.disabled = true;
      selectionBox.innerHTML = `<p class="muted">Envoi de la demande…</p>`;

      try {
        const res = await createRequestAndBooking(db, auth, selectedSlot, selectedHold);
        selectionBox.innerHTML = `
          <p><strong>Demande envoyée ✅</strong></p>
          <p class="tiny muted">ID: ${escapeHtml(res.requestId)}</p>
        `;
        // Optionnel: refresh pour refléter l’état (si publicSlots est mis à jour par sync)
        // await refreshCalendar();
      } catch (e) {
        console.error(e);
        bookingErr.textContent = e?.message || String(e);
        btnConfirm.disabled = false;
        selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;
      }
    });

    return { refreshCalendar };
  }

  // ------------------------------------------------------------
  // Main runtime
  // ------------------------------------------------------------
  async function boot() {
    const { auth, db } = getServices();

    setStatus("idle", "Initialisation…");

    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        await auth.signOut();
      });
    }

    // Render auth first
    uiAuth();
    wireAuthUI(auth, db);

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        if (btnLogout) btnLogout.hidden = true;
        setStatus("warn", "Non connecté");

        uiAuth();
        wireAuthUI(auth, db);
        return;
      }

      if (btnLogout) btnLogout.hidden = false;
      setStatus("ok", `Connecté: ${user.email || user.uid}`);

      // Ensure minimal profile exists (safe)
      try {
        await ensureUserProfile(db, user.uid, {
          email: user.email || "",
          company: "",
          vat: "",
          phone: "",
          hqAddress: "",
        });
      } catch (e) {
        console.warn("ensureUserProfile minimal failed:", e);
      }

      // Admin claim (shortcut UI only)
      let isAdmin = false;
      try {
        isAdmin = await getAdminClaim(auth);
      } catch (e) {
        console.warn("Admin claim check failed:", e);
      }

      const booking = wireBookingUI({ auth, db, isAdmin });
      await booking.refreshCalendar();
    });
  }

  boot().catch((e) => {
    console.error(e);
    setStatus("err", "Erreur init");
    render(`<p class="err">${escapeHtml(e?.message || String(e))}</p>`);
  });
})();