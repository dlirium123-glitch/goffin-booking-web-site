/* public/admin.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  const { escapeHtml, getServices, firestoreRefs, formatters, statuses } = window.GoffinBooking || {};

  const APP_VERSION = "admin-v3-2026-03-11-pro";
  const $ = (id) => document.getElementById(id);

  const pillStatus = $("pillStatus");
  const statusText = $("statusText");
  const btnOpenLogin = $("btnOpenLogin");
  const btnLogout = $("btnLogout");
  const adminVersion = $("adminVersion");
  const overlay = $("overlay");
  const loginEmail = $("loginEmail");
  const loginPass = $("loginPass");
  const btnDoLogin = $("btnDoLogin");
  const btnCloseLogin = $("btnCloseLogin");
  const loginErr = $("loginErr");
  const adminRail = $("adminRail");
  const adminDetail = $("adminDetail");
  const btnRefresh = $("btnRefresh");
  const statusFilter = $("statusFilter");
  const search = $("search");
  const requestList = $("requestList");
  const requestEmpty = $("requestEmpty");
  const holdList = $("holdList");
  const holdEmpty = $("holdEmpty");
  const syncHealthBox = $("syncHealthBox");
  const statUsers = $("statUsers");
  const statRequestsPending = $("statRequestsPending");
  const statHoldsActive = $("statHoldsActive");
  const statOutboxPending = $("statOutboxPending");
  const detailEmpty = $("detailEmpty");
  const detailContent = $("detailContent");
  const detailRequestTitle = $("detailRequestTitle");
  const detailRequestMeta = $("detailRequestMeta");
  const detailActions = $("detailActions");
  const detailCustomer = $("detailCustomer");
  const detailAddresses = $("detailAddresses");
  const detailAppointments = $("detailAppointments");
  const detailOutbox = $("detailOutbox");

  if (adminVersion) adminVersion.textContent = APP_VERSION;

  let selectedRequestId = null;
  let requestsCache = [];

  function refs(db) {
    return firestoreRefs.createRefs(db);
  }

  function setStatus(kind, text) {
    pillStatus.classList.remove("ok", "warn", "err");
    if (kind === "ok") pillStatus.classList.add("ok");
    if (kind === "warn") pillStatus.classList.add("warn");
    if (kind === "err") pillStatus.classList.add("err");
    statusText.textContent = text;
  }

  function showOverlay(show) {
    overlay.hidden = !show;
  }

  function showAdmin(show) {
    adminRail.hidden = !show;
    adminDetail.hidden = !show;
    btnLogout.hidden = !show;
  }

  async function requireAdmin(auth) {
    const user = auth.currentUser;
    if (!user) return false;
    const token = await user.getIdTokenResult(true);
    return token?.claims?.admin === true;
  }

  function formatDateTime(value) {
    const date = value?.toDate?.() || (value instanceof Date ? value : null);
    if (!date) return "-";
    return date.toLocaleString("fr-BE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatShortDate(value) {
    const date = value?.toDate?.() || (value instanceof Date ? value : null);
    if (!date) return "-";
    return date.toLocaleDateString("fr-BE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    });
  }

  function statusLabel(value) {
    const labels = {
      pending: "En attente",
      scheduled: "Planifie",
      completed: "Termine",
      cancelled: "Annule",
      sent: "Envoye",
      failed: "Echec",
      not_created: "Non cree",
      created: "Cree",
    };
    return labels[value] || statuses.getStatusLabel?.(value) || value || "-";
  }

  function compactRequestId(value) {
    const raw = String(value || "");
    if (!raw) return "-";
    return raw.length > 18 ? `${raw.slice(0, 14)}...${raw.slice(-4)}` : raw;
  }

  function renderStatusBadge(value) {
    return `<span class="statusBadge ${escapeHtml(String(value || "").toLowerCase())}">${escapeHtml(statusLabel(value))}</span>`;
  }

  function renderRequestItem(request) {
    const customer = request.customerSnapshot || {};
    const label = customer.company || customer.contactName || customer.email || "Client sans nom";
    const meta = [
      `${request.totalAddresses || 0} adresse(s)`,
      `${request.totalAppointments || 0} rendez-vous`,
      formatShortDate(request.createdAt),
    ].join(" • ");

    return `
      <button class="requestCard ${selectedRequestId === request.id ? "selected" : ""}" data-request-id="${escapeHtml(request.id)}" type="button">
        <div class="requestCardTop">
          <div>
            <p class="requestNumber">${escapeHtml(request.requestNumber || compactRequestId(request.id))}</p>
            <div class="requestSubline">${escapeHtml(label)}</div>
          </div>
          ${renderStatusBadge(request.status || "pending")}
        </div>
        <div class="requestMeta">${escapeHtml(meta)}</div>
      </button>
    `;
  }

  function renderHoldItem(hold) {
    return `
      <article class="holdItem">
        <strong>${escapeHtml(hold.requestAddressTempKey || hold.id)}</strong>
        <div class="microMeta">${escapeHtml((hold.slotIds || []).join(", "))}</div>
        <div class="microMeta">Expire le ${escapeHtml(formatDateTime(hold.expiresAt))}</div>
      </article>
    `;
  }

  function renderCustomerCards(customer) {
    return `
      <article class="customerCard">
        <p class="customerLabel">Contact</p>
        <div class="customerValue">${escapeHtml(customer.contactName || "-")}</div>
        <div class="microMeta">${escapeHtml(customer.company || "-")}</div>
      </article>
      <article class="customerCard">
        <p class="customerLabel">Coordonnees</p>
        <div class="microMeta">${escapeHtml(customer.email || "-")}</div>
        <div class="microMeta">${escapeHtml(customer.phone || "-")}</div>
        <div class="microMeta">${escapeHtml(customer.vat || "-")}</div>
      </article>
    `;
  }

  function renderAddressCard(address, servicesByAddress) {
    const services = servicesByAddress.get(address.id) || [];
    const summary = [
      [address.addressLine1, address.postalCode, address.city].filter(Boolean).join(", "),
      address.region ? address.region.charAt(0).toUpperCase() + address.region.slice(1) : null,
      `Duree ${formatters.formatMinutes(address.totalDurationMinutes || 0)}`,
    ].filter(Boolean).join(" • ");

    const serviceItems = services.map((service) => `
      <div class="techItem">
        <div>
          <div class="techName">${escapeHtml(service.serviceLabelSnapshot || service.serviceTypeId)}</div>
          <div class="microMeta">${escapeHtml(String(service.installationsCount || 0))} installation(s)</div>
        </div>
        <span class="tag">${escapeHtml(formatters.formatMinutes(service.serviceMinutes || 0))}</span>
      </div>
    `).join("");

    return `
      <article class="addressCard">
        <div class="addressTitle">
          <div>
            <h4>${escapeHtml(address.label || address.addressLine1 || "Adresse d'intervention")}</h4>
            <div class="requestSubline">${escapeHtml(summary)}</div>
          </div>
          ${renderStatusBadge(address.status || "pending")}
        </div>
        <div class="summaryPairs">
          <span class="tag">${escapeHtml(formatters.formatMinutes(address.serviceMinutes || 0))} service</span>
          <span class="tag">${escapeHtml(formatters.formatMinutes(address.travelMinutes || 0))} trajet</span>
          <span class="tag">${escapeHtml(formatters.formatMinutes(address.totalDurationMinutes || 0))} total</span>
        </div>
        <div class="techList">${serviceItems || `<div class="microMeta">Aucune technique.</div>`}</div>
      </article>
    `;
  }

  function renderAppointmentCard(appointment) {
    const timeRange = `${formatDateTime(appointment.start)} -> ${formatDateTime(appointment.end)}`;
    const outlookLabel = appointment.outlookReference || statusLabel(appointment.outlookStatus);
    return `
      <article class="appointmentCard">
        <div class="appointmentTop">
          <div>
            <p class="subLabel">Rendez-vous</p>
            <h4>${escapeHtml(timeRange)}</h4>
          </div>
          ${renderStatusBadge(appointment.status || "pending")}
        </div>
        <div class="summaryPairs">
          <span class="tag">${escapeHtml(formatters.formatMinutes(appointment.totalDurationMinutes || 0))}</span>
          <span class="tag">${escapeHtml((appointment.slotIds || []).join(", "))}</span>
        </div>
        <div class="metaList">
          <div>Email bureau : ${escapeHtml(statusLabel(appointment.officeEmailStatus))}</div>
          <div>Mission Outlook : ${escapeHtml(outlookLabel || "-")}</div>
        </div>
        <div class="actionRow">
          <button class="secondaryBtn" type="button" data-appointment-status="${appointment.id}:scheduled">Planifie</button>
          <button class="secondaryBtn" type="button" data-appointment-status="${appointment.id}:completed">Termine</button>
          <button class="secondaryBtn danger" type="button" data-appointment-status="${appointment.id}:cancelled">Annule</button>
        </div>
      </article>
    `;
  }

  function renderOutboxCard(outbox) {
    return `
      <article class="outboxCard">
        <div class="outboxTitle">
          <div>
            <p class="subLabel">Email bureau</p>
            <h4>${escapeHtml(outbox.subject || "Notification")}</h4>
          </div>
          ${renderStatusBadge(outbox.status || "pending")}
        </div>
        <div class="metaList">
          <div>Type : ${escapeHtml(outbox.type || "-")}</div>
          <div>Tentatives : ${escapeHtml(String(outbox.attempts || 0))}</div>
          <div>Derniere tentative : ${escapeHtml(formatDateTime(outbox.lastAttemptAt))}</div>
          <div>Envoye le : ${escapeHtml(formatDateTime(outbox.sentAt))}</div>
          ${outbox.error ? `<div>Echec : ${escapeHtml(outbox.error)}</div>` : ""}
        </div>
      </article>
    `;
  }

  async function loadSyncHealth(db) {
    const snap = await refs(db).syncHealth.doc("outlook").get();
    if (!snap.exists) {
      syncHealthBox.innerHTML = `<p class="muted">Aucune information disponible pour la sync Outlook.</p>`;
      return;
    }
    const data = snap.data() || {};
    syncHealthBox.innerHTML = `
      <p class="panelEyebrow">Supervision</p>
      <strong>Sync Outlook</strong>
      <div class="metaList">
        <div>Etat : ${escapeHtml(statusLabel(data.status || "-"))}</div>
        <div>Derniere mise a jour : ${escapeHtml(formatDateTime(data.updatedAt))}</div>
        ${data.reason ? `<div>Info : ${escapeHtml(data.reason)}</div>` : ""}
      </div>
    `;
  }

  async function loadStats(db) {
    const collections = refs(db);
    const [usersSnap, requestsSnap, holdsSnap, outboxSnap] = await Promise.all([
      collections.users.limit(200).get(),
      collections.requests.where("status", "==", "pending").limit(200).get(),
      collections.holds.limit(200).get(),
      collections.outbox.where("status", "==", "pending").limit(200).get(),
    ]);

    statUsers.textContent = String(usersSnap.size);
    statRequestsPending.textContent = String(requestsSnap.size);
    statOutboxPending.textContent = String(outboxSnap.size);

    let activeHolds = 0;
    const now = Date.now();
    holdsSnap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.expiresAt?.toMillis?.() > now) activeHolds += 1;
    });
    statHoldsActive.textContent = String(activeHolds);
  }

  async function loadRequests(db) {
    const snap = await refs(db).requests.orderBy("createdAt", "desc").limit(60).get();
    requestsCache = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

    const filter = statusFilter.value;
    const term = String(search.value || "").trim().toLowerCase();
    const filtered = requestsCache.filter((request) => {
      const haystack = [
        request.requestNumber,
        request.customerSnapshot?.company,
        request.customerSnapshot?.email,
        request.customerSnapshot?.contactName,
      ].filter(Boolean).join(" ").toLowerCase();
      return (filter === "all" || request.status === filter) && (!term || haystack.includes(term));
    });

    requestEmpty.hidden = filtered.length > 0;
    requestList.innerHTML = filtered.map(renderRequestItem).join("");
    if (!selectedRequestId && filtered.length > 0) selectedRequestId = filtered[0].id;
    if (selectedRequestId && !filtered.some((request) => request.id === selectedRequestId)) {
      selectedRequestId = filtered[0]?.id || null;
    }
  }

  async function loadHolds(db) {
    const snap = await refs(db).holds.orderBy("expiresAt", "desc").limit(20).get();
    const now = Date.now();
    const items = snap.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter((item) => item.expiresAt?.toMillis?.() > now);

    holdEmpty.hidden = items.length > 0;
    holdList.innerHTML = items.map(renderHoldItem).join("");
  }

  async function loadRequestDetail(db, requestId) {
    if (!requestId) {
      detailEmpty.hidden = false;
      detailContent.hidden = true;
      return;
    }

    const collections = refs(db);
    const requestSnap = await collections.requests.doc(requestId).get();
    if (!requestSnap.exists) {
      detailEmpty.hidden = false;
      detailContent.hidden = true;
      return;
    }

    const request = { id: requestSnap.id, ...(requestSnap.data() || {}) };
    const [addressesSnap, servicesSnap, appointmentsSnap, outboxSnap] = await Promise.all([
      collections.requestAddresses.where("requestId", "==", requestId).get(),
      collections.requestServices.where("requestId", "==", requestId).get(),
      collections.appointments.where("requestId", "==", requestId).get(),
      collections.outbox.where("requestId", "==", requestId).get(),
    ]);

    const addresses = addressesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const services = servicesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const appointments = appointmentsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const outbox = outboxSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

    const servicesByAddress = new Map();
    addresses.forEach((address) => servicesByAddress.set(address.id, []));
    services.forEach((service) => {
      const items = servicesByAddress.get(service.requestAddressId) || [];
      items.push(service);
      servicesByAddress.set(service.requestAddressId, items);
    });

    detailEmpty.hidden = true;
    detailContent.hidden = false;
    detailRequestTitle.textContent = request.requestNumber || compactRequestId(request.id);
    detailRequestMeta.textContent = [
      request.customerSnapshot?.company || request.customerSnapshot?.contactName || "Client",
      request.customerSnapshot?.contactName || "",
      request.customerSnapshot?.email || "",
      `${request.totalAddresses || 0} adresse(s)`,
      `${request.totalAppointments || 0} rendez-vous`,
    ].filter(Boolean).join(" • ");

    detailActions.innerHTML = `
      <button class="secondaryBtn" type="button" data-request-status="${request.id}:scheduled">Marquer planifie</button>
      <button class="secondaryBtn" type="button" data-request-status="${request.id}:completed">Marquer termine</button>
      <button class="secondaryBtn danger" type="button" data-request-status="${request.id}:cancelled">Annuler</button>
    `;

    detailCustomer.innerHTML = renderCustomerCards(request.customerSnapshot || {});
    detailAddresses.innerHTML = addresses.map((address) => renderAddressCard(address, servicesByAddress)).join("") || `<p class="muted">Aucune adresse.</p>`;
    detailAppointments.innerHTML = appointments.map(renderAppointmentCard).join("") || `<p class="muted">Aucun rendez-vous.</p>`;
    detailOutbox.innerHTML = outbox.map(renderOutboxCard).join("") || `<p class="muted">Aucun email de bureau pour cette demande.</p>`;
  }

  async function refreshAll(db) {
    await Promise.all([loadSyncHealth(db), loadStats(db), loadRequests(db), loadHolds(db)]);
    await loadRequestDetail(db, selectedRequestId);
  }

  async function updateRequestStatus(db, requestId, status) {
    await refs(db).requests.doc(requestId).set({
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  async function updateAppointmentsForRequest(db, requestId, status) {
    const snap = await refs(db).appointments.where("requestId", "==", requestId).get();
    const batch = db.batch();
    snap.forEach((doc) => {
      batch.set(doc.ref, {
        status,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }

  async function updateAppointmentStatus(db, appointmentId, status) {
    await refs(db).appointments.doc(appointmentId).set({
      status,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  function wireDelegation(db) {
    requestList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-request-id]");
      if (!button) return;
      selectedRequestId = button.getAttribute("data-request-id");
      await loadRequests(db);
      await loadRequestDetail(db, selectedRequestId);
    });

    detailActions.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-request-status]");
      if (!button) return;
      const [requestId, status] = button.getAttribute("data-request-status").split(":");
      button.disabled = true;
      try {
        await updateRequestStatus(db, requestId, status);
        await updateAppointmentsForRequest(db, requestId, status);
        await refreshAll(db);
      } catch (error) {
        console.error(error);
        alert(error?.message || String(error));
      } finally {
        button.disabled = false;
      }
    });

    detailAppointments.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-appointment-status]");
      if (!button) return;
      const [appointmentId, status] = button.getAttribute("data-appointment-status").split(":");
      button.disabled = true;
      try {
        await updateAppointmentStatus(db, appointmentId, status);
        await refreshAll(db);
      } catch (error) {
        console.error(error);
        alert(error?.message || String(error));
      } finally {
        button.disabled = false;
      }
    });
  }

  async function boot() {
    const { auth, db } = getServices();

    setStatus("idle", "Initialisation...");
    showAdmin(false);
    showOverlay(false);

    btnOpenLogin.addEventListener("click", () => {
      loginErr.hidden = true;
      loginErr.textContent = "";
      showOverlay(true);
    });

    btnCloseLogin.addEventListener("click", () => showOverlay(false));

    btnDoLogin.addEventListener("click", async () => {
      loginErr.hidden = true;
      loginErr.textContent = "";
      try {
        await auth.signInWithEmailAndPassword(loginEmail.value.trim(), loginPass.value);
        showOverlay(false);
      } catch (error) {
        console.error(error);
        loginErr.hidden = false;
        loginErr.textContent = error?.message || String(error);
      }
    });

    btnLogout.addEventListener("click", async () => {
      await auth.signOut();
    });

    btnRefresh.addEventListener("click", async () => {
      await refreshAll(db);
    });

    statusFilter.addEventListener("change", async () => {
      await loadRequests(db);
      await loadRequestDetail(db, selectedRequestId);
    });

    search.addEventListener("input", async () => {
      await loadRequests(db);
      await loadRequestDetail(db, selectedRequestId);
    });

    wireDelegation(db);

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        setStatus("warn", "Non connecte");
        showAdmin(false);
        selectedRequestId = null;
        return;
      }

      setStatus("ok", `Connecte : ${user.email || user.uid}`);
      const isAdmin = await requireAdmin(auth);
      if (!isAdmin) {
        setStatus("err", "Acces refuse");
        showAdmin(false);
        loginErr.hidden = false;
        loginErr.textContent = "Ce compte n'a pas le claim admin.";
        showOverlay(true);
        return;
      }

      loginErr.hidden = true;
      showAdmin(true);
      await refreshAll(db);
    });
  }

  boot().catch((error) => {
    console.error(error);
    setStatus("err", "Erreur init");
    loginErr.hidden = false;
    loginErr.textContent = error?.message || String(error);
  });
})();
