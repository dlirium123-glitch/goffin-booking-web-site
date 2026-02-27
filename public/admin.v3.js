/* public/admin.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  const APP_VERSION = "admin-v3-2026-02-27-PRO-clean";

  const $ = (id) => document.getElementById(id);

  const pillStatus = $("pillStatus");
  const statusText = $("statusText");
  const btnLogout = $("btnLogout");
  const adminVersion = $("adminVersion");

  const overlay = $("overlay");
  const adminEmail = $("adminEmail");
  const adminPass = $("adminPass");
  const btnLogin = $("btnLogin");
  const loginErr = $("loginErr");

  const rowSyncHealth = $("rowSyncHealth");
  const syncHealthBox = $("syncHealthBox");

  const rowStats = $("rowStats");
  const statUsers = $("statUsers");
  const statRequestsPending = $("statRequestsPending");
  const statHoldsActive = $("statHoldsActive");

  const rowTools = $("rowTools");
  const btnRefresh = $("btnRefresh");

  const rowRequests = $("rowRequests");
  const reqList = $("reqList");
  const reqEmpty = $("reqEmpty");

  const rowHolds = $("rowHolds");
  const holdList = $("holdList");
  const holdEmpty = $("holdEmpty");

  adminVersion.textContent = APP_VERSION;

  function setStatus(kind, text) {
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

  function showOverlay(show) {
    overlay.hidden = !show;
  }

  function assertFirebaseLoaded() {
    if (!window.firebase) throw new Error("Firebase SDK non chargé.");
    if (!firebase.auth) throw new Error("firebase-auth-compat non chargé.");
    if (!firebase.firestore) throw new Error("firebase-firestore-compat non chargé.");
  }

  function getServices() {
    assertFirebaseLoaded();
    if (!firebase.apps || firebase.apps.length === 0) firebase.initializeApp({});
    const auth = firebase.auth();
    const db = firebase.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return { auth, db };
  }

  function refs(db) {
    return {
      users: db.collection("users"),
      requests: db.collection("requests"),
      holds: db.collection("holds"),
      bookings: db.collection("bookings"),
      syncHealth: db.collection("syncHealth"),
      settings: db.collection("settings"),
      slots: db.collection("slots"),
    };
  }

  async function requireAdmin(auth) {
    const u = auth.currentUser;
    if (!u) return false;
    const token = await u.getIdTokenResult(true);
    return token?.claims?.admin === true;
  }

  function showAdminUI(show) {
    rowSyncHealth.hidden = !show;
    rowStats.hidden = !show;
    rowTools.hidden = !show;
    rowRequests.hidden = !show;
    rowHolds.hidden = !show;
    btnLogout.hidden = !show;
  }

  // ------------------------------------------------------------
  // Rendering helpers
  // ------------------------------------------------------------
  function renderReqItem(req) {
    const start = req.start?.toDate?.() ? req.start.toDate().toLocaleString() : "—";
    const end = req.end?.toDate?.() ? req.end.toDate().toLocaleString() : "—";
    const uid = req.uid || "—";
    const status = req.status || "—";
    const rid = req.requestId || req.id;

    return `
      <div class="item">
        <div class="itemMain">
          <div><strong>${escapeHtml(rid)}</strong></div>
          <div class="tiny muted">${escapeHtml(uid)}</div>
          <div class="tiny">🕒 ${escapeHtml(start)} → ${escapeHtml(end)}</div>
          <div class="tiny">Status: <strong>${escapeHtml(status)}</strong></div>
        </div>
        <div class="itemActions">
          <button class="btn small primary" data-act="validate" data-id="${escapeHtml(req.id)}">Valider</button>
          <button class="btn small" data-act="refuse" data-id="${escapeHtml(req.id)}">Refuser</button>
        </div>
      </div>
    `;
  }

  function renderHoldItem(h) {
    const start = h.start?.toDate?.() ? h.start.toDate().toLocaleString() : "—";
    const exp = h.expiresAt?.toDate?.() ? h.expiresAt.toDate().toLocaleString() : "—";
    const uid = h.uid || "—";
    const status = h.status || "—";
    return `
      <div class="item">
        <div class="itemMain">
          <div><strong>${escapeHtml(h.id)}</strong></div>
          <div class="tiny muted">${escapeHtml(uid)}</div>
          <div class="tiny">Start: ${escapeHtml(start)}</div>
          <div class="tiny">Expire: ${escapeHtml(exp)}</div>
          <div class="tiny">Status: <strong>${escapeHtml(status)}</strong></div>
        </div>
        <div class="itemActions">
          <button class="btn small" data-act="deleteHold" data-id="${escapeHtml(h.id)}">Supprimer</button>
        </div>
      </div>
    `;
  }

  // ------------------------------------------------------------
  // Data load
  // ------------------------------------------------------------
  async function loadSyncHealth(db) {
    const { syncHealth } = refs(db);
    const snap = await syncHealth.orderBy("updatedAt", "desc").limit(1).get();
    if (snap.empty) {
      syncHealthBox.innerHTML = `<p class="muted">Aucune donnée syncHealth.</p>`;
      return;
    }
    const doc = snap.docs[0];
    const d = doc.data() || {};
    const updated = d.updatedAt?.toDate?.() ? d.updatedAt.toDate().toLocaleString() : "—";
    const ok = d.ok === true;

    syncHealthBox.innerHTML = `
      <div class="pill ${ok ? "ok" : "warn"}">${ok ? "OK" : "Attention"}</div>
      <div class="tiny muted">Dernière mise à jour: ${escapeHtml(updated)}</div>
      <pre class="tiny">${escapeHtml(JSON.stringify(d, null, 2))}</pre>
    `;
  }

  async function loadStats(db) {
    const { users, requests, holds } = refs(db);

    // Simple counts (non agrégé) : ok pour petit volume
    const [usersSnap, reqSnap, holdsSnap] = await Promise.all([
      users.limit(200).get(),
      requests.where("status", "==", "pending").limit(200).get(),
      holds.limit(200).get(),
    ]);

    statUsers.textContent = String(usersSnap.size);
    statRequestsPending.textContent = String(reqSnap.size);

    // holds actifs = expiresAt > now
    const nowTs = firebase.firestore.Timestamp.now();
    let active = 0;
    holdsSnap.forEach((d) => {
      const x = d.data() || {};
      if (x.expiresAt && x.expiresAt.toMillis() > nowTs.toMillis()) active += 1;
    });
    statHoldsActive.textContent = String(active);
  }

  async function loadRequests(db) {
    const { requests } = refs(db);
    const snap = await requests.orderBy("createdAt", "desc").limit(50).get();

    if (snap.empty) {
      reqEmpty.hidden = false;
      reqList.innerHTML = "";
      return;
    }

    reqEmpty.hidden = true;
    const items = [];
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));

    reqList.innerHTML = items.map(renderReqItem).join("");
  }

  async function loadHolds(db) {
    const { holds } = refs(db);
    const snap = await holds.orderBy("expiresAt", "desc").limit(50).get();

    if (snap.empty) {
      holdEmpty.hidden = false;
      holdList.innerHTML = "";
      return;
    }

    holdEmpty.hidden = true;
    const items = [];
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));

    holdList.innerHTML = items.map(renderHoldItem).join("");
  }

  async function refreshAll(db) {
    await Promise.all([loadSyncHealth(db), loadStats(db), loadRequests(db), loadHolds(db)]);
  }

  // ------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------
  async function setRequestStatus(db, requestId, newStatus) {
    const { requests } = refs(db);
    const ref = requests.doc(requestId);

    await ref.set(
      {
        status: newStatus,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  async function deleteHold(db, slotId) {
    const { holds } = refs(db);
    await holds.doc(slotId).delete();
  }

  function wireActionDelegation(db) {
    reqList.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-act]");
      if (!btn) return;

      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      if (!id) return;

      btn.disabled = true;
      try {
        if (act === "validate") await setRequestStatus(db, id, "validated");
        if (act === "refuse") await setRequestStatus(db, id, "refused");
        await refreshAll(db);
      } catch (e) {
        console.error(e);
        alert(e?.message || String(e));
      } finally {
        btn.disabled = false;
      }
    });

    holdList.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-act]");
      if (!btn) return;

      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      if (!id) return;

      btn.disabled = true;
      try {
        if (act === "deleteHold") await deleteHold(db, id);
        await refreshAll(db);
      } catch (e) {
        console.error(e);
        alert(e?.message || String(e));
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  async function boot() {
    const { auth, db } = getServices();

    setStatus("idle", "Initialisation…");
    showAdminUI(false);
    showOverlay(false);

    btnLogout.addEventListener("click", async () => {
      await auth.signOut();
    });

    btnLogin.addEventListener("click", async () => {
      loginErr.textContent = "";
      showOverlay(true);
      try {
        await auth.signInWithEmailAndPassword(adminEmail.value.trim(), adminPass.value);
      } catch (e) {
        console.error(e);
        loginErr.textContent = e?.message || String(e);
      } finally {
        showOverlay(false);
      }
    });

    btnRefresh.addEventListener("click", async () => {
      showOverlay(true);
      try {
        await refreshAll(db);
      } catch (e) {
        console.error(e);
        alert(e?.message || String(e));
      } finally {
        showOverlay(false);
      }
    });

    wireActionDelegation(db);

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setStatus("warn", "Non connecté");
        showAdminUI(false);
        return;
      }

      setStatus("ok", `Connecté: ${user.email || user.uid}`);

      // HARD GATE: admin claim
      showOverlay(true);
      try {
        const ok = await requireAdmin(auth);
        if (!ok) {
          setStatus("err", "Accès refusé (pas admin)");
          showAdminUI(false);
          loginErr.textContent = "Ce compte n’a pas le claim admin.";
          // Option: redirect home
          // window.location.href = "/";
          return;
        }

        loginErr.textContent = "";
        showAdminUI(true);
        await refreshAll(db);
      } finally {
        showOverlay(false);
      }
    });
  }

  boot().catch((e) => {
    console.error(e);
    setStatus("err", "Erreur init");
    loginErr.textContent = e?.message || String(e);
  });
})();