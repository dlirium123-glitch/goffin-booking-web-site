/* public/index.v3.js */
/* eslint-disable no-console */
(() => {
  "use strict";

  const {
    escapeHtml,
    getServices,
    computeWeekRange,
    startOfDay,
    addDays,
    isWeekend,
    firestoreRefs,
    serviceCatalog,
    durationEngine,
    validation,
    formatters,
    appShell,
    profileFlow,
    serviceForm,
    addressForm,
    requestBuilder,
    historyView,
    slotPicker,
    holdService,
    confirmationService,
  } = window.GoffinBooking || {};

  const APP_VERSION = "v3-2026-03-10-sprint7";
  const BOOKING_MIN_DELAY_MS = 48 * 3600 * 1000;
  const SLOT_MINUTES = 90;

  const $ = (id) => document.getElementById(id);
  const pillStatus = $("pillStatus");
  const statusText = $("statusText");
  const btnLogout = $("btnLogout");
  const clientVersion = $("clientVersion");
  const rightPanel = $("rightPanel");

  if (clientVersion) clientVersion.textContent = APP_VERSION;

  function setStatus(kind, text) {
    if (!pillStatus || !statusText) return;
    pillStatus.classList.remove("ok", "warn", "err");
    if (kind === "ok") pillStatus.classList.add("ok");
    if (kind === "warn") pillStatus.classList.add("warn");
    if (kind === "err") pillStatus.classList.add("err");
    statusText.textContent = text;
  }

  function render(html) {
    if (!rightPanel) return;
    rightPanel.innerHTML = html;
  }

  function refs(db) {
    return firestoreRefs.createRefs(db);
  }

  async function getAdminClaim(auth) {
    const user = auth.currentUser;
    if (!user) return false;
    const token = await user.getIdTokenResult(true);
    return token?.claims?.admin === true;
  }

  function safeProfilePayload(payload) {
    return {
      email: String(payload.email || ""),
      company: String(payload.company || ""),
      vat: String(payload.vat || ""),
      phone: String(payload.phone || ""),
      hqAddress: String(payload.hqAddress || payload.billingAddress || ""),
      billingAddress: String(payload.billingAddress || payload.hqAddress || ""),
      contactName: String(payload.contactName || ""),
    };
  }

  async function loadUserProfile(db, user) {
    const snap = await refs(db).users.doc(user.uid).get();
    if (!snap.exists) return safeProfilePayload({ email: user.email || "" });
    return safeProfilePayload({ email: user.email || "", ...(snap.data() || {}) });
  }

  async function saveUserProfile(db, uid, payload) {
    const safe = safeProfilePayload(payload);
    const userRef = refs(db).users.doc(uid);
    const existingSnap = await userRef.get();
    safe.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    safe.createdAt = existingSnap.exists
      ? (existingSnap.data()?.createdAt || firebase.firestore.FieldValue.serverTimestamp())
      : firebase.firestore.FieldValue.serverTimestamp();
    await userRef.set(safe, { merge: false });
  }

  async function loadPublicSlotsForWeek(db, weekStart, weekEnd) {
    const snap = await refs(db).publicSlots
      .where("start", ">=", firebase.firestore.Timestamp.fromDate(weekStart))
      .where("start", "<", firebase.firestore.Timestamp.fromDate(weekEnd))
      .get();

    const slots = [];
    snap.forEach((doc) => slots.push({ id: doc.id, ...(doc.data() || {}) }));
    slots.sort((a, b) => (a.start?.toMillis?.() || 0) - (b.start?.toMillis?.() || 0));
    return slots;
  }

  async function loadHoldSlotsForWeek(db, weekStart, weekEnd) {
    const snap = await refs(db).holdSlots
      .where("start", ">=", firebase.firestore.Timestamp.fromDate(weekStart))
      .where("start", "<", firebase.firestore.Timestamp.fromDate(weekEnd))
      .get();

    const holdSlots = new Map();
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (data.expiresAt?.toMillis?.() > Date.now()) {
        holdSlots.set(doc.id, { id: doc.id, ...data });
      }
    });
    return holdSlots;
  }

  async function loadBookingsForWeek(db, weekStart, weekEnd) {
    const snap = await refs(db).bookings
      .where("start", ">=", firebase.firestore.Timestamp.fromDate(weekStart))
      .where("start", "<", firebase.firestore.Timestamp.fromDate(weekEnd))
      .get();

    const bookings = new Map();
    snap.forEach((doc) => bookings.set(doc.id, { id: doc.id, ...(doc.data() || {}) }));
    return bookings;
  }

  function uiAuth() {
    render(`
      <h2>Etape 1/4 - Connexion</h2>
      <p class="muted">Reserve aux professionnels (GN). Utilise ton e-mail + mot de passe.</p>

      <div class="grid2">
        <div class="cardInner">
          <h3>Se connecter</h3>
          <label>E-mail</label>
          <input id="loginEmail" type="email" placeholder="ex: pro@entreprise.be" />
          <label>Mot de passe</label>
          <input id="loginPass" type="password" placeholder="********" />
          <button id="btnLogin" class="btn primary">Me connecter</button>
          <p id="loginErr" class="err"></p>
        </div>

        <div class="cardInner">
          <h3>Creer un compte</h3>
          <label>E-mail</label>
          <input id="regEmail" type="email" placeholder="ex: pro@entreprise.be" />
          <label>Mot de passe</label>
          <input id="regPass" type="password" placeholder="min 6 caracteres" />
          <hr />
          <h4>Profil entreprise</h4>
          <label>Contact</label>
          <input id="regContact" type="text" placeholder="Nom et prenom" />
          <label>Societe</label>
          <input id="regCompany" type="text" placeholder="Nom societe" />
          <label>TVA</label>
          <input id="regVat" type="text" placeholder="BE0xxx.xxx.xxx" />
          <label>Telephone</label>
          <input id="regPhone" type="text" placeholder="+32 ..." />
          <label>Adresse siege</label>
          <input id="regAddr" type="text" placeholder="Rue, no, CP, Ville" />
          <button id="btnRegister" class="btn">Creer le compte</button>
          <p id="regErr" class="err"></p>
        </div>
      </div>
    `);
  }

  function mountAdminShortcut(isAdmin) {
    const mount = $("adminShortcutMount");
    if (!mount) return;
    mount.innerHTML = `
      <div class="miniPanel">
        <strong>Compte ${isAdmin ? "admin" : "client"}</strong>
        <p class="tiny muted">Les holds V2 bloquent maintenant les slots selectionnes avant confirmation.</p>
        <button class="btn chip" ${isAdmin ? "" : "disabled"} id="btnGoAdmin">Aller sur /admin</button>
      </div>
    `;
    const button = $("btnGoAdmin");
    if (button && isAdmin) button.addEventListener("click", () => (window.location.href = "/admin"));
  }

  function buildSummaryHtml(draft) {
    const addressCount = draft.addresses.length;
    const serviceCount = draft.addresses.reduce((sum, address) => sum + (address.services || []).length, 0);
    const heldCount = draft.addresses.filter((address) => address.holdId).length;
    const plannedCount = draft.addresses.filter((address) => address.selectedSequence).length;
    return `
      <div class="summaryPills">
        <span class="metricTag strong">${addressCount} adresse(s)</span>
        <span class="metricTag">${serviceCount} technique(s)</span>
        <span class="metricTag">${plannedCount} selectionnee(s)</span>
        <span class="metricTag">${heldCount} hold(s)</span>
      </div>
    `;
  }

  function buildPlannerHtml(draft) {
    const activeAddress = draft.addresses[draft.activeAddressIndex] || null;
    const nextValidation = activeAddress ? validation.validateAddress(activeAddress, serviceCatalog) : { valid: false, errors: ["address_missing"] };

    return `
      <div class="sectionHead">
        <div>
          <p class="eyebrow">Etape 3</p>
          <h3>Planification et hold</h3>
        </div>
        <span class="sectionBadge">${activeAddress ? formatters.formatMinutes(activeAddress.totalDurationMinutes || 30) : "Aucune adresse"}</span>
      </div>

      <div class="plannerToolbar">
        <button id="btnPrevWeek" class="btn chip" type="button">Semaine -1</button>
        <div class="plannerWeekTitle" id="weekTitle"></div>
        <button id="btnNextWeek" class="btn chip" type="button">Semaine +1</button>
      </div>

      <div class="plannerMeta">
        <div class="miniPanel">
          <strong>Adresse active</strong>
          <p class="tiny muted">${activeAddress ? escapeHtml(formatters.formatAddressSummary(activeAddress, serviceCatalog)) : "Ajoute une adresse."}</p>
        </div>
        <div class="miniPanel">
          <strong>Regles</strong>
          <p class="tiny muted">48h minimum, jours ouvres, blocs continus adjacents. La selection cree un hold multi-slot.</p>
        </div>
      </div>

      ${nextValidation.valid ? "" : `<div class="miniWarn">Complete d'abord cette adresse: ${nextValidation.errors.map((error) => `<span>${escapeHtml(error)}</span>`).join("")}</div>`}
      <div id="calendar" class="calendar plannerCalendar"></div>
      <div id="selectionBox" class="miniPanel plannerSelection">${renderSelectedSequence(activeAddress)}</div>
    `;
  }

  function renderSelectedSequence(address) {
    if (!address?.selectedSequence) return `<p class="muted">Aucun creneau selectionne pour cette adresse.</p>`;
    return `
      <strong>Creneau retenu</strong>
      <p class="tiny muted">${escapeHtml(address.selectedSequence.label)}</p>
      <p class="tiny muted">${escapeHtml(address.selectedSequence.slotIds.join(", "))}</p>
      <p class="tiny muted">${address.holdId ? `Hold actif: ${escapeHtml(address.holdId)}` : "Hold en attente"}</p>
    `;
  }

  function buildReviewHtml(draft) {
    const cards = draft.addresses.map((address, index) => {
      const services = (address.services || [])
        .map((service) => {
          const serviceType = serviceCatalog.getServiceTypeById(service.serviceTypeId);
          return `<li>${escapeHtml(serviceType?.label || service.serviceTypeId || "Technique")} x ${escapeHtml(String(service.installationsCount || 0))}</li>`;
        })
        .join("");

      return `
        <article class="reviewCard">
          <h4>Adresse ${index + 1}</h4>
          <p class="tiny muted">${escapeHtml(formatters.formatAddressSummary(address, serviceCatalog))}</p>
          <ul class="reviewList">${services}</ul>
          <p class="tiny muted">Total: ${escapeHtml(formatters.formatMinutes(address.totalDurationMinutes || 30))}</p>
          <p class="tiny muted">${address.selectedSequence ? escapeHtml(address.selectedSequence.label) : "Aucun creneau choisi"}</p>
          <p class="tiny muted">${address.holdId ? `Hold: ${escapeHtml(address.holdId)}` : "Aucun hold actif"}</p>
        </article>
      `;
    }).join("");

    const ready = draft.addresses.length > 0 && draft.addresses.every((address) => {
      return validation.validateAddress(address, serviceCatalog).valid && address.selectedSequence && address.holdId;
    });

    return `
      <div class="sectionHead">
        <div>
          <p class="eyebrow">Etape 4</p>
          <h3>Confirmation V2</h3>
        </div>
        <span class="sectionBadge">${ready ? "Pret" : "Incomplet"}</span>
      </div>
      <p class="muted">Cette confirmation cree maintenant la demande V2, les rendez-vous, les locks techniques et le message d'outbox.</p>
      <div class="reviewGrid">${cards}</div>
      <div class="inlineActions">
        <button id="btnConfirmRequest" class="btn primary" type="button" ${ready ? "" : "disabled"}>Confirmer la demande</button>
      </div>
      <p id="confirmMsg" class="tiny muted">${ready ? "Tous les holds sont actifs. La confirmation ecrira les documents V2." : "Chaque adresse doit avoir un creneau choisi et un hold actif."}</p>
    `;
  }

  function renderWizard(draft) {
    appShell.renderWizardShell({
      mount: rightPanel,
      summaryHtml: buildSummaryHtml(draft),
      profileHtml: profileFlow.renderProfileSection(draft.profile),
      builderHtml: addressForm.renderAddressBuilder({
        draft,
        catalog: serviceCatalog,
        validation,
        formatters,
        serviceForm,
      }),
      plannerHtml: buildPlannerHtml(draft),
      reviewHtml: buildReviewHtml(draft),
      historyHtml: historyView.renderHistoryPlaceholder(),
    });
  }

  function mergeAvailability(slots, holdSlots, bookings, currentHoldId, releasedHoldIds) {
    return slots.map((slot) => {
      const holdSlot = holdSlots.get(slot.id);
      const booking = bookings.get(slot.id);
      if (booking) return { ...slot, status: "busy" };
      if (holdSlot && releasedHoldIds?.has?.(holdSlot.holdId)) return { ...slot, status: "free" };
      if (holdSlot && holdSlot.holdId !== currentHoldId) return { ...slot, status: "busy" };
      return slot;
    });
  }

  async function bootWizard({ auth, db, user, isAdmin }) {
    const initialProfile = await loadUserProfile(db, user);
    let draft = requestBuilder.recalculateDraft(requestBuilder.createDraftState(initialProfile), serviceCatalog, durationEngine);
    let weekAnchor = new Date();
    const releasedHoldIds = new Set();

    function updateProfileFromDom() {
      draft.profile = {
        contactName: $("profileContactName")?.value.trim() || "",
        email: $("profileEmail")?.value.trim() || "",
        company: $("profileCompany")?.value.trim() || "",
        vat: $("profileVat")?.value.trim() || "",
        phone: $("profilePhone")?.value.trim() || "",
        billingAddress: $("profileBillingAddress")?.value.trim() || "",
      };
    }

    async function persistProfile() {
      updateProfileFromDom();
      await saveUserProfile(db, user.uid, { ...draft.profile, hqAddress: draft.profile.billingAddress });
    }

    function attachProfileEvents() {
      const button = $("btnSaveProfile");
      if (!button) return;
      button.addEventListener("click", async () => {
        const msg = $("profileMsg");
        if (msg) msg.textContent = "Enregistrement...";
        try {
          await persistProfile();
          if (msg) msg.textContent = "Profil enregistre.";
        } catch (error) {
          console.error(error);
          if (msg) msg.textContent = error?.message || String(error);
        }
      });
    }

    function reindexActiveAddress() {
      draft.activeAddressIndex = Math.max(0, Math.min(draft.activeAddressIndex, draft.addresses.length - 1));
    }

    async function detachAddressHold(address) {
      if (!address?.holdId) return;
      const releasedHoldId = address.holdId;
      try {
        await holdService.releaseHold({ db, refs, address });
        releasedHoldIds.add(releasedHoldId);
      } catch (error) {
        console.warn("Hold release failed:", error);
      }
      address.holdId = null;
      address.holdSlotIds = [];
    }

    function attachBuilderEvents() {
      const addressKeysThatInvalidatePlanning = new Set(["addressLine1", "postalCode", "city", "region", "country"]);

      async function commitAddressField(addressIndex, key) {
        const address = draft.addresses[addressIndex];
        if (!address) return;
        if (addressKeysThatInvalidatePlanning.has(key)) {
          await detachAddressHold(address);
          address.selectedSequence = null;
        }
        draft = requestBuilder.recalculateDraft(draft, serviceCatalog, durationEngine);
        await rerender();
      }

      async function commitServiceChange(addressIndex, serviceIndex, mutate) {
        const address = draft.addresses[addressIndex];
        if (!address) return;
        await detachAddressHold(address);
        mutate(address.services[serviceIndex], address);
        address.selectedSequence = null;
        draft = requestBuilder.recalculateDraft(draft, serviceCatalog, durationEngine);
        await rerender();
      }

      const addAddressButton = $("btnAddAddress");
      if (addAddressButton) {
        addAddressButton.addEventListener("click", () => {
          draft.addresses.push(requestBuilder.createEmptyAddress());
          draft.activeAddressIndex = draft.addresses.length - 1;
          rerender();
        });
      }

      document.querySelectorAll("[data-remove-address]").forEach((button) => {
        button.addEventListener("click", async () => {
          const index = Number(button.getAttribute("data-remove-address"));
          const address = draft.addresses[index];
          await detachAddressHold(address);
          draft.addresses.splice(index, 1);
          if (draft.addresses.length === 0) draft.addresses.push(requestBuilder.createEmptyAddress());
          reindexActiveAddress();
          rerender();
        });
      });

      document.querySelectorAll("[data-select-address]").forEach((button) => {
        button.addEventListener("click", async () => {
          draft.activeAddressIndex = Number(button.getAttribute("data-select-address"));
          await rerenderCalendarOnly();
        });
      });

      document.querySelectorAll("[data-address-field]").forEach((input) => {
        input.addEventListener("input", () => {
          const [addressIndex, key] = input.getAttribute("data-address-field").split(":");
          const address = draft.addresses[Number(addressIndex)];
          address[key] = input.value.trim();
        });
        input.addEventListener("change", async () => {
          const [addressIndex, key] = input.getAttribute("data-address-field").split(":");
          await commitAddressField(Number(addressIndex), key);
        });
      });

      document.querySelectorAll("[data-add-service]").forEach((button) => {
        button.addEventListener("click", async () => {
          const addressIndex = Number(button.getAttribute("data-add-service"));
          await detachAddressHold(draft.addresses[addressIndex]);
          draft.addresses[addressIndex].services.push(requestBuilder.createEmptyService());
          draft.addresses[addressIndex].selectedSequence = null;
          draft = requestBuilder.recalculateDraft(draft, serviceCatalog, durationEngine);
          rerender();
        });
      });

      document.querySelectorAll("[data-remove-service]").forEach((button) => {
        button.addEventListener("click", async () => {
          const [addressIndex, serviceIndex] = button.getAttribute("data-remove-service").split(":").map(Number);
          const address = draft.addresses[addressIndex];
          await detachAddressHold(address);
          address.services.splice(serviceIndex, 1);
          if (address.services.length === 0) address.services.push(requestBuilder.createEmptyService());
          address.selectedSequence = null;
          draft = requestBuilder.recalculateDraft(draft, serviceCatalog, durationEngine);
          rerender();
        });
      });

      document.querySelectorAll("[data-service-type]").forEach((select) => {
        select.addEventListener("change", async () => {
          const [addressIndex, serviceIndex] = select.getAttribute("data-service-type").split(":").map(Number);
          await commitServiceChange(addressIndex, serviceIndex, (service) => {
            service.serviceTypeId = select.value;
            service.answers = {};
          });
        });
      });

      document.querySelectorAll("[data-service-count]").forEach((input) => {
        input.addEventListener("input", () => {
          const [addressIndex, serviceIndex] = input.getAttribute("data-service-count").split(":").map(Number);
          const address = draft.addresses[addressIndex];
          if (!address?.services?.[serviceIndex]) return;
          address.services[serviceIndex].installationsCount = Number(input.value || 1);
        });
        input.addEventListener("change", async () => {
          const [addressIndex, serviceIndex] = input.getAttribute("data-service-count").split(":").map(Number);
          await commitServiceChange(addressIndex, serviceIndex, (service) => {
            service.installationsCount = Number(input.value || 1);
          });
        });
      });

      document.querySelectorAll("[data-service-answer]").forEach((field) => {
        field.addEventListener("input", () => {
          const [addressIndex, serviceIndex, fieldKey] = field.getAttribute("data-service-answer").split(":");
          const address = draft.addresses[Number(addressIndex)];
          if (!address?.services?.[Number(serviceIndex)]) return;
          const service = address.services[Number(serviceIndex)];
          service.answers = service.answers || {};
          service.answers[fieldKey] = field.value;
        });
        field.addEventListener("change", async () => {
          const [addressIndex, serviceIndex] = field.getAttribute("data-service-answer").split(":");
          await commitServiceChange(Number(addressIndex), Number(serviceIndex), () => {});
        });
      });
    }

    async function renderPlannerCalendar() {
      const address = draft.addresses[draft.activeAddressIndex];
      const calendar = $("calendar");
      const weekTitle = $("weekTitle");
      const selectionBox = $("selectionBox");
      if (!calendar || !weekTitle || !selectionBox) return;

      const { start, end } = computeWeekRange(weekAnchor);
      weekTitle.textContent = `${start.toLocaleDateString()} -> ${addDays(end, -1).toLocaleDateString()}`;

      const addressValidation = validation.validateAddress(address, serviceCatalog);
      if (!addressValidation.valid) {
        calendar.innerHTML = `<p class="muted">Complete d'abord cette adresse avant de planifier.</p>`;
        selectionBox.innerHTML = renderSelectedSequence(address);
        return;
      }

      calendar.innerHTML = `<p class="muted">Chargement des creneaux...</p>`;

      try {
        const [slots, holdSlots, bookings] = await Promise.all([
          loadPublicSlotsForWeek(db, start, end),
          loadHoldSlotsForWeek(db, start, end),
          loadBookingsForWeek(db, start, end),
        ]);

        const availabilitySlots = mergeAvailability(slots, holdSlots, bookings, address.holdId, releasedHoldIds);
        slotPicker.renderWeekCalendar({
          mount: calendar,
          slots: availabilitySlots,
          requiredMinutes: address.totalDurationMinutes || durationEngine.DEFAULT_TRAVEL_MINUTES,
          minStartMs: Date.now() + BOOKING_MIN_DELAY_MS,
          startOfDay,
          isWeekend,
          onSelect: async (sequence) => {
            try {
              const holdResult = await holdService.createOrReplaceHold({
                db,
                auth,
                refs,
                address,
                sequence,
              });

              releasedHoldIds.delete(holdResult.holdId);
              address.holdId = holdResult.holdId;
              address.holdSlotIds = holdResult.holdSlotIds.slice();
              address.selectedSequence = {
                slotIds: sequence.slotIds.slice(),
                startDate: sequence.startDate,
                endDate: sequence.endDate,
                slots: sequence.slots.slice(),
                label: `${sequence.startDate.toLocaleString()} -> ${sequence.endDate.toLocaleTimeString()}`,
              };
              await rerender();
            } catch (error) {
              console.error(error);
              selectionBox.innerHTML = `<p class="err">${escapeHtml(error?.message || String(error))}</p>`;
            }
          },
        });

        selectionBox.innerHTML = renderSelectedSequence(address);
      } catch (error) {
        console.error(error);
        calendar.innerHTML = `<p class="err">Erreur calendrier: ${escapeHtml(error?.message || String(error))}</p>`;
      }
    }

    function attachPlannerEvents() {
      const prev = $("btnPrevWeek");
      const next = $("btnNextWeek");
      const confirm = $("btnConfirmRequest");

      if (prev) {
        prev.addEventListener("click", async () => {
          weekAnchor = addDays(weekAnchor, -7);
          await rerenderCalendarOnly();
        });
      }

      if (next) {
        next.addEventListener("click", async () => {
          weekAnchor = addDays(weekAnchor, 7);
          await rerenderCalendarOnly();
        });
      }

      if (confirm) {
        confirm.addEventListener("click", async () => {
          const msg = $("confirmMsg");
          if (msg) msg.textContent = "Confirmation en cours...";

          try {
            await persistProfile();
            const result = await confirmationService.confirmDraft({
              db,
              auth,
              refs,
              draft,
              serviceCatalog,
              slotMinutes: SLOT_MINUTES,
            });

            draft.addresses.forEach((address) => {
              address.holdId = null;
              address.holdSlotIds = [];
            });

            if (msg) msg.textContent = `Demande ${result.requestId} creee.`;
            await rerender();
          } catch (error) {
            console.error(error);
            if (msg) msg.textContent = error?.message || String(error);
          }
        });
      }
    }

    async function rerenderCalendarOnly() {
      renderWizard(draft);
      mountAdminShortcut(isAdmin);
      attachProfileEvents();
      attachBuilderEvents();
      attachPlannerEvents();
      await renderPlannerCalendar();
    }

    async function rerender() {
      draft = requestBuilder.recalculateDraft(draft, serviceCatalog, durationEngine);
      renderWizard(draft);
      mountAdminShortcut(isAdmin);
      attachProfileEvents();
      attachBuilderEvents();
      attachPlannerEvents();
      await renderPlannerCalendar();
    }

    await rerender();
  }

  function wireAuthForms(db, auth) {
    const loginButton = $("btnLogin");
    if (loginButton) {
      loginButton.addEventListener("click", async () => {
        const loginErr = $("loginErr");
        if (loginErr) loginErr.textContent = "";
        try {
          await auth.signInWithEmailAndPassword($("loginEmail").value.trim(), $("loginPass").value);
        } catch (error) {
          console.error(error);
          if (loginErr) loginErr.textContent = error?.message || String(error);
        }
      });
    }

    const registerButton = $("btnRegister");
    if (registerButton) {
      registerButton.addEventListener("click", async () => {
        const regErr = $("regErr");
        if (regErr) regErr.textContent = "";
        const payload = {
          email: $("regEmail").value.trim(),
          pass: $("regPass").value,
          contactName: $("regContact").value.trim(),
          company: $("regCompany").value.trim(),
          vat: $("regVat").value.trim(),
          phone: $("regPhone").value.trim(),
          billingAddress: $("regAddr").value.trim(),
          hqAddress: $("regAddr").value.trim(),
        };

        try {
          const cred = await auth.createUserWithEmailAndPassword(payload.email, payload.pass);
          await saveUserProfile(db, cred.user.uid, payload);
        } catch (error) {
          console.error(error);
          if (regErr) regErr.textContent = error?.message || String(error);
        }
      });
    }
  }

  async function boot() {
    const { auth, db } = getServices();

    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        await auth.signOut();
      });
    }

    uiAuth();
    setStatus("idle", "Initialisation...");

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        if (btnLogout) btnLogout.hidden = true;
        setStatus("warn", "Non connecte");
        uiAuth();
        wireAuthForms(db, auth);
        return;
      }

      if (btnLogout) btnLogout.hidden = false;
      setStatus("ok", `Connecte: ${user.email || user.uid}`);

      let isAdmin = false;
      try {
        isAdmin = await getAdminClaim(auth);
      } catch (error) {
        console.warn("Admin claim check failed:", error);
      }

      await bootWizard({ auth, db, user, isAdmin });
    });

    wireAuthForms(db, auth);
  }

  boot().catch((error) => {
    console.error(error);
    setStatus("err", "Erreur init");
    render(`<p class="err">${escapeHtml(error?.message || String(error))}</p>`);
  });
})();
