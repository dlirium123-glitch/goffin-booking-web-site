/* public/index.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  // ------------------------------------------------------------
  // Version
  // ------------------------------------------------------------
  const APP_VERSION = "v3-2026-02-28-PRO-hold+batch";

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
  function safeProfilePayload(payload) {
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

    const safe = safeProfilePayload(payload);
    safe.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    safe.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

    await ref.set(safe, { merge: false });
  }

  async function updateUserProfile(db, uid, payload) {
    const { users } = refs(db);
    const ref = users.doc(uid);

    const safe = safeProfilePayload(payload);
    safe.updatedAt = firebase.firestore.FieldValue.serverTimestamp();

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
    // Monday start
    const day = d.getDay(); // 0=Sun
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const monday = addDays(d, diffToMonday);
    const sunday = addDays(monday, 7);
    return { start: monday, end: sunday };
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
      <div id="adminShortcutMount"></div>

      <h2>Étape 2/3 — Choix du créneau</h2>
      <div id="syncHealthLine" class="tiny muted">Sync Outlook: statut inconnu.</div>

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

  function mountAdminShortcut(isAdmin) {
    const mount = $("adminShortcutMount");
    if (!mount) return;
    mount.innerHTML = `
      <div class="cardInner">
        <h3>Espace admin</h3>
        <p class="muted">Compte détecté ${isAdmin ? "ADMIN ✅" : "non-admin"}.</p>
        <button class="btn" ${isAdmin ? "" : "disabled"} id="btnGoAdmin">Aller sur /admin</button>
      </div>
    `;
    const btn = $("btnGoAdmin");
    if (btn && isAdmin) btn.addEventListener("click", () => (window.location.href = "/admin"));
  }

  // ------------------------------------------------------------
  // Firestore data loaders
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

  async function loadSyncHealth(db) {
    // Attention: rules actuelles -> syncHealth lecture admin only
    // Donc pour un client: on catch et on laisse “inconnu”.
    const line = $("syncHealthLine");
    if (!line) return;

    try {
      const { syncHealth } = refs(db);
      const snap = await syncHealth.doc("outlook").get();
      if (!snap.exists) return;
      const d = snap.data() || {};
      line.textContent = `Sync Outlook: ${d.status || "?"} — ${d.updatedAt?.toDate?.().toLocaleString?.() || ""}`.trim();
    } catch {
      // non-admin => ok
    }
  }

  // ------------------------------------------------------------
  // Hold / Booking logic (aligned with rules)
  // ------------------------------------------------------------
  async function createHoldTx(db, auth, slot) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { holds } = refs(db);
    const slotId = slot.id;

    const expiresAt = firebase.firestore.Timestamp.fromMillis(nowMs() + 20 * 60 * 1000);
    const payload = {
      uid: u.uid,
      start: slot.start,
      end: slot.end,
      expiresAt,
      status: "hold",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const holdRef = holds.doc(slotId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(holdRef); // allowed by rules: holds read true
      if (snap.exists) throw new Error("Ce créneau est déjà en hold. Réessaie dans 1 minute.");
      tx.set(holdRef, payload, { merge: false }); // create
    });

    return payload;
  }

  async function createRequestAndBookingBatch(db, auth, slot, requestId) {
    const u = auth.currentUser;
    if (!u) throw new Error("Non connecté.");

    const { bookings, requests, holds } = refs(db);
    const slotId = slot.id;

    const startMs = slot.start.toMillis();
    const endMs = slot.end.toMillis();
    const durationMinutes = Math.round((endMs - startMs) / 60000);

    const nowServer = firebase.firestore.FieldValue.serverTimestamp();

    const bookingDoc = {
      slotId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      requestId,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    const requestDoc = {
      requestId,
      uid: u.uid,
      status: "pending",
      start: slot.start,
      end: slot.end,
      slotIds: [slotId],
      totalSlots: 1,
      durationMinutes,
      createdAt: nowServer,
      updatedAt: nowServer,
    };

    const batch = db.batch();

    // set() will be CREATE if doc doesn't exist; if it exists -> UPDATE (denied by rules)
    batch.set(requests.doc(requestId), requestDoc, { merge: false });
    batch.set(bookings.doc(slotId), bookingDoc, { merge: false });

    // optional: delete hold right away (rules allow delete own hold)
    batch.delete(holds.doc(slotId));

    await batch.commit();
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

    uiAuth();

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        if (btnLogout) btnLogout.hidden = true;
        setStatus("warn", "Non connecté");
        uiAuth();
        wireAuthForms(db, auth);
        return;
      }

      if (btnLogout) btnLogout.hidden = false;
      setStatus("ok", `Connecté: ${user.email || user.uid}`);

      let isAdmin = false;
      try {
        isAdmin = await getAdminClaim(auth);
      } catch (e) {
        console.warn("Admin claim check failed:", e);
      }

      uiBookingShell();
      mountAdminShortcut(isAdmin);
      await loadSyncHealth(db);

      // Ensure minimal profile exists (safe + allowed by rules)
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

      // Wire booking UI
      const weekTitle = $("weekTitle");
      const calendar = $("calendar");
      const selectionBox = $("selectionBox");
      const btnPrev = $("btnPrev");
      const btnNext = $("btnNext");
      const btnConfirm = $("btnConfirm");
      const bookingErr = $("bookingErr");

      let weekAnchor = new Date();
      let selectedSlot = null;
      let selectedHold = null;

      async function refreshCalendar() {
        if (bookingErr) bookingErr.textContent = "";
        selectedSlot = null;
        selectedHold = null;
        if (btnConfirm) btnConfirm.disabled = true;
        if (selectionBox) selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;

        const { start, end } = computeWeekRange(weekAnchor);
        const title = `${start.toLocaleDateString()} → ${addDays(end, -1).toLocaleDateString()}`;
        if (weekTitle) weekTitle.textContent = `Semaine: ${title}`;

        if (calendar) calendar.innerHTML = `<p class="muted">Chargement des créneaux…</p>`;

        let slots = [];
        try {
          slots = await loadPublicSlotsForWeek(db, start, end);
        } catch (e) {
          console.error(e);
          if (calendar) calendar.innerHTML = `<p class="err">Erreur chargement calendrier: ${escapeHtml(e.message || String(e))}</p>`;
          return;
        }

        if (slots.length === 0) {
          if (calendar) calendar.innerHTML = `<p class="muted">Aucun créneau public sur cette semaine.</p>`;
          return;
        }

        // Group by day
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

            const status = (s.status || "").toLowerCase(); // "free" expected
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

        if (calendar) calendar.innerHTML = html;

        // Slot click
        calendar.querySelectorAll("button.slot.free").forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (bookingErr) bookingErr.textContent = "";
            const slotId = btn.getAttribute("data-slotid");
            const slot = slots.find((x) => x.id === slotId);
            if (!slot) return;

            // UX check 48h
            const minTs = firebase.firestore.Timestamp.fromMillis(Date.now() + 48 * 3600 * 1000);
            if (slot.start.toMillis() < minTs.toMillis()) {
              if (bookingErr) bookingErr.textContent = "Ce créneau est à moins de 48h. Non réservable.";
              return;
            }

            if (btnConfirm) btnConfirm.disabled = true;
            if (selectionBox) selectionBox.innerHTML = `<p class="muted">Création d’un hold…</p>`;

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
              if (selectionBox) selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;
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

          const u = auth.currentUser;
          const requestId = `REQ_${selectedSlot.id}_${(u?.uid || "nouid").slice(0, 6)}`;

          try {
            await createRequestAndBookingBatch(db, auth, selectedSlot, requestId);

            if (selectionBox) {
              selectionBox.innerHTML = `
                <p><strong>Demande envoyée ✅</strong></p>
                <p class="tiny muted">ID: ${escapeHtml(requestId)}</p>
              `;
            }
          } catch (e) {
            console.error(e);
            if (bookingErr) bookingErr.textContent = e?.message || String(e);
            btnConfirm.disabled = false;
            if (selectionBox) selectionBox.innerHTML = `<p class="muted">Sélectionne un créneau “Libre”.</p>`;
          }
        });
      }

      // load calendar
      await refreshCalendar();
    });

    // initial wiring for auth view
    wireAuthForms(getServices().db, getServices().auth);
  }

  function wireAuthForms(db, auth) {
    // login
    const btnLogin = $("btnLogin");
    if (btnLogin) {
      btnLogin.addEventListener("click", async () => {
        const loginErr = $("loginErr");
        if (loginErr) loginErr.textContent = "";
        try {
          await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPass").value);
        } catch (e) {
          console.error(e);
          if (loginErr) loginErr.textContent = e?.message || String(e);
        }
      });
    }

    // register
    const btnRegister = $("btnRegister");
    if (btnRegister) {
      btnRegister.addEventListener("click", async () => {
        const regErr = $("regErr");
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

  boot().catch((e) => {
    console.error(e);
    setStatus("err", "Erreur init");
    render(`<p class="err">${escapeHtml(e?.message || String(e))}</p>`);
  });
})();