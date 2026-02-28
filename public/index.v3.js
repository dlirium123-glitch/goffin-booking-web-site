/* public/index.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  // ------------------------------------------------------------
  // Version
  // ------------------------------------------------------------
  const APP_VERSION = "v3-2026-02-28-PRO-clean";

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

  // ------------------------------------------------------------
  // Firebase (Compat) bootstrap
  // ------------------------------------------------------------
  function assertFirebaseLoaded() {
    if (!window.firebase) throw new Error("Firebase SDK non chargé (firebase global manquant).");
    if (!firebase.auth) throw new Error("firebase-auth-compat non chargé.");
    if (!firebase.firestore) throw new Error("firebase-firestore-compat non chargé.");
  }

  function getApp() {
    assertFirebaseLoaded();
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp({});
    }
    return firebase.app();
  }

  function getServices() {
    getApp();
    const auth = firebase.auth();
    const db = firebase.firestore();
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
      syncHealth: db.collection("syncHealth"),
    };
  }

  // ------------------------------------------------------------
  // Admin check = custom claim ONLY
  // ------------------------------------------------------------
  async function getAdminClaim(auth) {
    const u = auth.currentUser;
    if (!u) return false;
    const token = await u.getIdTokenResult(true);
    return token?.claims?.admin === true;
  }

  // ------------------------------------------------------------
  // User profile (users/{uid})
  // ------------------------------------------------------------
  function normalizeProfile(payload) {
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

    const base = normalizeProfile(payload);

    await ref.set(
      {
        ...base,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
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
    const day = d.getDay(); // 0=dim
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = addDays(d, diffToMonday);
    const sunday = addDays(monday, 7);
    return { start: monday, end: sunday };
  }

  // ------------------------------------------------------------
  // UI blocks
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

      <div id="syncBox" class="tiny muted" style="margin-bottom:10px;"></div>

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
      <p class="tiny muted">Tes demandes sont visibles uniquement par toi et l’administrateur.</p>
    `);
  }

  function uiAdminShortcut(isAdmin) {
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
  // Data: publicSlots
  // ------------------------------------------------------------
  async function loadPublicSlotsForWeek(db, weekStart, weekEnd) {
    const { publicSlots } = refs(db);
    const snap = await publicSlots
      .where("start", ">=", firebase.firestore.Timestamp.fromDate(weekStart))
      .where("start", "<", firebase.firestore.Timestamp.fromDate(weekEnd))
      .get();

    const slots = [];
    snap.forEach((doc) => slots.push({ id: doc.id, ...(doc.data() || {}) }));
    slots.sort((a, b) => (a.start?.toMillis?.() || 0) - (b.start?.toMillis?.() || 0));
    return slots;
  }

  async function loadSyncHealth(db) {
    try {
      const { syncHealth } = refs(db);
      const snap = await syncHealth.doc("outlook").get();
      if (!snap.exists) return null;
      return snap.data() || null;
    } catch {
      return null;
    }
  }

  function renderSyncHealth(boxEl, data) {
    if (!boxEl) return;
    if (!data) {
      boxEl.textContent = "Sync Outlook: statut inconnu.";
      return;
    }
    const status = String(data.status || "unknown");
    const updatedAt = data.updatedAt?.toDate?.() ? data.updatedAt.toDate().toLocaleString() : "";
    const busy = data.meta?.busySlots ?? data.meta?.busySlotsInRange ?? data.meta?.busy ?? null;
    boxEl.textContent = `Sync Outlook: ${status}${updatedAt ? " • " + updatedAt : ""}${busy != null ? " • busySlots=" + busy : ""}`;
  }

  // ------------------------------------------------------------
  // Booking primitives
  // ------------------------------------------------------------
  function isAtLeast48hClient(ts) {
    const min = firebase.firestore.Timestamp.fromMillis(Date.now() + 48 * 3600 * 1000);
    return ts.toMillis() >= min.toMillis();
  }

  async function createHoldTx(db, auth, slot) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { holds } = refs(db);
    const slotId = slot.id;

    const holdRef = holds.doc(slotId);
    const expiresAt = firebase.firestore.Timestamp.fromMillis(Date.now() + 20 * 60 * 1000);

    // IMPORTANT: respecter holdKeysAllowed() => PAS de createdAt ici
    const payload = {
      uid: u.uid,
      start: slot.start,
      end: slot.end,
      expiresAt,
      status: "hold",
    };

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(holdRef);
      if (snap.exists) throw new Error("Créneau déjà verrouillé (hold existant).");
      tx.set(holdRef, payload, { merge: false });
    });

    return payload;
  }

  async function createRequestAndBookingTx(db, auth, slot, holdPayload) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { bookings, requests } = refs(db);

    const slotId = slot.id;
    const requestId = `REQ_${slotId}_${u.uid.slice(0, 6)}`;

    const bookingRef = bookings.doc(slotId);
    const requestRef = requests.doc(requestId);

    const bookingDoc = {
      slotId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      requestId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const requestDoc = {
      requestId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      slotIds: [slotId],
      totalSlots: 1,
      durationMinutes: Math.round((slot.end.toMillis() - slot.start.toMillis()) / 60000),
      holdExpiresAt: holdPayload?.expiresAt || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
      const b = await tx.get(bookingRef);
      if (b.exists) throw new Error("Créneau déjà réservé (booking existant).");

      tx.set(requestRef, requestDoc, { merge: false });
      tx.set(bookingRef, bookingDoc, { merge: false });
    });

    return { requestId };
  }

  // ------------------------------------------------------------
  // Booking UI controller
  // ------------------------------------------------------------
  async function mountBookingUI({ auth, db, isAdmin }) {
    uiBookingShell();
    uiAdminShortcut(isAdmin);

    const weekTitle = $("weekTitle");
    const calendar = $("calendar");
    const selectionBox = $("selectionBox");
    const btnPrev = $("btnPrev");
    const btnNext = $("btnNext");
    const btnConfirm = $("btnConfirm");
    const bookingErr = $("bookingErr");
    const syncBox = $("syncBox");

    // Show sync health (nice for debug)
    renderSyncHealth(syncBox, await loadSyncHealth(db));

    let weekAnchor = new Date();
    let selectedSlot = null;
    let selectedHold = null;

    function resetSelection() {
      selectedSlot = null;
      selectedHold = null;
      if (btnConfirm) btnConfirm.disabled = true;
      if (selectionBox) selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;
    }

    async function refreshCalendar() {
      if (bookingErr) bookingErr.textContent = "";
      resetSelection();
      if (!calendar) return;

      const { start, end } = computeWeekRange(weekAnchor);
      const title = `${start.toLocaleDateString()} → ${addDays(end, -1).toLocaleDateString()}`;
      if (weekTitle) weekTitle.textContent = `Semaine: ${title}`;

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
        const dayLabel = d.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "2-digit" });
        const weekend = isWeekend(d);

        html += `<div class="dayBlock ${weekend ? "weekend" : ""}">
          <div class="dayTitle">${escapeHtml(dayLabel)}</div>
          <div class="slots">`;

        for (const s of byDay.get(dayKey)) {
          const startD = s.start.toDate();
          const endD = s.end.toDate();
          const hhmm = `${pad2(startD.getHours())}:${pad2(startD.getMinutes())} → ${pad2(endD.getHours())}:${pad2(endD.getMinutes())}`;

          const status = String(s.status || "").toLowerCase(); // "free" | "busy"
          const isFree = status === "free";
          const isOk48h = isAtLeast48hClient(s.start);

          const disabled = !isFree || !isOk48h;

          html += `
            <button class="slot ${!disabled ? "free" : "busy"}"
              data-slotid="${escapeHtml(s.id)}"
              ${disabled ? "disabled" : ""}
              title="${escapeHtml(status)}">
              ${escapeHtml(hhmm)} • ${!disabled ? "Libre" : "Occupé"}
            </button>
          `;
        }

        html += `</div></div>`;
      }

      calendar.innerHTML = html;

      // Click binding (only enabled buttons exist)
      calendar.querySelectorAll("button.slot.free").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (bookingErr) bookingErr.textContent = "";
          const slotId = btn.getAttribute("data-slotid");
          const slot = slots.find((x) => x.id === slotId);
          if (!slot) return;

          if (!isAtLeast48hClient(slot.start)) {
            if (bookingErr) bookingErr.textContent = "Ce créneau est à moins de 48h. Non réservable.";
            return;
          }

          resetSelection();
          if (selectionBox) selectionBox.innerHTML = `<p class="muted">Création d’un hold…</p>`;
          if (btnConfirm) btnConfirm.disabled = true;

          try {
            const hold = await createHoldTx(db, auth, slot);
            selectedSlot = slot;
            selectedHold = hold;

            if (selectionBox) {
              selectionBox.innerHTML = `
                <p><strong>Créneau sélectionné</strong></p>
                <p>${escapeHtml(slot.id)}</p>
                <p class="tiny muted">Hold jusqu’à: ${escapeHtml(hold.expiresAt.toDate().toLocaleString())}</p>
              `;
            }
            if (btnConfirm) btnConfirm.disabled = false;
          } catch (e) {
            console.error(e);
            resetSelection();
            if (bookingErr) bookingErr.textContent = e?.message || String(e);
          }
        });
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener("click", async () => {
        weekAnchor = addDays(weekAnchor, -7);
        await refreshCalendar();
      });
    }

    if (btnNext) {
      btnNext.addEventListener("click", async () => {
        weekAnchor = addDays(weekAnchor, +7);
        await refreshCalendar();
      });
    }

    if (btnConfirm) {
      btnConfirm.addEventListener("click", async () => {
        if (bookingErr) bookingErr.textContent = "";
        if (!selectedSlot || !selectedHold) return;

        btnConfirm.disabled = true;
        if (selectionBox) selectionBox.innerHTML = `<p class="muted">Envoi de la demande…</p>`;

        try {
          const res = await createRequestAndBookingTx(db, auth, selectedSlot, selectedHold);
          if (selectionBox) {
            selectionBox.innerHTML = `
              <p><strong>Demande envoyée ✅</strong></p>
              <p class="tiny muted">ID: ${escapeHtml(res.requestId)}</p>
            `;
          }
        } catch (e) {
          console.error(e);
          if (bookingErr) bookingErr.textContent = e?.message || String(e);
          resetSelection();
        }
      });
    }

    await refreshCalendar();
  }

  // ------------------------------------------------------------
  // Auth controller
  // ------------------------------------------------------------
  function wireAuthForm({ auth, db }) {
    const loginEmail = $("loginEmail");
    const loginPass = $("loginPass");
    const btnLogin = $("btnLogin");
    const loginErr = $("loginErr");

    const btnRegister = $("btnRegister");
    const regErr = $("regErr");

    if (btnLogin) {
      btnLogin.addEventListener("click", async () => {
        if (loginErr) loginErr.textContent = "";
        try {
          await auth.signInWithEmailAndPassword(loginEmail.value.trim(), loginPass.value);
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
          email: $("regEmail").value.trim(),
          pass: $("regPass").value,
          company: $("regCompany").value.trim(),
          vat: $("regVat").value.trim(),
          phone: $("regPhone").value.trim(),
          hqAddress: $("regAddr").value.trim(),
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

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        if (btnLogout) btnLogout.hidden = true;
        setStatus("warn", "Non connecté");
        uiAuth();
        wireAuthForm({ auth, db });
        return;
      }

      if (btnLogout) btnLogout.hidden = false;
      setStatus("ok", `Connecté: ${user.email || user.uid}`);

      // Ensure minimal profile exists (safe)
      try {
        await ensureUserProfile(db, user.uid, { email: user.email || "" });
      } catch (e) {
        console.warn("ensureUserProfile minimal failed:", e);
      }

      let isAdmin = false;
      try {
        isAdmin = await getAdminClaim(auth);
      } catch (e) {
        console.warn("Admin claim check failed:", e);
      }

      await mountBookingUI({ auth, db, isAdmin });
    });

    // initial view
    uiAuth();
    wireAuthForm({ auth, db });
  }

  boot().catch((e) => {
    console.error(e);
    setStatus("err", "Erreur init");
    render(`<p class="err">${escapeHtml(e?.message || String(e))}</p>`);
  });
})();