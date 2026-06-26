/**
 * Talent Second Requirement (Sheet Enhancement)
 *
 * Injects a second optional OR-requirement row into talent item sheets
 * for talents of type discipline, attribute, or systems.
 *
 * The second requirement is stored in the item's module flags:
 *   flags['sta-officers-log'].secondReq = { description: '', minimum: 0 }
 *
 * The injected select and number input carry proper `name` attributes
 * (flags.sta-officers-log.secondReq.description / .minimum) so Foundry's
 * built-in form submission (submitOnChange: true) saves them automatically,
 * and they receive the same form-field CSS as the system's native inputs.
 *
 * When description is empty, no second requirement is active.
 */

import { MODULE_ID } from "../core/constants.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FLAG_KEY = "secondReq";
const CONTAINER_CLASS = "sta-second-req-container";

const DESC_FIELD_NAME = `flags.${MODULE_ID}.${FLAG_KEY}.description`;
const MIN_FIELD_NAME = `flags.${MODULE_ID}.${FLAG_KEY}.minimum`;

/** Option lists keyed by talenttype.typeenum */
const OPTION_SETS = {
  discipline: [
    { value: "command", label: "sta.actor.character.discipline.command" },
    { value: "conn", label: "sta.actor.character.discipline.conn" },
    {
      value: "engineering",
      label: "sta.actor.character.discipline.engineering",
    },
    { value: "medicine", label: "sta.actor.character.discipline.medicine" },
    { value: "science", label: "sta.actor.character.discipline.science" },
    { value: "security", label: "sta.actor.character.discipline.security" },
  ],
  attribute: [
    { value: "control", label: "sta.actor.character.attribute.control" },
    { value: "daring", label: "sta.actor.character.attribute.daring" },
    { value: "fitness", label: "sta.actor.character.attribute.fitness" },
    { value: "insight", label: "sta.actor.character.attribute.insight" },
    { value: "presence", label: "sta.actor.character.attribute.presence" },
    { value: "reason", label: "sta.actor.character.attribute.reason" },
  ],
  systems: [
    {
      value: "communications",
      label: "sta.actor.starship.system.communications",
    },
    { value: "computers", label: "sta.actor.starship.system.computers" },
    { value: "engines", label: "sta.actor.starship.system.engines" },
    { value: "sensors", label: "sta.actor.starship.system.sensors" },
    { value: "structure", label: "sta.actor.starship.system.structure" },
    { value: "weapons", label: "sta.actor.starship.system.weapons" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Flag Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function getSecondReq(item) {
  const raw = item?.getFlag?.(MODULE_ID, FLAG_KEY);
  return {
    description: raw?.description ?? "",
    minimum: raw?.minimum ?? 0,
  };
}

export async function setSecondReq(item, description, minimum) {
  await item.setFlag(MODULE_ID, FLAG_KEY, {
    description: description ?? "",
    minimum: Number(minimum) || 0,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UI Injection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Installs a second OR-requirement row on a talent item sheet.
 *
 * @param {HTMLElement} root - Root element of the talent sheet
 * @param {Item} item        - The talent item
 */
export function installTalentSecondRequirement(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "talent") return;

    const typeenum = item.system?.talenttype?.typeenum;
    if (!Object.prototype.hasOwnProperty.call(OPTION_SETS, typeenum)) return;

    // Find the first requirement's inline-container inside the sheet column.
    // The column holds: .title + .inline-container (for discipline/attribute/systems).
    const firstContainer = root.querySelector(".inline-container");
    if (!(firstContainer instanceof HTMLElement)) return;

    // Avoid double-injection on re-render.
    const parent = firstContainer.parentElement;
    if (!(parent instanceof HTMLElement)) return;
    if (parent.querySelector(`.${CONTAINER_CLASS}`)) {
      // Already injected — just refresh the values.
      _refreshSecondReqValues(parent, item);
      return;
    }

    const { description, minimum } = getSecondReq(item);
    const options = OPTION_SETS[typeenum];
    const orLabel =
      game.i18n?.localize?.("sta-officers-log.talents.orLabel") ?? "or";

    const noneLbl =
      game.i18n?.localize?.("sta-officers-log.talents.noneLabel") ?? "none";

    // ── "or" separator ────────────────────────────────────────────────────────
    const orDiv = document.createElement("div");
    orDiv.className = "sta-second-req-or";
    orDiv.textContent = `— ${orLabel} —`;

    // ── second requirement container ──────────────────────────────────────────
    const container = document.createElement("div");
    container.className = `inline-container ${CONTAINER_CLASS}`;

    // Select — named so Foundry's form submission (submitOnChange) saves it.
    const select = document.createElement("select");
    select.name = DESC_FIELD_NAME;

    // Blank "none" option
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = `— ${noneLbl} —`;
    select.appendChild(noneOpt);

    for (const opt of options) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = game.i18n?.localize?.(opt.label) ?? opt.value;
      if (opt.value === description) el.selected = true;
      select.appendChild(el);
    }

    // Number input — named so Foundry's form submission saves it.
    const numInput = document.createElement("input");
    numInput.type = "number";
    numInput.name = MIN_FIELD_NAME;
    numInput.value = String(minimum);
    numInput.disabled = !description;

    // Plain text node for "+" — matches the system template exactly.
    const plusText = document.createTextNode(" +");

    container.appendChild(select);
    container.appendChild(numInput);
    container.appendChild(plusText);

    // Insert after firstContainer
    firstContainer.after(orDiv, container);

    // ── UX: toggle number field when "none" is selected ───────────────────────
    // Actual saving is handled by Foundry's submitOnChange; we only manage the
    // disabled state and reset minimum to 0 when the description is cleared.
    select.addEventListener("change", () => {
      const hasDesc = Boolean(select.value);
      numInput.disabled = !hasDesc;
      if (!hasDesc) {
        numInput.value = "0";
        // Trigger a change so the form submits minimum=0 alongside description="".
        numInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  } catch (_) {
    // ignore to not break rendering
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh helper (called when sheet re-renders without full DOM replacement)
// ─────────────────────────────────────────────────────────────────────────────

function _refreshSecondReqValues(parent, item) {
  try {
    const { description, minimum } = getSecondReq(item);
    const select = parent.querySelector(`select[name="${DESC_FIELD_NAME}"]`);
    const numInput = parent.querySelector(`input[name="${MIN_FIELD_NAME}"]`);
    if (select instanceof HTMLSelectElement) select.value = description;
    if (numInput instanceof HTMLInputElement) {
      numInput.value = String(minimum);
      numInput.disabled = !description;
    }
  } catch (_) {
    // ignore
  }
}
