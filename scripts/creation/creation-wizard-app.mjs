/**
 * Creation Wizard App
 *
 * Multi-step ApplicationV2 wizard for creating a character using the
 * "Creation in Play" rules. Produces a partially-complete 2e character actor
 * with a creationInPlay flag for the sheet tab to track.
 *
 * Steps: role → attributes → species → departments → value → summary
 *
 * @module creation/creationWizardApp
 */

import { MODULE_ID } from "../core/constants.js";
import {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
  CREATION_ATTR_CHIPS,
  STANDARD_ROLES,
  DIVISIONS,
  EQUIPMENT_ITEMS,
  loadSpeciesCatalog,
  createCreationInPlayActor,
} from "./creation-wizard-data.mjs";

const STEPS = [
  "role",
  "attributes",
  "species",
  "departments",
  "value",
  "summary",
];

const fapi = foundry.applications.api;

export class CreationWizardApp extends fapi.HandlebarsApplicationMixin(
  fapi.Application,
) {
  constructor(options = {}) {
    super(options);
    this._currentStep = "role";
    this._speciesCatalogLoaded = false;
    this._savedScrollPositions = null;

    this._wizardState = {
      name: "",
      role: "",
      division: "",
      careerTrait: "Starfleet Officer",
      equipmentNotes: "",
      // attributes: key → null (unassigned) or number
      attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, null])),
      // species
      species: "",
      speciesCustom: "",
      useCustomSpecies: false,
      speciesCatalog: [],
      selectedAttributeBonuses: [], // for species with null bonuses (e.g. Human)
      // departments: key → 0 (undefined), 5/4/3 (primary), or null
      departments: Object.fromEntries(DISCIPLINE_KEYS.map((k) => [k, 0])),
      primaryDept1: "",
      primaryDept2: "",
      deptSplit: "5-3", // "5-3" or "4-4"
      // value
      value: "",
      // equipment
      phaserChoice: "type2", // "type1" | "type2" | "none"
      includeEngineeringKit: false,
      includeMedKit: false,
    };
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-creation-wizard`,
    classes: ["sta-tracker-dialog", "sta-creation-wizard"],
    position: { width: 540 },
    window: {
      icon: "fa-solid fa-user-plus",
      title: "Creation in Play Wizard",
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/creation-wizard.hbs`,
      root: true,
    },
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _getStepIndex() {
    return STEPS.indexOf(this._currentStep);
  }

  _getAvailableAttrChips() {
    const pool = [...CREATION_ATTR_CHIPS];
    for (const val of Object.values(this._wizardState.attributes)) {
      if (val !== null) {
        const idx = pool.indexOf(val);
        if (idx !== -1) pool.splice(idx, 1);
      }
    }
    return pool;
  }

  _getSelectedSpeciesEntry() {
    const speciesName = this._wizardState.useCustomSpecies
      ? this._wizardState.speciesCustom
      : this._wizardState.species;
    if (!speciesName?.trim()) return null;
    return (
      this._wizardState.speciesCatalog.find(
        (s) => s.name.toLowerCase() === speciesName.trim().toLowerCase(),
      ) ?? null
    );
  }

  _getEffectiveSpeciesName() {
    if (this._wizardState.useCustomSpecies)
      return this._wizardState.speciesCustom.trim();
    return this._wizardState.species.trim();
  }

  _getEffectiveRole() {
    return this._wizardState.role.trim();
  }

  _getDeptRatingsForSplit() {
    return this._wizardState.deptSplit === "4-4" ? [4, 4] : [5, 3];
  }

  _canProceed() {
    const state = this._wizardState;
    switch (this._currentStep) {
      case "role":
        return !!state.name.trim() && !!this._getEffectiveRole();
      case "attributes": {
        return ATTRIBUTE_KEYS.every((k) => state.attributes[k] !== null);
      }
      case "species": {
        if (!this._getEffectiveSpeciesName()) return false;
        const specEntry = this._getSelectedSpeciesEntry();
        if (specEntry && specEntry.attributeBonuses === null)
          return state.selectedAttributeBonuses.length === 3;
        return true;
      }
      case "departments":
        return (
          !!state.primaryDept1 &&
          !!state.primaryDept2 &&
          state.primaryDept1 !== state.primaryDept2
        );
      case "value":
        return !!state.value.trim();
      case "summary":
        return true;
      default:
        return true;
    }
  }

  // ── Context ──────────────────────────────────────────────────────────────────

  async _prepareContext(_options) {
    if (!this._speciesCatalogLoaded) {
      await loadSpeciesCatalog().then((v) => {
        this._wizardState.speciesCatalog = v;
        this._speciesCatalogLoaded = true;
      });
    }

    const state = this._wizardState;
    const stepIndex = this._getStepIndex();
    const availableAttrChips = this._getAvailableAttrChips();
    const selectedSpeciesEntry = this._getSelectedSpeciesEntry();
    const needsAttributeBonusSelection = !!(
      selectedSpeciesEntry && selectedSpeciesEntry.attributeBonuses === null
    );

    // Species fixed bonus info (for all catalog species with defined bonuses)
    const speciesFixedBonuses =
      selectedSpeciesEntry?.attributeBonuses != null
        ? ATTRIBUTE_KEYS.filter(
            (k) => (selectedSpeciesEntry.attributeBonuses[k] ?? 0) > 0,
          ).map((k) => ({
            key: k,
            label: ATTRIBUTE_LABELS[k],
            bonus: selectedSpeciesEntry.attributeBonuses[k],
          }))
        : [];
    const speciesHasInfo = !!(selectedSpeciesEntry && !state.useCustomSpecies);
    const speciesAbilityName = selectedSpeciesEntry?.abilityName ?? null;
    const speciesAbilityDesc = selectedSpeciesEntry?.abilityDescription ?? null;

    const ratings = this._getDeptRatingsForSplit();
    const dept1Rating = ratings[0];
    const dept2Rating = ratings[1];

    // Compute attribute total for summary
    const attrTotal = ATTRIBUTE_KEYS.reduce((sum, k) => {
      const base = state.attributes[k] ?? 0;
      let bonus = 0;
      if (
        selectedSpeciesEntry &&
        selectedSpeciesEntry.attributeBonuses !== null &&
        selectedSpeciesEntry.attributeBonuses !== undefined
      ) {
        bonus = selectedSpeciesEntry.attributeBonuses[k] ?? 0;
      } else if (needsAttributeBonusSelection) {
        bonus = state.selectedAttributeBonuses.includes(k) ? 1 : 0;
      }
      return sum + base + bonus;
    }, 0);

    const effectiveRole = this._getEffectiveRole();
    const effectiveSpecies = this._getEffectiveSpeciesName();

    return {
      currentStep: this._currentStep,
      stepLabel: `Step ${stepIndex + 1} of ${STEPS.length}`,
      isFirstStep: stepIndex === 0,
      isLastStep: stepIndex === STEPS.length - 1,
      canProceed: this._canProceed(),

      // Step panels
      stepPanels: Object.fromEntries(
        STEPS.map((s) => [s, s === this._currentStep]),
      ),

      // Role step
      name: state.name,
      roleOptions: STANDARD_ROLES.map((r) => ({ value: r, label: r })),
      role: state.role,
      divisionOptions: DIVISIONS.map((d) => ({
        value: d.label,
        label: d.label,
      })),
      division: state.division,
      careerTrait: state.careerTrait,
      equipmentNotes: state.equipmentNotes,
      phaserChoice: state.phaserChoice,
      includeEngineeringKit: state.includeEngineeringKit,
      includeMedKit: state.includeMedKit,

      // Attributes step
      availableAttrChips,
      attrPoolEmpty: availableAttrChips.length === 0,
      showBonusColumn: selectedSpeciesEntry != null,
      needsAttributeBonusSelection,
      attributeSlots: ATTRIBUTE_KEYS.map((k) => {
        const fixedBonus = selectedSpeciesEntry?.attributeBonuses?.[k] ?? null;
        return {
          key: k,
          label: ATTRIBUTE_LABELS[k],
          value: state.attributes[k],
          fixedBonus,
          choiceBonus: needsAttributeBonusSelection
            ? {
                selected: state.selectedAttributeBonuses.includes(k),
                disabled:
                  !state.selectedAttributeBonuses.includes(k) &&
                  state.selectedAttributeBonuses.length >= 3,
              }
            : null,
        };
      }),

      // Species step
      species: state.species,
      speciesCustom: state.speciesCustom,
      useCustomSpecies: state.useCustomSpecies,
      speciesList: state.speciesCatalog.map((s) => ({
        name: s.name,
        selected: !state.useCustomSpecies && s.name === state.species,
      })),
      speciesFromCatalog: state.speciesCatalog.length > 0,
      effectiveSpecies,

      selectedAttrBonusCount: state.selectedAttributeBonuses.length,
      bonusSelectionComplete:
        needsAttributeBonusSelection &&
        state.selectedAttributeBonuses.length === 3,

      // Species info panel (fixed bonuses + ability)
      speciesHasInfo,
      speciesHasFixedBonuses: speciesFixedBonuses.length > 0,
      speciesFixedBonuses,
      speciesAbilityName,
      speciesAbilityDesc,

      // Departments step
      disciplineKeys: DISCIPLINE_KEYS,
      primaryDept1: state.primaryDept1,
      primaryDept2: state.primaryDept2,
      deptSplit53: state.deptSplit === "5-3",
      deptSplit44: state.deptSplit === "4-4",
      dept1Rating,
      dept2Rating,
      disciplineOptions: DISCIPLINE_KEYS.map((k) => ({
        key: k,
        label: DISCIPLINE_LABELS[k],
      })),

      // Value step
      value: state.value,

      // Summary
      summaryName: state.name,
      summaryRole: effectiveRole,
      summarySpecies: effectiveSpecies,
      summaryCareerTrait: state.careerTrait,
      summaryDivision: state.division,
      summaryDept1: state.primaryDept1
        ? `${DISCIPLINE_LABELS[state.primaryDept1] ?? state.primaryDept1} (${dept1Rating})`
        : "—",
      summaryDept2: state.primaryDept2
        ? `${DISCIPLINE_LABELS[state.primaryDept2] ?? state.primaryDept2} (${dept2Rating})`
        : "—",
      summaryValue: state.value,
      summaryAttrTotal: attrTotal,
      summaryAttributeSlots: ATTRIBUTE_KEYS.map((k) => {
        const base = state.attributes[k] ?? 0;
        let bonus = 0;
        if (
          selectedSpeciesEntry &&
          selectedSpeciesEntry.attributeBonuses !== null &&
          selectedSpeciesEntry.attributeBonuses !== undefined
        ) {
          bonus = selectedSpeciesEntry.attributeBonuses[k] ?? 0;
        } else if (needsAttributeBonusSelection) {
          bonus = state.selectedAttributeBonuses.includes(k) ? 1 : 0;
        }
        return {
          label: ATTRIBUTE_LABELS[k],
          total: base + bonus,
          base,
          bonus,
        };
      }),
      summaryEquipment: (() => {
        const parts = ["Tricorder", "Communicator", "Uniform"];
        if (state.phaserChoice === "type1")
          parts.push(EQUIPMENT_ITEMS.PHASER_TYPE1.name);
        else if (state.phaserChoice === "type2")
          parts.push(EQUIPMENT_ITEMS.PHASER_TYPE2.name);
        if (state.includeEngineeringKit)
          parts.push(EQUIPMENT_ITEMS.ENGINEERING_KIT.name);
        if (state.includeMedKit) parts.push(EQUIPMENT_ITEMS.MED_KIT.name);
        return parts.join(", ");
      })(),
      summaryEquipmentNotes: state.equipmentNotes,
    };
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  render(...args) {
    this._savedScrollPositions = this._captureScrollPositions();
    return super.render(...args);
  }

  _captureScrollPositions() {
    const html = this.element;
    if (!html) return {};
    const positions = {};
    for (const el of html.querySelectorAll("*")) {
      if (el.scrollTop > 0) {
        const cls = el.classList[0];
        if (cls && !(cls in positions)) positions[cls] = el.scrollTop;
      }
    }
    return positions;
  }

  _restoreScrollPositions(positions) {
    const html = this.element;
    if (!html || !positions) return;
    for (const [cls, scrollTop] of Object.entries(positions)) {
      const el = html.querySelector(`.${CSS.escape(cls)}`);
      if (el) el.scrollTop = scrollTop;
    }
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this._restoreScrollPositions(this._savedScrollPositions);
    this._savedScrollPositions = null;
    const html = this.element;

    html
      .querySelector(".cw-back")
      ?.addEventListener("click", () => this._onBack());
    html.querySelector(".cw-next")?.addEventListener("click", () => {
      if (this._canProceed()) this._onNext();
    });
    html
      .querySelector(".cw-create")
      ?.addEventListener("click", () => this._onCreate());

    switch (this._currentStep) {
      case "role":
        this._setupRoleStep(html);
        break;
      case "attributes":
        this._setupDragDrop(html, "attributes");
        break;
      case "species": {
        this._setupSpeciesStep(html);
        // Scope to species panel only — avoid touching identical checkboxes
        // that may exist in the (hidden) attributes panel.
        const specPanel = html.querySelector('.cw-panel[data-panel="species"]');
        this._setupAttributeBonusCheckboxes(specPanel ?? html);
        break;
      }
      case "departments":
        this._setupDepartmentsStep(html);
        break;
      case "value":
        this._setupValueStep(html);
        break;
    }

    this._refreshNextButton(html);
  }

  _refreshNextButton(html = this.element) {
    const btn =
      html.querySelector(".cw-next") ?? html.querySelector(".cw-create");
    if (btn) btn.disabled = !this._canProceed();
  }

  // ── Navigation ───────────────────────────────────────────────────────────────

  _onBack() {
    const idx = this._getStepIndex();
    if (idx > 0) {
      this._currentStep = STEPS[idx - 1];
      this.render();
    }
  }

  _onNext() {
    const idx = this._getStepIndex();
    if (idx < STEPS.length - 1) {
      this._currentStep = STEPS[idx + 1];
      this.render();
    }
  }

  async _onCreate() {
    if (!this._canProceed()) return;
    const state = this._wizardState;

    // Apply department ratings from split selection
    const ratings = this._getDeptRatingsForSplit();
    const depts = Object.fromEntries(DISCIPLINE_KEYS.map((k) => [k, 0]));
    if (state.primaryDept1) depts[state.primaryDept1] = ratings[0];
    if (state.primaryDept2) depts[state.primaryDept2] = ratings[1];

    try {
      await createCreationInPlayActor({
        name: state.name,
        role: this._getEffectiveRole(),
        division: state.division,
        careerTrait: state.careerTrait,
        equipmentNotes: state.equipmentNotes,
        attributes: state.attributes,
        species: this._getEffectiveSpeciesName(),
        selectedAttributeBonuses: state.selectedAttributeBonuses,
        departments: depts,
        primaryDept1: state.primaryDept1,
        primaryDept2: state.primaryDept2,
        value: state.value,
        phaserChoice: state.phaserChoice,
        includeEngineeringKit: state.includeEngineeringKit,
        includeMedKit: state.includeMedKit,
      });
      this.close();
    } catch (err) {
      console.error(
        `${MODULE_ID} | CreationWizardApp: actor creation failed`,
        err,
      );
      ui.notifications.error(
        "Failed to create character. See console for details.",
      );
    }
  }

  // ── Generic combobox helper ──────────────────────────────────────────────────

  /**
   * Wire up a typable combobox (text input + filtered dropdown).
   * @param {HTMLInputElement} input
   * @param {HTMLUListElement} dropdown   Element containing .cw-combobox-option items.
   * @param {{ onSelect?: (v:string)=>void, onType?: (v:string)=>void }} [callbacks]
   */
  _setupCombobox(input, dropdown, { onSelect, onType } = {}) {
    if (!input || !dropdown) return;
    const options = [...dropdown.querySelectorAll(".cw-combobox-option")];

    const showDropdown = () => {
      dropdown.classList.add("open");
      input.setAttribute("aria-expanded", "true");
    };
    const hideDropdown = () => {
      dropdown.classList.remove("open");
      input.setAttribute("aria-expanded", "false");
    };
    const filterOptions = (q) => {
      const lq = q.trim().toLowerCase();
      for (const opt of options) {
        opt.hidden =
          lq.length > 0 && !opt.dataset.value.toLowerCase().includes(lq);
      }
    };
    const selectOption = (value) => {
      input.value = value;
      hideDropdown();
      onSelect?.(value);
    };

    input.addEventListener("focus", () => {
      filterOptions(input.value);
      showDropdown();
    });
    input.addEventListener("input", () => {
      filterOptions(input.value);
      showDropdown();
      onType?.(input.value);
    });
    input.addEventListener("blur", () => setTimeout(hideDropdown, 150));
    input.addEventListener("keydown", (e) => {
      const visible = options.filter((o) => !o.hidden);
      const active = dropdown.querySelector(".cw-combobox-option--active");
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = active
          ? (visible[visible.indexOf(active) + 1] ?? visible[0])
          : visible[0];
        active?.classList.remove("cw-combobox-option--active");
        next?.classList.add("cw-combobox-option--active");
        next?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = active
          ? (visible[visible.indexOf(active) - 1] ??
            visible[visible.length - 1])
          : visible[visible.length - 1];
        active?.classList.remove("cw-combobox-option--active");
        prev?.classList.add("cw-combobox-option--active");
        prev?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active) selectOption(active.dataset.value);
        else hideDropdown();
      } else if (e.key === "Escape") {
        hideDropdown();
      }
    });

    for (const opt of options) {
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectOption(opt.dataset.value);
      });
    }
  }

  // ── Step Setups ──────────────────────────────────────────────────────────────

  _setupRoleStep(html) {
    const nameInput = html.querySelector("[name='cw-name']");
    if (nameInput) {
      nameInput.addEventListener("input", () => {
        this._wizardState.name = nameInput.value;
        this._refreshNextButton(html);
      });
    }

    // Role combobox
    const roleInput = html.querySelector("[name='cw-role']");
    const roleDropdown = html.querySelector(
      ".cw-combobox[data-combobox='role'] .cw-combobox-dropdown",
    );
    this._setupCombobox(roleInput, roleDropdown, {
      onSelect: (val) => {
        this._wizardState.role = val;
        this._refreshNextButton(html);
      },
      onType: (val) => {
        this._wizardState.role = val;
        this._refreshNextButton(html);
      },
    });

    // Division combobox
    const divInput = html.querySelector("[name='cw-division']");
    const divDropdown = html.querySelector(
      ".cw-combobox[data-combobox='division'] .cw-combobox-dropdown",
    );
    this._setupCombobox(divInput, divDropdown, {
      onSelect: (val) => {
        this._wizardState.division = val;
        const traitInput = html.querySelector("[name='cw-career-trait']");
        if (traitInput && !this._wizardState.careerTrait.trim()) {
          const role = this._getEffectiveRole();
          if (role) traitInput.value = role;
        }
      },
      onType: (val) => {
        this._wizardState.division = val;
      },
    });

    html
      .querySelector("[name='cw-career-trait']")
      ?.addEventListener("input", (e) => {
        this._wizardState.careerTrait = e.target.value;
      });

    html
      .querySelector("[name='cw-equipment-notes']")
      ?.addEventListener("input", (e) => {
        this._wizardState.equipmentNotes = e.target.value;
      });

    for (const radio of html.querySelectorAll("[name='cw-phaser']")) {
      radio.addEventListener("change", () => {
        this._wizardState.phaserChoice = radio.value;
        for (const lbl of html.querySelectorAll(".cw-phaser-label")) {
          lbl.classList.toggle(
            "active",
            lbl.querySelector("input")?.value === radio.value,
          );
        }
      });
    }

    html
      .querySelector("[name='cw-engineering-kit']")
      ?.addEventListener("change", (e) => {
        this._wizardState.includeEngineeringKit = e.target.checked;
      });

    html
      .querySelector("[name='cw-med-kit']")
      ?.addEventListener("change", (e) => {
        this._wizardState.includeMedKit = e.target.checked;
      });
  }

  _setupDragDrop(html, stateKey) {
    const pool = html.querySelector("#cw-attr-pool");
    const dropZones = [...html.querySelectorAll(".cw-drop-zone")];

    if (!pool) return;

    const onDragStart = (e, value, sourceKey) => {
      e.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ value, sourceKey }),
      );
      e.dataTransfer.effectAllowed = "move";
    };

    const onDrop = (e, targetKey) => {
      e.preventDefault();
      let payload;
      try {
        payload = JSON.parse(e.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      const { value, sourceKey } = payload;

      if (targetKey === sourceKey) return; // no-op

      const stateObj = this._wizardState[stateKey];

      // If dropping onto an occupied slot, swap
      const currentOccupant = stateObj[targetKey] ?? null;

      // Remove from source (could be pool: sourceKey === "")
      if (sourceKey) stateObj[sourceKey] = null;

      // Put in target
      stateObj[targetKey] = value;

      // Return occupant to source slot or pool
      if (currentOccupant !== null && sourceKey) {
        stateObj[sourceKey] = currentOccupant;
      }

      this.render();
    };

    // Pool chips
    for (const chip of pool.querySelectorAll(".cw-chip")) {
      chip.addEventListener("dragstart", (e) =>
        onDragStart(e, Number(chip.dataset.value), ""),
      );
    }

    // Assigned chips (drag back to pool)
    for (const zone of dropZones) {
      const assignedChip = zone.querySelector(".cw-chip--assigned");
      if (assignedChip) {
        assignedChip.addEventListener("dragstart", (e) =>
          onDragStart(e, Number(assignedChip.dataset.value), zone.dataset.key),
        );
      }

      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      });
      zone.addEventListener("drop", (e) => onDrop(e, zone.dataset.key));
    }

    // Pool accepts drops (return chips)
    pool.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    pool.addEventListener("drop", (e) => {
      e.preventDefault();
      let payload;
      try {
        payload = JSON.parse(e.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      const { sourceKey } = payload;
      if (sourceKey) {
        this._wizardState[stateKey][sourceKey] = null;
        this.render();
      }
    });
  }

  _setupAttributeBonusCheckboxes(html) {
    for (const cb of html.querySelectorAll(".cw-bonus-attr-cb")) {
      cb.addEventListener("change", () => {
        const key = cb.value;
        const set = new Set(this._wizardState.selectedAttributeBonuses);
        if (cb.checked) {
          if (set.size < 3) set.add(key);
          else cb.checked = false; // reject — already at 3
        } else {
          set.delete(key);
        }
        this._wizardState.selectedAttributeBonuses = [...set];
        this.render(); // re-render so disabled state updates on remaining checkboxes
      });
    }
  }

  _setupSpeciesStep(html) {
    const specPanel = html.querySelector('.cw-panel[data-panel="species"]');
    const input = specPanel?.querySelector("[name='cw-species']");
    const dropdown = specPanel?.querySelector(
      ".cw-combobox[data-combobox='species'] .cw-combobox-dropdown",
    );

    if (input && dropdown) {
      this._setupCombobox(input, dropdown, {
        onSelect: (name) => {
          if (this._wizardState.species !== name)
            this._wizardState.selectedAttributeBonuses = [];
          this._wizardState.species = name;
          this._wizardState.useCustomSpecies = false;
          this.render();
        },
        onType: (val) => {
          if (this._wizardState.species !== val)
            this._wizardState.selectedAttributeBonuses = [];
          this._wizardState.species = val;
          this._wizardState.useCustomSpecies = false;
          const specEntry = this._getSelectedSpeciesEntry();
          if (specEntry) {
            this.render();
          } else {
            this._refreshNextButton(html);
          }
        },
      });
    }

    // Custom species toggle
    const customToggle = html.querySelector(
      "[name='cw-species-custom-toggle']",
    );
    const customInput = html.querySelector("[name='cw-species-custom']");
    if (customToggle) {
      customToggle.addEventListener("change", () => {
        this._wizardState.useCustomSpecies = customToggle.checked;
        html
          .querySelector(".cw-species-custom-wrap")
          ?.classList.toggle("hidden", !customToggle.checked);
        html
          .querySelector(".cw-species-combobox-wrap")
          ?.classList.toggle("hidden", customToggle.checked);
        this._refreshNextButton(html);
      });
    }
    if (customInput) {
      customInput.addEventListener("input", () => {
        this._wizardState.speciesCustom = customInput.value;
        this._refreshNextButton(html);
      });
    }
  }

  _setupDepartmentsStep(html) {
    const dept1Select = html.querySelector("[name='cw-dept1']");
    const dept2Select = html.querySelector("[name='cw-dept2']");

    // Disable the option already chosen in one select from the other,
    // so the user cannot pick the same department for both slots.
    const syncDeptConstraints = () => {
      const v1 = this._wizardState.primaryDept1;
      const v2 = this._wizardState.primaryDept2;
      for (const opt of dept2Select?.querySelectorAll("option") ?? []) {
        opt.disabled = !!(opt.value && opt.value === v1);
      }
      for (const opt of dept1Select?.querySelectorAll("option") ?? []) {
        opt.disabled = !!(opt.value && opt.value === v2);
      }
      this._refreshNextButton(html);
    };

    if (dept1Select) {
      dept1Select.addEventListener("change", () => {
        this._wizardState.primaryDept1 = dept1Select.value;
        syncDeptConstraints();
      });
    }
    if (dept2Select) {
      dept2Select.addEventListener("change", () => {
        this._wizardState.primaryDept2 = dept2Select.value;
        syncDeptConstraints();
      });
    }
    // Apply on first render
    syncDeptConstraints();

    for (const radio of html.querySelectorAll("[name='cw-dept-split']")) {
      radio.addEventListener("change", () => {
        this._wizardState.deptSplit = radio.value;
        // Update displayed ratings and active state without full re-render
        const ratings = this._getDeptRatingsForSplit();
        const r1El = html.querySelector(".cw-dept1-rating");
        const r2El = html.querySelector(".cw-dept2-rating");
        if (r1El) r1El.textContent = ratings[0];
        if (r2El) r2El.textContent = ratings[1];
        for (const lbl of html.querySelectorAll(
          ".cw-radio-group .cw-radio-label",
        )) {
          lbl.classList.toggle(
            "active",
            lbl.querySelector("input")?.value === radio.value,
          );
        }
      });
    }
  }

  _setupValueStep(html) {
    const valueInput = html.querySelector("[name='cw-value']");
    if (valueInput) {
      valueInput.addEventListener("input", () => {
        this._wizardState.value = valueInput.value;
        this._refreshNextButton(html);
      });
    }
  }
}
