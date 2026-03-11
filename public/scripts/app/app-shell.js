(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function renderWizardShell({ mount, summaryHtml, profileHtml, builderHtml, plannerHtml, reviewHtml, historyHtml }) {
    if (!mount) return;
    mount.innerHTML = `
      <div class="wizardHero">
        <div>
          <p class="eyebrow">Booking V2</p>
          <h2>Nouvelle demande multi-adresses</h2>
          <p class="muted">Prepare tes adresses, techniques, durees et creneaux. La confirmation Firestore multi-adresses arrive au Sprint 4.</p>
        </div>
        <div class="wizardStats">${summaryHtml || ""}</div>
      </div>

      <div class="wizardLayout">
        <section class="wizardMain">
          <div class="wizardBlock">${profileHtml || ""}</div>
          <div class="wizardBlock">${builderHtml || ""}</div>
          <div class="wizardBlock">${plannerHtml || ""}</div>
          <div class="wizardBlock">${reviewHtml || ""}</div>
        </section>

        <aside class="wizardSide">
          <div class="wizardBlock">${historyHtml || ""}</div>
        </aside>
      </div>
    `;
  }

  root.appShell = {
    renderWizardShell,
  };
})();
