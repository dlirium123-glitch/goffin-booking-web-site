(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  function hasValue(value) {
    return value != null && String(value).trim() !== "";
  }

  function validateAddress(addressDraft, catalog) {
    const errors = [];
    const services = Array.isArray(addressDraft?.services) ? addressDraft.services : [];
    const region = String(addressDraft?.region || "").toLowerCase();

    if (!hasValue(addressDraft?.addressLine1)) errors.push("addressLine1_required");
    if (!hasValue(addressDraft?.postalCode)) errors.push("postalCode_required");
    if (!hasValue(addressDraft?.city)) errors.push("city_required");
    if (!hasValue(region)) errors.push("region_required");
    if (services.length === 0) errors.push("services_required");

    const selectedIds = services.map((service) => String(service?.serviceTypeId || ""));
    services.forEach((service, index) => {
      const serviceId = String(service?.serviceTypeId || "");
      const serviceType = catalog.getServiceTypeById(serviceId);
      if (!serviceType) {
        errors.push(`service_${index}_unknown`);
        return;
      }

      if (!catalog.isServiceAllowedInRegion(serviceId, region)) {
        errors.push(`service_${index}_region_forbidden`);
      }

      const count = Number(service?.installationsCount);
      if (!Number.isFinite(count) || count < 1) {
        errors.push(`service_${index}_installations_required`);
      }

      serviceType.incompatibleWith.forEach((incompatibleCode) => {
        if (selectedIds.includes(incompatibleCode)) {
          errors.push(`service_${index}_incompatible_${incompatibleCode}`);
        }
      });

      const schema = serviceType.formSchema || {};
      Object.keys(schema).forEach((fieldKey) => {
        const field = schema[fieldKey];
        if (field.required && !hasValue(service?.answers?.[fieldKey])) {
          errors.push(`service_${index}_field_${fieldKey}_required`);
        }
      });
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  function detectAddressWarnings(addressDraft, catalog) {
    const warnings = [];
    const region = String(addressDraft?.region || "").toLowerCase();
    const services = Array.isArray(addressDraft?.services) ? addressDraft.services : [];

    if (region === catalog.REGION.FLANDERS && services.some((service) => service?.serviceTypeId === "ouverture_compteur")) {
      warnings.push("ouverture_compteur_unavailable_in_flanders");
    }

    return warnings;
  }

  root.validation = {
    hasValue,
    validateAddress,
    detectAddressWarnings,
  };
})();
