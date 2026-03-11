(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function renderAddressBuilder({ draft, catalog, validation, formatters, serviceForm }) {
    const addresses = Array.isArray(draft?.addresses) ? draft.addresses : [];
    const cards = addresses.map((address, index) => {
      const validationResult = validation.validateAddress(address, catalog);
      const warnings = validation.detectAddressWarnings(address, catalog);
      const serviceRows = (address.services || [])
        .map((service, serviceIndex) => serviceForm.renderServiceRow({ addressIndex: index, serviceIndex, service, catalog }))
        .join("");

      return `
        <article class="addressCard ${draft.activeAddressIndex === index ? "isActive" : ""}" data-address-card="${index}">
          <div class="sectionHead">
            <div>
              <p class="eyebrow">Adresse ${index + 1}</p>
              <h4>${escapeHtml(address.addressLine1 || "Nouvelle adresse")}</h4>
            </div>
            <div class="inlineActions compact">
              <button class="btn chip" type="button" data-select-address="${index}">Planifier</button>
              <button class="btn chip danger" type="button" data-remove-address="${index}">Supprimer</button>
            </div>
          </div>

          <div class="formGrid twoCols">
            <label class="field wide">
              <span>Adresse</span>
              <input data-address-field="${index}:addressLine1" type="text" value="${escapeAttr(address.addressLine1 || "")}" placeholder="Rue, numero" />
            </label>
            <label class="field">
              <span>Code postal</span>
              <input data-address-field="${index}:postalCode" type="text" value="${escapeAttr(address.postalCode || "")}" placeholder="1300" />
            </label>
            <label class="field">
              <span>Ville</span>
              <input data-address-field="${index}:city" type="text" value="${escapeAttr(address.city || "")}" placeholder="Ville" />
            </label>
            <label class="field">
              <span>Region</span>
              <select data-address-field="${index}:region">
                ${renderRegionOptions(address.region)}
              </select>
            </label>
            <label class="field">
              <span>Pays</span>
              <input data-address-field="${index}:country" type="text" value="${escapeAttr(address.country || "BE")}" placeholder="BE" />
            </label>
            <label class="field wide">
              <span>Reference interne</span>
              <input data-address-field="${index}:label" type="text" value="${escapeAttr(address.label || "")}" placeholder="Site, client, chantier..." />
            </label>
          </div>

          <div class="addressMeta">
            <span class="metricTag">${escapeHtml(formatters.formatMinutes(address.serviceMinutes || 0))} service</span>
            <span class="metricTag">${escapeHtml(formatters.formatMinutes(address.travelMinutes || 30))} trajet</span>
            <span class="metricTag strong">${escapeHtml(formatters.formatMinutes(address.totalDurationMinutes || 30))} total</span>
          </div>

          <div class="serviceStack">
            ${serviceRows || '<p class="muted">Ajoute une technique pour cette adresse.</p>'}
          </div>

          <div class="inlineActions compact">
            <button class="btn alt" type="button" data-add-service="${index}">Ajouter une technique</button>
          </div>

          ${renderValidation(validationResult, warnings)}
        </article>
      `;
    });

    return `
      <div class="sectionHead">
        <div>
          <p class="eyebrow">Etape 2</p>
          <h3>Adresses et techniques</h3>
        </div>
        <span class="sectionBadge">${addresses.length} adresse(s)</span>
      </div>

      <p class="muted">Une adresse peut contenir plusieurs techniques compatibles. Le trajet forfaitaire de 30 min est applique une seule fois par adresse.</p>

      <div class="inlineActions">
        <button id="btnAddAddress" class="btn primary" type="button">Ajouter une adresse</button>
      </div>

      <div class="addressStack">${cards.join("") || '<p class="muted">Ajoute une premiere adresse pour commencer.</p>'}</div>
    `;
  }

  function renderRegionOptions(current) {
    const value = String(current || "").toLowerCase();
    const options = [
      ["", "Choisir"],
      ["bruxelles", "Bruxelles"],
      ["wallonie", "Wallonie"],
      ["flandre", "Flandre"],
    ];
    return options
      .map(([optionValue, label]) => `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  function renderValidation(validationResult, warnings) {
    const errorHtml = validationResult.errors.length
      ? `<div class="miniAlert">${validationResult.errors.map((error) => `<span>${escapeHtml(error)}</span>`).join("")}</div>`
      : `<div class="miniOk">Adresse prete pour la planification.</div>`;

    const warningHtml = warnings.length
      ? `<div class="miniWarn">${warnings.map((warning) => `<span>${escapeHtml(warning)}</span>`).join("")}</div>`
      : "";

    return `${warningHtml}${errorHtml}`;
  }

  function escapeHtml(value) {
    return root.escapeHtml ? root.escapeHtml(value) : String(value || "");
  }

  function escapeAttr(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  root.addressForm = {
    renderAddressBuilder,
  };
})();
