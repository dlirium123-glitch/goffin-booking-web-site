(function () {
  "use strict";

  const root = (window.GoffinBooking = window.GoffinBooking || {});

  const REGION = Object.freeze({
    BRUSSELS: "bruxelles",
    WALLONIA: "wallonie",
    FLANDERS: "flandre",
  });

  const SERVICE_TYPES = Object.freeze([
    {
      id: "conformite_gaz",
      code: "conformite_gaz",
      label: "Conformite gaz (naturel)",
      active: true,
      regionsAllowed: [REGION.BRUSSELS, REGION.WALLONIA, REGION.FLANDERS],
      incompatibleWith: [],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        installationType: {
          type: "select",
          label: "Type d'installation",
          required: true,
          options: [
            { value: "residentiel", label: "Residentiel" },
            { value: "professionnel", label: "Professionnel" },
          ],
        },
      },
      sortOrder: 10,
    },
    {
      id: "ouverture_compteur",
      code: "ouverture_compteur",
      label: "Ouverture compteur",
      active: true,
      regionsAllowed: [REGION.BRUSSELS, REGION.WALLONIA],
      incompatibleWith: [
        "reception_peb_chauffage_bxl",
        "reception_chaudiere_wallonie",
        "reception_chaudiere_flandre",
      ],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        grdfReady: {
          type: "boolean",
          label: "Le compteur est-il pret a l'ouverture ?",
          required: true,
        },
      },
      sortOrder: 20,
    },
    {
      id: "test_etancheite",
      code: "test_etancheite",
      label: "Test d'etancheite",
      active: true,
      regionsAllowed: [REGION.BRUSSELS, REGION.WALLONIA, REGION.FLANDERS],
      incompatibleWith: [],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        installationPressure: {
          type: "text",
          label: "Pression ou contexte utile",
          required: false,
        },
      },
      sortOrder: 30,
    },
    {
      id: "reception_peb_chauffage_bxl",
      code: "reception_peb_chauffage_bxl",
      label: "Reception PEB chauffage Bruxelles",
      active: true,
      regionsAllowed: [REGION.BRUSSELS],
      incompatibleWith: ["ouverture_compteur"],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        generatorType: {
          type: "text",
          label: "Type de generateur",
          required: true,
        },
      },
      sortOrder: 40,
    },
    {
      id: "reception_chaudiere_wallonie",
      code: "reception_chaudiere_wallonie",
      label: "Reception chaudiere Wallonie",
      active: true,
      regionsAllowed: [REGION.WALLONIA],
      incompatibleWith: ["ouverture_compteur"],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        boilerPowerKw: {
          type: "number",
          label: "Puissance chaudiere (kW)",
          required: false,
        },
      },
      sortOrder: 50,
    },
    {
      id: "reception_chaudiere_flandre",
      code: "reception_chaudiere_flandre",
      label: "Reception chaudiere Flandre",
      active: true,
      regionsAllowed: [REGION.FLANDERS],
      incompatibleWith: ["ouverture_compteur"],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        boilerPowerKw: {
          type: "number",
          label: "Puissance chaudiere (kW)",
          required: false,
        },
      },
      sortOrder: 60,
    },
    {
      id: "visite_conseil",
      code: "visite_conseil",
      label: "Visite conseil",
      active: true,
      regionsAllowed: [REGION.BRUSSELS, REGION.WALLONIA, REGION.FLANDERS],
      incompatibleWith: [],
      baseMinutesPerUnit: 60,
      requiresInstallationsCount: true,
      formSchema: {
        context: {
          type: "textarea",
          label: "Contexte de la visite",
          required: false,
        },
      },
      sortOrder: 70,
    },
  ]);

  const serviceMap = new Map(SERVICE_TYPES.map((service) => [service.id, service]));

  function listActiveServiceTypes() {
    return SERVICE_TYPES.filter((service) => service.active).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function getServiceTypeById(serviceTypeId) {
    return serviceMap.get(String(serviceTypeId || "")) || null;
  }

  function isServiceAllowedInRegion(serviceTypeId, region) {
    const service = getServiceTypeById(serviceTypeId);
    if (!service) return false;
    return service.regionsAllowed.includes(String(region || "").toLowerCase());
  }

  function listServiceIdsIncompatibleWith(serviceTypeId) {
    const service = getServiceTypeById(serviceTypeId);
    if (!service) return [];
    return service.incompatibleWith.slice();
  }

  function listAvailableServicesForRegion(region) {
    return listActiveServiceTypes().filter((service) => isServiceAllowedInRegion(service.id, region));
  }

  root.serviceCatalog = {
    REGION,
    SERVICE_TYPES,
    listActiveServiceTypes,
    getServiceTypeById,
    isServiceAllowedInRegion,
    listServiceIdsIncompatibleWith,
    listAvailableServicesForRegion,
  };
})();
