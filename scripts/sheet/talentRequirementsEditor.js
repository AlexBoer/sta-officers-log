import { MODULE_ID } from "../core/constants.js";
import {
  getNormalizedTalentRequirements,
  normalizeRequirementString,
  TALENT_REQUIREMENTS_FLAG_KEY,
} from "../core/talentRequirements.js";

const ROOT_CLASS = "sta-talent-req-editor";
const LIST_CLASS = "sta-talent-req-list";
const ADD_SELECT_CLASS = "sta-talent-req-add-select";
const ADD_BUTTON_CLASS = "sta-talent-req-add-btn";
const _editorUiStateByItemKey = new Map();

const CATEGORY_OPTIONS = [
  {
    value: "attribute",
    labelKey: "sta-officers-log.talents.requirements.category.attribute",
    label: "Attributes",
  },
  {
    value: "discipline",
    labelKey: "sta-officers-log.talents.requirements.category.discipline",
    label: "Departments",
  },
  {
    value: "systems",
    labelKey: "sta-officers-log.talents.requirements.category.systems",
    label: "Systems",
  },
  {
    value: "species",
    labelKey: "sta-officers-log.talents.requirements.category.species",
    label: "Species",
  },
  {
    value: "house",
    labelKey: "sta-officers-log.talents.requirements.category.house",
    label: "House",
  },
  {
    value: "condition",
    labelKey: "sta-officers-log.talents.requirements.category.condition",
    label: "Condition",
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

const localize = (key, fallback) => {
  if (game.i18n?.has?.(key)) return game.i18n.localize(key);
  return fallback ?? key;
};

function _getItemEditorStateKey(item) {
  return String(item?.uuid ?? item?.id ?? "").trim();
}

function _rememberEditorUiState(item, state) {
  const key = _getItemEditorStateKey(item);
  if (!key || !state) return;
  _editorUiStateByItemKey.set(key, {
    compactMode: Boolean(state.compactMode),
  });
}

function _restoreEditorUiState(item) {
  const key = _getItemEditorStateKey(item);
  const remembered = key ? _editorUiStateByItemKey.get(key) : null;

  return {
    compactMode: remembered?.compactMode ?? true,
  };
}

function _labelForCategory(category) {
  const option = CATEGORY_OPTIONS.find((c) => c.value === category);
  if (!option) return category;
  return localize(option.labelKey, option.label);
}

function _labelForClauseValue(category, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const options = getOptionSet(category);
  if (!options.length) return raw;
  return options.find((o) => o.value === raw)?.label ?? raw;
}

function _summarizeClause(category, clause) {
  const value = String(clause?.value ?? "").trim();
  if (!value) return "";
  const label = _labelForClauseValue(category, value);
  if (!isNumericCategory(category)) return label;
  const min = Number(clause?.minimum);
  const minimum = Number.isFinite(min) ? min : 0;
  if (minimum > 0) return `${label} ${minimum}`;
  return label;
}

function _summarizeEntry(entry) {
  const category = normalizeRequirementString(entry?.category);
  if (!category) return "";

  const clauses = (Array.isArray(entry?.clauses) ? entry.clauses : [])
    .map((clause) => _summarizeClause(category, clause))
    .filter(Boolean);
  const operator = normalizeOp(entry?.operator);
  const values = clauses.length ? clauses.join(` ${operator} `) : "(none)";
  return `${_labelForCategory(category)}: ${values}`;
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

  if (!parts.length) return "No requirements.";
  return `Requires ${parts.join(", ")}`;
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

function createEl(tag, className = "", text = "") {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function createSelect(options, selected) {
  const select = document.createElement("select");
  for (const option of options) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = option.label;
    if (option.value === selected) el.selected = true;
    select.appendChild(el);
  }
  return select;
}

function sanitizeEntry(entry) {
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

function buildEntryRow(entry, index) {
  const category = entry.category;
  const clauseCount = maxClausesForCategory(category);
  const row = createEl("div", "sta-talent-req-row");
  row.dataset.index = String(index);

  const header = createEl("div", "sta-talent-req-row-head");
  const summary = createEl(
    "div",
    "sta-talent-req-row-summary",
    _summarizeEntry(entry),
  );

  const actions = createEl("div", "sta-talent-req-row-actions");
  const del = createEl("button", "sta-talent-req-delete", "Delete");
  del.type = "button";
  del.dataset.action = "delete";

  actions.append(del);
  header.append(summary, actions);

  const body = createEl("div", "sta-talent-req-row-body");

  const clauseContainer = createEl("div", "sta-talent-req-clauses");
  const options = getOptionSet(category);
  const clauseRows = [];

  for (let i = 0; i < clauseCount; i += 1) {
    const clause = entry.clauses[i] ?? { value: "", minimum: 0 };
    const clauseRow = createEl("div", "sta-talent-req-clause");

    let valueInput;
    if (options.length) {
      const selectOptions = [{ value: "", label: "(none)" }, ...options];
      valueInput = createSelect(selectOptions, clause.value);
    } else if (isLongTextCategory(category)) {
      valueInput = document.createElement("textarea");
      valueInput.className = "sta-talent-req-condition";
      valueInput.rows = 2;
      valueInput.value = clause.value ?? "";
      valueInput.placeholder = "Describe the condition…";
    } else {
      valueInput = document.createElement("input");
      valueInput.type = "text";
      valueInput.value = clause.value ?? "";
      valueInput.placeholder =
        category === "species" ? "e.g. Vulcan, Augment, Cyborg" : "Requirement";
    }
    valueInput.dataset.field = "value";
    valueInput.dataset.clauseIndex = String(i);
    clauseRow.appendChild(valueInput);

    if (isNumericCategory(category)) {
      const minInput = document.createElement("input");
      minInput.type = "number";
      minInput.value = String(Number(clause.minimum) || 0);
      minInput.min = "0";
      minInput.dataset.field = "minimum";
      minInput.dataset.clauseIndex = String(i);
      clauseRow.appendChild(minInput);

      const suffix = createEl("span", "sta-talent-req-suffix", "+");
      clauseRow.appendChild(suffix);
    }

    clauseRows.push(clauseRow);
  }

  if (clauseCount > 1) {
    const opToggle = createEl(
      "button",
      "sta-talent-req-op-toggle",
      normalizeOp(entry.operator),
    );
    opToggle.type = "button";
    opToggle.dataset.field = "operator";
    opToggle.dataset.action = "toggle-operator";
    opToggle.value = normalizeOp(entry.operator);
    opToggle.dataset.value = opToggle.value;
    clauseContainer.append(clauseRows[0], opToggle, clauseRows[1]);
  } else {
    clauseContainer.append(clauseRows[0]);
  }

  body.append(clauseContainer);
  row.append(header, body);
  return row;
}

function injectStyles(root) {
  if (root.querySelector("style[data-sta-talent-req-editor]")) return;
  const style = document.createElement("style");
  style.dataset.staTalentReqEditor = "true";
  style.textContent = `
.${ROOT_CLASS} { margin-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.6rem; }
.${ROOT_CLASS} .sta-talent-req-compact { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; margin-bottom:0.6rem; }
.${ROOT_CLASS} .sta-talent-req-compact-summary { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.${ROOT_CLASS} .sta-talent-req-condition-summary { font-weight:600; margin-top:0.3rem; white-space:normal; overflow-wrap:anywhere; }
.${ROOT_CLASS} .sta-talent-req-edit-panel[hidden] { display:none !important; }
.${ROOT_CLASS} .sta-talent-req-controls { display:flex; gap:0.4rem; align-items:center; margin-bottom:0.6rem; }
.${ROOT_CLASS} .${ADD_SELECT_CLASS} { flex:1; }
.${ROOT_CLASS} .${LIST_CLASS} { display:flex; flex-direction:column; gap:0.5rem; }
.${ROOT_CLASS} .sta-talent-req-row { border:1px solid rgba(255,255,255,0.12); border-radius:6px; padding:0.45rem; }
.${ROOT_CLASS} .sta-talent-req-row-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem; }
.${ROOT_CLASS} .sta-talent-req-row-summary { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:0.6rem; }
.${ROOT_CLASS} .sta-talent-req-row-actions { display:flex; gap:0.3rem; align-items:center; }
.${ROOT_CLASS} .sta-talent-req-row-body { display:flex; flex-wrap:wrap; align-items:center; gap:0.35rem; }
.${ROOT_CLASS} .sta-talent-req-clauses { display:flex; flex:1 1 32rem; gap:0.35rem; min-width:20rem; align-items:center; }
.${ROOT_CLASS} .sta-talent-req-clause { display:flex; flex:1 1 0; min-width:0; gap:0.35rem; align-items:center; }
.${ROOT_CLASS} .sta-talent-req-clause > input[type="text"],
.${ROOT_CLASS} .sta-talent-req-clause > select { flex:1; min-width:0; }
.${ROOT_CLASS} .sta-talent-req-clause > input[type="number"] { width:3.5rem; }
.${ROOT_CLASS} .sta-talent-req-clause > textarea.sta-talent-req-condition { flex:1; min-width:0; width:100%; resize:vertical; }
.${ROOT_CLASS} .sta-talent-req-op-toggle {
  flex:0 0 auto;
  width:3.1rem;
  min-width:3.1rem;
  height:1.8rem;
  padding:0 0.45rem;
  font-size:0.85rem;
  font-weight:600;
}

@media (max-width: 860px) {
  .${ROOT_CLASS} .sta-talent-req-row-body { flex-direction:column; align-items:stretch; }
  .${ROOT_CLASS} .sta-talent-req-clauses { min-width:0; width:100%; }
}
`;
  root.appendChild(style);
}

function getEditorState(root) {
  const state = root.__staTalentReqEditorState;
  if (!state) return null;
  return state;
}

function setEditorState(root, state) {
  root.__staTalentReqEditorState = state;
}

function renderEditor(root, item) {
  const state = getEditorState(root);
  if (!state) return;

  if (state.summaryEl instanceof HTMLElement) {
    const { summary, conditionSummaries } = _splitRequirementSummary(
      state.requirements,
    );
    state.summaryEl.textContent = summary;
    if (state.conditionsEl instanceof HTMLElement) {
      state.conditionsEl.replaceChildren(
        ...conditionSummaries.map((text) =>
          createEl("div", "sta-talent-req-condition-summary", text),
        ),
      );
    }
  }
  if (state.editToggle instanceof HTMLButtonElement) {
    state.editToggle.textContent = state.compactMode ? "Edit" : "Done";
  }
  if (state.editPanel instanceof HTMLElement) {
    state.editPanel.hidden = Boolean(state.compactMode);
  }

  const list = state.container.querySelector(`.${LIST_CLASS}`);
  const addSelect = state.container.querySelector(`.${ADD_SELECT_CLASS}`);
  if (
    !(list instanceof HTMLElement) ||
    !(addSelect instanceof HTMLSelectElement)
  ) {
    return;
  }

  list.innerHTML = "";
  for (let i = 0; i < state.requirements.length; i += 1) {
    const entry = state.requirements[i];
    list.appendChild(buildEntryRow(entry, i));
  }

  const used = new Set(state.requirements.map((entry) => entry.category));
  const available = CATEGORY_OPTIONS.filter(
    (option) => !used.has(option.value),
  );
  addSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = localize(
    "sta-officers-log.talents.addRequirementCategory",
    "Add Requirement Category",
  );
  addSelect.appendChild(placeholder);

  for (const option of available) {
    const el = document.createElement("option");
    el.value = option.value;
    el.textContent = localize(option.labelKey, option.label);
    addSelect.appendChild(el);
  }

  state.addButton.disabled = !available.length;
  if (!available.length) {
    addSelect.value = "";
    addSelect.disabled = true;
  } else {
    addSelect.disabled = false;
  }
}

function readRequirementsFromDom(root) {
  const state = getEditorState(root);
  if (!state) return [];

  const rows = Array.from(
    state.container.querySelectorAll(".sta-talent-req-row"),
  );
  const output = [];

  for (const row of rows) {
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) continue;
    const baseEntry = state.requirements[index];
    if (!baseEntry) continue;

    const category = baseEntry.category;
    const operatorEl = row.querySelector('[data-field="operator"]');
    const operator = normalizeOp(
      operatorEl?.value ?? operatorEl?.dataset?.value,
    );
    const clauseCount = maxClausesForCategory(category);

    const clauses = [];
    for (let clauseIndex = 0; clauseIndex < clauseCount; clauseIndex += 1) {
      const valueEl = row.querySelector(
        `[data-field="value"][data-clause-index="${clauseIndex}"]`,
      );
      const value = String(valueEl?.value ?? "").trim();
      if (!value) continue;

      const clause = { value };
      if (isNumericCategory(category)) {
        const minEl = row.querySelector(
          `[data-field="minimum"][data-clause-index="${clauseIndex}"]`,
        );
        const minimum = Number(minEl?.value);
        clause.minimum = Number.isFinite(minimum) ? minimum : 0;
      }
      clauses.push(clause);
    }

    const sanitized = sanitizeEntry({ category, operator, clauses });
    if (sanitized) output.push(sanitized);
  }

  return output;
}

async function persistRequirements(root, item) {
  const state = getEditorState(root);
  if (!state) return;

  const requirements = readRequirementsFromDom(root);
  state.requirements = requirements;

  // Requirements are stored independently of the talent type, which is set by
  // the talent type dropdown, not derived from requirements.
  await item.update({
    [`flags.${MODULE_ID}.${TALENT_REQUIREMENTS_FLAG_KEY}`]: requirements,
  });
}

function wireEditorEvents(root, item) {
  const state = getEditorState(root);
  if (!state) return;

  state.addButton.addEventListener("click", async () => {
    const category = normalizeRequirementString(state.addSelect.value);
    if (!category) return;

    const newEntry = cloneDefaultEntry(category);
    if (!newEntry) return;

    state.requirements = [...state.requirements, newEntry];
    state.compactMode = false;
    _rememberEditorUiState(item, state);
    renderEditor(root, item);
  });

  state.container.addEventListener("click", async (event) => {
    const compactBtn = event.target?.closest?.(
      "button[data-action='compact-toggle']",
    );
    if (compactBtn instanceof HTMLButtonElement) {
      if (state.compactMode) {
        state.compactMode = false;
        _rememberEditorUiState(item, state);
        renderEditor(root, item);
        return;
      }

      await persistRequirements(root, item);
      state.compactMode = true;
      _rememberEditorUiState(item, state);
      renderEditor(root, item);
      return;
    }

    const opToggleBtn = event.target?.closest?.(
      "button[data-action='toggle-operator']",
    );
    if (opToggleBtn instanceof HTMLButtonElement) {
      const next = opToggleBtn.value === "AND" ? "OR" : "AND";
      opToggleBtn.value = next;
      opToggleBtn.dataset.value = next;
      opToggleBtn.textContent = next;
      await persistRequirements(root, item);
      return;
    }

    const button = event.target?.closest?.("button[data-action='delete']");
    if (!(button instanceof HTMLButtonElement)) return;

    const row = button.closest(".sta-talent-req-row");
    const index = Number(row?.dataset?.index);
    if (!Number.isFinite(index)) return;

    state.requirements = state.requirements.filter((_, i) => i !== index);
    _rememberEditorUiState(item, state);
    renderEditor(root, item);
    await persistRequirements(root, item);
  });

  const queuePersist = (() => {
    let handle = null;
    return () => {
      if (handle) clearTimeout(handle);
      handle = setTimeout(async () => {
        handle = null;
        await persistRequirements(root, item);
      }, 120);
    };
  })();

  state.container.addEventListener("change", (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;

    // Free-typing fields save on explicit actions (e.g. Done) to avoid rerender while typing.
    if (el instanceof HTMLTextAreaElement) return;
    if (el instanceof HTMLInputElement) {
      if (el.type === "text" || el.type === "number") return;
    }

    queuePersist();
  });
}

export function installTalentRequirementsEditor(root, item, app = null) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "talent") return;

    const typeRow = root
      .querySelector('select[name="system.talenttype.typeenum"]')
      ?.closest(".row");
    if (!(typeRow instanceof HTMLElement)) return;

    injectStyles(root);

    // Persist in-progress (free-text) edits when the sheet closes, so they
    // aren't lost if the user closes without pressing Done. Registered once.
    if (app && !app.__staReqEditorCloseHook) {
      app.__staReqEditorCloseHook = true;
      const closeHandler = async (closingApp) => {
        if (closingApp !== app) return;
        Hooks.off("closeApplicationV2", closeHandler);
        try {
          const curRoot =
            app.element instanceof HTMLElement ? app.element : root;
          if (getEditorState(curRoot)) await persistRequirements(curRoot, item);
        } catch (_) {
          // ignore
        }
      };
      Hooks.on("closeApplicationV2", closeHandler);
    }

    const existing = root.querySelector(`.${ROOT_CLASS}`);
    if (existing instanceof HTMLElement) {
      existing.remove();
    }

    const container = createEl("div", ROOT_CLASS);

    const compact = createEl("div", "sta-talent-req-compact");
    const compactSummary = createEl("div", "sta-talent-req-compact-summary");
    const compactToggle = createEl("button", "button", "Edit");
    compactToggle.type = "button";
    compactToggle.dataset.action = "compact-toggle";
    compact.append(compactSummary, compactToggle);

    const compactConditions = createEl("div", "sta-talent-req-conditions");

    const editPanel = createEl("div", "sta-talent-req-edit-panel");

    const controls = createEl("div", "sta-talent-req-controls");
    const addSelect = createEl("select", ADD_SELECT_CLASS);
    const addButton = createEl(
      "button",
      `button ${ADD_BUTTON_CLASS}`,
      localize("sta-officers-log.talents.addButton", "Add"),
    );
    addButton.type = "button";
    controls.append(addSelect, addButton);

    const list = createEl("div", LIST_CLASS);
    editPanel.append(controls, list);
    container.append(compact, compactConditions, editPanel);

    typeRow.style.display = "none";
    typeRow.after(container);

    const requirements = getNormalizedTalentRequirements(item).map((entry) => ({
      ...entry,
      clauses: [...entry.clauses, { value: "", minimum: 0 }].slice(
        0,
        maxClausesForCategory(entry.category),
      ),
    }));
    const uiState = _restoreEditorUiState(item);

    setEditorState(root, {
      container,
      addSelect,
      addButton,
      summaryEl: compactSummary,
      conditionsEl: compactConditions,
      editToggle: compactToggle,
      editPanel,
      requirements,
      compactMode: uiState.compactMode,
    });

    renderEditor(root, item);
    wireEditorEvents(root, item);
  } catch (_) {
    // ignore to avoid breaking item sheets
  }
}
