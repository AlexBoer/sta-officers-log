import { MODULE_ID } from "../core/constants.js";
import {
  getNormalizedTalentRequirements,
  normalizeRequirementString,
  TALENT_REQUIREMENTS_FLAG_KEY,
} from "../core/talentRequirements.js";

const { api, sheets } = foundry.applications;

const _talentSheetUiStateByItemKey = new Map();

const CATEGORY_OPTIONS = [
  {
    value: "attribute",
    labelKey: "sta-officers-log.talents.requirements.category.attribute",
    fallback: "Attributes",
  },
  {
    value: "discipline",
    labelKey: "sta-officers-log.talents.requirements.category.discipline",
    fallback: "Departments",
  },
  {
    value: "systems",
    labelKey: "sta-officers-log.talents.requirements.category.systems",
    fallback: "Systems",
  },
  {
    value: "species",
    labelKey: "sta-officers-log.talents.requirements.category.species",
    fallback: "Species",
  },
  {
    value: "house",
    labelKey: "sta-officers-log.talents.requirements.category.house",
    fallback: "House",
  },
  {
    value: "condition",
    labelKey: "sta-officers-log.talents.requirements.category.condition",
    fallback: "Condition",
  },
];

const ATTRIBUTE_OPTIONS = [
  { value: "control", label: "Control" },
  { value: "daring", label: "Daring" },
  { value: "fitness", label: "Fitness" },
  { value: "insight", label: "Insight" },
  { value: "presence", label: "Presence" },
  { value: "reason", label: "Reason" },
];

const DISCIPLINE_OPTIONS = [
  { value: "command", label: "Command" },
  { value: "conn", label: "Conn" },
  { value: "engineering", label: "Engineering" },
  { value: "medicine", label: "Medicine" },
  { value: "science", label: "Science" },
  { value: "security", label: "Security" },
];

const SYSTEM_OPTIONS = [
  { value: "communications", label: "Communications" },
  { value: "computers", label: "Computers" },
  { value: "engines", label: "Engines" },
  { value: "sensors", label: "Sensors" },
  { value: "structure", label: "Structure" },
  { value: "weapons", label: "Weapons" },
];

const HOUSE_OPTIONS = [
  { value: "leaders", label: "Leaders" },
  { value: "warriors", label: "Warriors" },
  { value: "spacefarers", label: "Spacefarers" },
  { value: "engineers", label: "Engineers" },
  { value: "scientists", label: "Scientists" },
  { value: "physicians", label: "Physicians" },
];

// Talent Type dropdown (system.talenttype.typeenum). Types are independent tags;
// requirements are configured separately below. Only Species Ability auto-adds a
// backing requirement (see TYPE_TO_REQUIREMENT_CATEGORY).
const TALENT_TYPE_OPTIONS = [
  {
    value: "general",
    key: "sta.item.talent.type.general",
    fallback: "General",
  },
  {
    value: "character",
    key: "sta-officers-log.talents.type.character",
    fallback: "Character",
  },
  {
    value: "starship",
    key: "sta-officers-log.talents.type.starship",
    fallback: "Starship",
  },
  {
    value: "starshipservicerecord",
    key: "sta-officers-log.talents.type.starshipServiceRecord",
    fallback: "Starship Service Record",
  },
  {
    value: "starshipspecialrule",
    key: "sta-officers-log.talents.type.starshipSpecialRule",
    fallback: "Starship Special Rule",
  },
  {
    value: "speciesability",
    key: "sta-officers-log.talents.type.speciesAbility",
    fallback: "Species Ability",
  },
  { value: "npc", key: "sta.item.talent.type.npc", fallback: "NPC" },
  {
    value: "role",
    key: "sta-officers-log.talents.type.role",
    fallback: "Role",
  },
  {
    value: "award",
    key: "sta-officers-log.talents.type.award",
    fallback: "Award",
  },
];

// Talent types that auto-insert a backing requirement when chosen.
const TYPE_TO_REQUIREMENT_CATEGORY = {
  speciesability: "species",
};

