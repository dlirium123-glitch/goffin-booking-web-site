(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function renderServiceRow({ addressIndex, serviceIndex, service, catalog }) {
    const options = catalog.listActiveServiceTypes()
      .map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === service.serviceTypeId ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
      .join("");

    const serviceType = catalog.getServiceTypeById(service.serviceTypeId);
    const schemaHtml = renderSchemaFields({ addressIndex, serviceIndex, service, serviceType });

    return `
      <div class="serviceCard" data-service-card="${addressIndex}-${serviceIndex}">
        <div class="serviceTop">
          <strong>Technique ${serviceIndex + 1}</strong>
          <button class="btn chip danger" type="button" data-remove-service="${addressIndex}:${serviceIndex}">Supprimer</button>
        </div>

        <div class="formGrid twoCols">
          <label class="field">
            <span>Technique</span>
            <select data-service-type="${addressIndex}:${serviceIndex}">
              <option value="">Choisir</option>
              ${options}
            </select>
          </label>
          <label class="field">
            <span>Nombre d'installations</span>
            <input data-service-count="${addressIndex}:${serviceIndex}" type="number" min="1" step="1" value="${escapeAttr(service.installationsCount || 1)}" />
          </label>
        </div>

        ${schemaHtml}
      </div>
    `;
  }

  function renderSchemaFields({ addressIndex, serviceIndex, service, serviceType }) {
    if (!serviceType || !serviceType.formSchema) return "";
    const keys = Object.keys(serviceType.formSchema);
    if (keys.length === 0) return "";

    const fields = keys.map((fieldKey) => {
      const field = serviceType.formSchema[fieldKey];
      const value = service?.answers?.[fieldKey] ?? "";
      const dataAttr = `${addressIndex}:${serviceIndex}:${fieldKey}`;

      if (field.type === "select") {
        const options = (field.options || [])
          .map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
          .join("");
        return `
          <label class="field">
            <span>${escapeHtml(field.label)}</span>
            <select data-service-answer="${dataAttr}">
              <option value="">Choisir</option>
              ${options}
            </select>
          </label>
        `;
      }

      if (field.type === "boolean") {
        return `
          <label class="field toggleField">
            <span>${escapeHtml(field.label)}</span>
            <select data-service-answer="${dataAttr}">
              <option value="">Choisir</option>
              <option value="yes" ${value === "yes" ? "selected" : ""}>Oui</option>
              <option value="no" ${value === "no" ? "selected" : ""}>Non</option>
            </select>
          </label>
        `;
      }

      if (field.type === "textarea") {
        return `
          <label class="field wide">
            <span>${escapeHtml(field.label)}</span>
            <textarea data-service-answer="${dataAttr}" placeholder="${escapeAttr(field.label)}">${escapeHtml(value)}</textarea>
          </label>
        `;
      }

      return `
        <label class="field">
          <span>${escapeHtml(field.label)}</span>
          <input data-service-answer="${dataAttr}" type="${field.type === "number" ? "number" : "text"}" value="${escapeAttr(value)}" placeholder="${escapeAttr(field.label)}" />
        </label>
      `;
    });

    return `<div class="formGrid twoCols subtleTop">${fields.join("")}</div>`;
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

  root.serviceForm = {
    renderServiceRow,
  };
})();
