/**
 * Talent Starship Type (Sheet Enhancement)
 *
 * Injects a Starship type option into the STA talent item sheet without
 * changing the core system template.
 */

const STARSHIP_OPTION_VALUE = "starship";

function _normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function installTalentStarshipType(root, item) {
  try {
    if (!(root instanceof HTMLElement)) return;
    if (!item || item.type !== "talent") return;

    const select = root.querySelector(
      'select[name="system.talenttype.typeenum"]',
    );
    if (!(select instanceof HTMLSelectElement)) return;

    const currentValue = _normalize(item.system?.talenttype?.typeenum);
    const existing = select.querySelector(
      `option[value="${STARSHIP_OPTION_VALUE}"]`,
    );
    const label =
      game.i18n?.localize?.("sta-officers-log.talents.type.starship") ??
      "Starship";

    if (existing instanceof HTMLOptionElement) {
      existing.textContent = label;
    } else {
      const option = document.createElement("option");
      option.value = STARSHIP_OPTION_VALUE;
      option.textContent = label;

      const systemsNode = select.querySelector('option[value="systems"]');
      const speciesNode = select.querySelector('option[value="species"]');
      const insertBeforeNode = speciesNode ?? null;
      if (insertBeforeNode instanceof HTMLOptionElement) {
        select.insertBefore(option, insertBeforeNode);
      } else if (systemsNode instanceof HTMLOptionElement) {
        select.insertBefore(option, systemsNode.nextSibling);
      } else {
        select.appendChild(option);
      }
    }

    if (currentValue === "starship") {
      select.value = STARSHIP_OPTION_VALUE;
    } else if (currentValue === "systems") {
      select.value = "systems";
    }
  } catch (_) {
    // ignore to avoid breaking sheet renders
  }
}
