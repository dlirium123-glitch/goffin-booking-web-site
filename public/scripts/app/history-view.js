(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function renderHistoryPlaceholder() {
    return `
      <div class="sectionHead">
        <div>
          <p class="eyebrow">Historique</p>
          <h3>Demandes client</h3>
        </div>
      </div>
      <p class="muted">Le nouvel historique detaille arrive avec la persistance V2. Pour l'instant, cette colonne sert de recap rapide du dossier en preparation.</p>
      <div class="miniPanel">
        <strong>Ce qui est deja pret</strong>
        <p class="tiny muted">Profil, adresses, techniques, durees et preselection des creneaux sont maintenant prepares cote client.</p>
      </div>
    `;
  }

  root.historyView = {
    renderHistoryPlaceholder,
  };
})();