const DEFAULT_ENTRY_BY_CATEGORY = {
  attribute: {
    category: "attribute",
    operator: "OR",
    clauses: [
      { value: "control", minimum: 0 },
      { value: "", minimum: 0 },
    ],
  },
  discipline: {
    category: "discipline",
    operator: "OR",
    clauses: [
      { value: "command", minimum: 0 },
      { value: "", minimum: 0 },
    ],
  },
  systems: {
    category: "systems",
    operator: "OR",
    clauses: [
      { value: "communications", minimum: 0 },
      { value: "", minimum: 0 },
    ],
  },
  species: {
    category: "species",
    operator: "OR",
    clauses: [{ value: "", minimum: 0 }],
  },
  house: {
    category: "house",
    operator: "OR",
    clauses: [{ value: "leaders", minimum: 0 }],
  },
  condition: {
    category: "condition",
    operator: "OR",
    clauses: [{ value: "", minimum: 0 }],
  },
};

const localize = (key, fallback) => {
  if (game.i18n?.has?.(key)) return game.i18n.localize(key);
  return fallback ?? key;
};

const normalizeOp = (value) =>
  String(value ?? "OR").toUpperCase() === "AND" ? "AND" : "OR";

const isNumericCategory = (category) =>
  category === "attribute" ||
  category === "discipline" ||
  category === "systems";

const maxClausesForCategory = (category) =>
  isNumericCategory(category) ? 2 : 1;

const cloneDefaultEntry = (category) =>
  foundry.utils.deepClone(DEFAULT_ENTRY_BY_CATEGORY[category] ?? null);

const getOptionSet = (category) => {
  if (category === "attribute") return ATTRIBUTE_OPTIONS;
  if (category === "discipline") return DISCIPLINE_OPTIONS;
  if (category === "systems") return SYSTEM_OPTIONS;
  if (category === "house") return HOUSE_OPTIONS;
  return [];
};

// Categories whose value is a free-form narrative string rather than a preset.
const isLongTextCategory = (category) => category === "condition";

function _getItemStateKey(item) {
  return String(item?.uuid ?? item?.id ?? "").trim();
}

function _labelForCategory(category) {
  const option = CATEGORY_OPTIONS.find((entry) => entry.value === category);
  if (!option) return category;
  return localize(option.labelKey, option.fallback);
}

function _labelForClauseValue(category, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const options = getOptionSet(category);
  if (!options.length) return raw;
  return options.find((entry) => entry.value === raw)?.label ?? raw;
}

function _summarizeClause(category, clause) {
  const value = String(clause?.value ?? "").trim();
  if (!value) return "";
  const label = _labelForClauseValue(category, value);
  if (!isNumericCategory(category)) return label;
  const minimum = Number(clause?.minimum);
  if (Number.isFinite(minimum) && minimum > 0) return `${label} ${minimum}`;
  return label;
}

function _summarizeAllRequirements(requirements) {
  const parts = (Array.isArray(requirements) ? requirements : [])
    .map((entry) => {
      const category = normalizeRequirementString(entry?.category);
      if (!category) return "";

      const clauses = (Array.isArray(entry?.clauses) ? entry.clauses : [])
        .map((clause) => _summarizeClause(category, clause))
        .filter(Boolean);
      if (!clauses.length) return "";

      const joiner = normalizeOp(entry?.operator) === "AND" ? " and " : " or ";
      return clauses.join(joiner);
    })
    .filter(Boolean);

  if (!parts.length) {
    return localize(
      "sta-officers-log.talents.sheet.noRequirements",
      "No requirements.",
    );
  }

  const prefix = localize(
    "sta-officers-log.talents.sheet.requiresPrefix",
    "Requires",
  );
  return `${prefix} ${parts.join(", ")}`;
}

