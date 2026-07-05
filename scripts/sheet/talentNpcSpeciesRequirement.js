/**
 * Talent NPC Species Requirement (Sheet Enhancement)
 *
 * Adds an optional species field to NPC talents without changing STA core schema.
 * Data is stored in module flags:
 *   flags['sta-officers-log'].npcRequirement.species = "Vulcan"
 */

import { MODULE_ID } from "../core/constants.js";

const FLAG_KEY = "npcRequirement";
const CONTAINER_CLASS = "sta-npc-species-req-container";
const SPECIES_FIELD_NAME = `flags.${MODULE_ID}.${FLAG_KEY}.species`;

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

function getNpcSpeciesRequirement(item) {
  return String(item?.getFlag?.(MODULE_ID, FLAG_KEY)?.species ?? "").trim();
}

/**
 * Installs an optional species requirement input for NPC talents.
 *
 * @param {HTMLElement} root - Root element of the talent sheet
 * @param {Item} item - The talent item
 */
export function installTalentNpcSpeciesRequirement(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "talent") return;

    const typeenum = normalize(item.system?.talenttype?.typeenum);

    const typeSelect = root.querySelector(
      'select[name="system.talenttype.typeenum"]',
    );
    if (!(typeSelect instanceof HTMLSelectElement)) return;

    const row = typeSelect.closest(".row");
    if (!(row instanceof HTMLElement)) return;

    row.classList.remove("sta-npc-species-row");

    const targetColumn = row.querySelector(".column");
    if (!(targetColumn instanceof HTMLElement)) return;

    const existing = targetColumn.querySelector(`.${CONTAINER_CLASS}`);
    if (existing instanceof HTMLElement) {
      existing.remove();
    }

    if (typeenum !== "npc") return;

    row.classList.add("sta-npc-species-row");

    const titleText =
      game.i18n?.localize?.("sta-officers-log.talents.npcSpeciesTitle") ??
      "Requires Species (optional)";
    const placeholder =
      game.i18n?.localize?.("sta-officers-log.talents.npcSpeciesPlaceholder") ??
      "Any NPC species";
    const hintText =
      game.i18n?.localize?.("sta-officers-log.talents.npcSpeciesHint") ??
      "Leave blank to allow any NPC species.";

    const speciesValue = getNpcSpeciesRequirement(item);

    const container = document.createElement("div");
    container.className = CONTAINER_CLASS;

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = titleText;

    const input = document.createElement("input");
    input.type = "text";
    input.name = SPECIES_FIELD_NAME;
    input.value = speciesValue;
    input.placeholder = placeholder;

    const hint = document.createElement("div");
    hint.className = "sta-npc-species-req-hint";
    hint.textContent = hintText;

    container.appendChild(title);
    container.appendChild(input);
    container.appendChild(hint);

    targetColumn.appendChild(container);
  } catch (_) {
    // ignore to avoid breaking sheet renders
  }
}
