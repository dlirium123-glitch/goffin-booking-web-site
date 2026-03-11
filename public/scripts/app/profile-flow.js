(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function renderProfileSection(profile) {
    const data = profile || {};
    return `
      <div class="sectionHead">
        <div>
          <p class="eyebrow">Etape 1</p>
          <h3>Profil client</h3>
        </div>
        <span class="sectionBadge">Requis</span>
      </div>

      <div class="formGrid twoCols">
        <label class="field">
          <span>Contact</span>
          <input id="profileContactName" type="text" value="${escapeAttr(data.contactName || "")}" placeholder="Nom et prenom" />
        </label>
        <label class="field">
          <span>E-mail</span>
          <input id="profileEmail" type="email" value="${escapeAttr(data.email || "")}" placeholder="pro@entreprise.be" />
        </label>
        <label class="field">
          <span>Societe</span>
          <input id="profileCompany" type="text" value="${escapeAttr(data.company || "")}" placeholder="Nom societe" />
        </label>
        <label class="field">
          <span>TVA</span>
          <input id="profileVat" type="text" value="${escapeAttr(data.vat || "")}" placeholder="BE0xxx.xxx.xxx" />
        </label>
        <label class="field">
          <span>Telephone</span>
          <input id="profilePhone" type="text" value="${escapeAttr(data.phone || "")}" placeholder="+32 ..." />
        </label>
        <label class="field wide">
          <span>Adresse de facturation</span>
          <input id="profileBillingAddress" type="text" value="${escapeAttr(data.billingAddress || data.hqAddress || "")}" placeholder="Rue, numero, CP, Ville" />
        </label>
      </div>

      <div class="inlineActions">
        <button id="btnSaveProfile" class="btn primary" type="button">Enregistrer le profil</button>
      </div>
      <p id="profileMsg" class="tiny muted"></p>
    `;
  }

  function escapeAttr(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  root.profileFlow = {
    renderProfileSection,
  };
})();