// Conditions are long narrative strings; keep them out of the inline summary so
// they can render on their own wrapping lines.
function _splitRequirementSummary(requirements) {
  const list = Array.isArray(requirements) ? requirements : [];
  const conditions = [];
  const inline = [];
  for (const entry of list) {
    if (normalizeRequirementString(entry?.category) === "condition") {
      const text = String(entry?.clauses?.[0]?.value ?? "").trim();
      if (text) conditions.push(text);
    } else {
      inline.push(entry);
    }
  }

  const conditionLabel = localize(
    "sta-officers-log.talents.requirements.category.condition",
    "Condition",
  );
  let summary = "";
  if (inline.length) summary = _summarizeAllRequirements(inline);
  else if (!conditions.length) summary = _summarizeAllRequirements([]);

  return {
    summary,
    conditionSummaries: conditions.map((text) => `${conditionLabel}: ${text}`),
  };
}

function _toEditableRequirements(requirements) {
  const normalized = Array.isArray(requirements) ? requirements : [];
  return normalized
    .map((entry) => {
      const category = normalizeRequirementString(entry?.category);
      if (!category) return null;
      const maxClauses = maxClausesForCategory(category);
      const clauses = [...(Array.isArray(entry?.clauses) ? entry.clauses : [])]
        .slice(0, maxClauses)
        .map((clause) => ({
          value: String(clause?.value ?? "").trim(),
          minimum: Number.isFinite(Number(clause?.minimum))
            ? Number(clause.minimum)
            : 0,
        }));

      while (clauses.length < maxClauses) {
        clauses.push({ value: "", minimum: 0 });
      }

      return {
        category,
        operator: normalizeOp(entry?.operator),
        clauses,
      };
    })
    .filter(Boolean);
}

function _sanitizeRequirementEntry(entry) {
  const category = normalizeRequirementString(entry?.category);
  if (!category) return null;

  const clauses = (Array.isArray(entry?.clauses) ? entry.clauses : [])
    .slice(0, maxClausesForCategory(category))
    .map((clause) => {
      const value = String(clause?.value ?? "").trim();
      if (!value) return null;
      const out = { value };
      if (isNumericCategory(category)) {
        const minimum = Number(clause?.minimum);
        out.minimum = Number.isFinite(minimum) ? minimum : 0;
      }
      return out;
    })
    .filter(Boolean);

  if (!clauses.length) return null;

  return {
    category,
    operator: normalizeOp(entry?.operator),
    clauses,
  };
}

export class OfficersTalentSheet extends api.HandlebarsApplicationMixin(
  sheets.ItemSheetV2,
) {
  static PARTS = {
    itemsheet: {
      template: `modules/${MODULE_ID}/templates/officers-talent-sheet.hbs`,
    },
  };

  static DEFAULT_OPTIONS = {
    classes: ["sta-officers-log", "officers-talent-sheet"],
    actions: {
      onToggleEdit: OfficersTalentSheet._onToggleEdit,
      onAddRequirement: OfficersTalentSheet._onAddRequirement,
      onDeleteRequirement: OfficersTalentSheet._onDeleteRequirement,
      onToggleOperator: OfficersTalentSheet._onToggleOperator,
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    position: {
      height: "auto",
      width: 565,
    },
    window: {
      resizable: true,
    },
  };

  get title() {
    return `${this.item.name} - Talent`;
  }

  async _processSubmitData(event, form, formData) {
    // submitOnChange can rerender the sheet; persist draft requirement edits in UI state first.
    this._captureDraftRequirementsFromDom();
    return super._processSubmitData(event, form, formData);
  }

  async close(options = {}) {
    // Persist any in-progress requirement edits so they aren't lost on close.
    try {
      this._captureDraftRequirementsFromDom();
      await this._persistRequirementsFromState();
    } catch (err) {
      console.error(
        `${MODULE_ID} | Failed to persist talent requirements on close`,
        err,
      );
    }
    return super.close(options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    const typeSelect = root.querySelector(".sta-talent-type-select");
    if (typeSelect instanceof HTMLSelectElement) {
      typeSelect.addEventListener("change", (event) => {
        // Handle the change ourselves; keep it out of submitOnChange.
        event.stopPropagation();
        this._onTalentTypeChange(String(event.currentTarget.value ?? ""));
      });
    }
  }

  async _onTalentTypeChange(newType) {
    this._captureDraftRequirementsFromDom();
    const state = this._getUiState();
    const category = TYPE_TO_REQUIREMENT_CATEGORY[newType] ?? null;

    // Some types auto-insert a backing requirement (e.g. Species Ability adds a
    // Species requirement). Leave it as a draft row for the user to fill in; it
    // persists with the rest on Done. The type is stored independently below.
    if (category) {
      const exists = state.requirements.some(
        (entry) => entry.category === category,
      );
      if (!exists) {
        const entry = cloneDefaultEntry(category);
        if (entry) state.requirements = [...state.requirements, entry];
      }
      state.compactMode = false;
    }
    this._setUiState(state);

    await this.item.update({
      "system.talenttype.typeenum": newType,
    });

    this.render();
  }

  _getUiState() {
    const key = _getItemStateKey(this.item);
    let state = key ? _talentSheetUiStateByItemKey.get(key) : null;

    if (!state) {
      state = {
        compactMode: true,
        requirements: _toEditableRequirements(
          getNormalizedTalentRequirements(this.item),
        ),
      };
      if (key) _talentSheetUiStateByItemKey.set(key, state);
    }

    return state;
  }

  _setUiState(nextState) {
    const key = _getItemStateKey(this.item);
    if (!key) return;
    _talentSheetUiStateByItemKey.set(key, nextState);
  }

  _captureDraftRequirementsFromDom() {
    const state = this._getUiState();
    if (state.compactMode) return state.requirements;

    const root = this.element;
    if (!(root instanceof HTMLElement)) return state.requirements;

    const rows = Array.from(root.querySelectorAll(".sta-talent-req-row"));
    const parsed = [];

    for (const row of rows) {
      const category = normalizeRequirementString(row.dataset.category);
      if (!category) continue;

      const clauseCount = maxClausesForCategory(category);
      const opEl = row.querySelector('[data-field="operator"]');
      const operator = normalizeOp(opEl?.dataset?.value ?? opEl?.value ?? "OR");

      const clauses = [];
      for (let i = 0; i < clauseCount; i += 1) {
        const valueEl = row.querySelector(
          `[data-field="value"][data-clause-index="${i}"]`,
        );
        const value = String(valueEl?.value ?? "").trim();
        const clause = { value, minimum: 0 };

        if (isNumericCategory(category)) {
          const minEl = row.querySelector(
            `[data-field="minimum"][data-clause-index="${i}"]`,
          );
          const minimum = Number(minEl?.value);
          clause.minimum = Number.isFinite(minimum) ? minimum : 0;
        }

        clauses.push(clause);
      }

      parsed.push({ category, operator, clauses });
    }

    state.requirements = _toEditableRequirements(parsed);
    this._setUiState(state);
    return state.requirements;
  }

  async _persistRequirementsFromState() {
    const state = this._getUiState();
    const requirements = (
      Array.isArray(state.requirements) ? state.requirements : []
    )
      .map((entry) => _sanitizeRequirementEntry(entry))
      .filter(Boolean);

    state.requirements = _toEditableRequirements(requirements);
    this._setUiState(state);

    // Requirements are stored independently of the talent type, which is set
    // solely by the Talent Type dropdown.
    await this.item.update({
      [`flags.${MODULE_ID}.${TALENT_REQUIREMENTS_FLAG_KEY}`]: requirements,
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = this._getUiState();
    const requirements = _toEditableRequirements(state.requirements);
    state.requirements = requirements;
    this._setUiState(state);

    let enrichedNotes = "";
    try {
      const _TextEditor =
        foundry?.applications?.ux?.TextEditor?.implementation ?? TextEditor;
      enrichedNotes =
        (await _TextEditor?.enrichHTML?.(this.item.system?.description ?? "", {
          relativeTo: this.item,
          secrets: this.item.isOwner,
        })) ?? "";
    } catch (_) {
      enrichedNotes = this.item.system?.description ?? "";
    }

    const requirementRows = requirements.map((entry, index) => {
      const category = entry.category;
      const clauseCount = maxClausesForCategory(category);
      const optionSet = getOptionSet(category);
      const hasPresetOptions = optionSet.length > 0;

      const clauses = Array.from({ length: clauseCount }, (_, clauseIndex) => {
        const clause = entry.clauses[clauseIndex] ?? { value: "", minimum: 0 };
        return {
          index: clauseIndex,
          value: clause.value ?? "",
          minimum: Number.isFinite(Number(clause.minimum))
            ? Number(clause.minimum)
            : 0,
          hasPresetOptions,
          isLongText: isLongTextCategory(category),
          options: hasPresetOptions
            ? [{ value: "", label: "(none)" }, ...optionSet].map((opt) => ({
                value: opt.value,
                label: opt.label,
                selected: opt.value === String(clause.value ?? ""),
              }))
            : [],
        };
      });

      return {
        index,
        category,
        categoryLabel: _labelForCategory(category),
        summary: `${_labelForCategory(category)}: ${_summarizeAllRequirements([
          entry,
        ]).replace(/^Requires\s+/i, "")}`,
        operator: normalizeOp(entry.operator),
        showOperatorToggle: clauseCount > 1,
        isNumeric: isNumericCategory(category),
        clauseA: clauses[0],
        clauseB: clauses[1] ?? null,
      };
    });

    const usedCategories = new Set(requirements.map((entry) => entry.category));
    const availableCategories = CATEGORY_OPTIONS.filter(
      (option) => !usedCategories.has(option.value),
    ).map((option) => ({
      value: option.value,
      label: localize(option.labelKey, option.fallback),
    }));

    const currentTypeenum =
      normalizeRequirementString(this.item?.system?.talenttype?.typeenum) ||
      "general";
    const talentTypeOptions = TALENT_TYPE_OPTIONS.map((option) => ({
      value: option.value,
      label: localize(option.key, option.fallback),
      selected: option.value === currentTypeenum,
    }));

    const { summary, conditionSummaries } =
      _splitRequirementSummary(requirements);

    return {
      ...context,
      item: this.item,
      enrichedNotes,
      compactMode: state.compactMode,
      requirementSummary: summary,
      conditionSummaries,
      requirementRows,
      availableCategories,
      talentTypeOptions,
      talentSource: String(this.item?.flags?.[MODULE_ID]?.source ?? ""),
      hasRequirements: requirementRows.length > 0,
    };
  }

  static async _onToggleEdit(event, target) {
    this._captureDraftRequirementsFromDom();
    const state = this._getUiState();

    if (state.compactMode) {
      state.compactMode = false;
      this._setUiState(state);
      this.render();
      return;
    }

    await this._persistRequirementsFromState();
    state.compactMode = true;
    this._setUiState(state);
    this.render();
  }

  static async _onAddRequirement(event, target) {
    this._captureDraftRequirementsFromDom();
    const state = this._getUiState();
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;

    const select = root.querySelector(".sta-talent-add-select");
    const category = normalizeRequirementString(select?.value);
    if (!category) return;

    const used = new Set(state.requirements.map((entry) => entry.category));
    if (used.has(category)) return;

    const newEntry = cloneDefaultEntry(category);
    if (!newEntry) return;

    state.requirements = [...state.requirements, newEntry];
    state.compactMode = false;
    this._setUiState(state);
    this.render();
  }

  static async _onDeleteRequirement(event, target) {
    this._captureDraftRequirementsFromDom();
    const state = this._getUiState();
    const index = Number(target.dataset.index);
    if (!Number.isFinite(index)) return;

    state.requirements = state.requirements.filter((_, i) => i !== index);
    this._setUiState(state);
    this.render();
  }

  static async _onToggleOperator(event, target) {
    this._captureDraftRequirementsFromDom();
    const state = this._getUiState();
    const index = Number(target.dataset.index);
    if (!Number.isFinite(index)) return;

    const entry = state.requirements[index];
    if (!entry || maxClausesForCategory(entry.category) < 2) return;

    entry.operator = normalizeOp(entry.operator) === "AND" ? "OR" : "AND";
    this._setUiState(state);
    this.render();
  }
}
