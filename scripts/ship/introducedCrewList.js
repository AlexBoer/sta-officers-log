/**
 * Introduced Crew List — LCARS Starship Sheet
 *
 * Injects a row of portrait chips below the Crew Support track showing which
 * supporting characters have been introduced for the current mission.
 * Each chip opens that character's sheet when clicked.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { isSupervisoryChar } from "../supporting/introduceButton.js";

function _getMissionTitle() {
  try {
    return String(game.settings.get(MODULE_ID, "missionTitle") ?? "").trim();
  } catch (_) {
    return "";
  }
}

/**
 * Return all supporting-character actors that have been introduced for the
 * current mission title.  Returns an empty array when no mission is active.
 *
 * @returns {Actor[]}
 */
function _getIntroducedSupportingChars() {
  const missionTitle = _getMissionTitle();
  if (!missionTitle) return [];

  const result = [];
  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    const state = actor.getFlag?.(MODULE_ID, "missionIntroductionState");
    if (!state || typeof state !== "object") continue;
    if (state.introduced !== true) continue;
    if (String(state.missionTitle ?? "") !== missionTitle) continue;
    result.push(actor);
  }
  return result;
}

/**
 * Inject the "Introduced Crew" chip row into the LCARS starship sheet, placed
 * directly after the Crew Support track.
 *
 * Safe to call on every render — guarded by a class presence check.
 *
 * @param {HTMLElement} root       Sheet root element.
 * @param {Actor}       _shipActor The starship actor (unused but kept for
 *                                 consistency with other install* signatures).
 */
export function installIntroducedCrewList(root, _shipActor) {
  if (!root) return;
  // Guard: only inject once per render
  if (root.querySelector(".sta-officers-introduced-crew")) return;

  // Find the crew support track — insertion anchor
  const crewTrack = root
    .querySelector("#bar-crew-renderer")
    ?.closest?.(".track");
  if (!crewTrack) return;

  const chars = _getIntroducedSupportingChars();

  // Container
  const container = document.createElement("div");
  container.className = "sta-officers-introduced-crew";

  // Label — reuse `.tracktitle` class so it inherits LCARS lavender colour
  const heading = document.createElement("div");
  heading.className = "tracktitle";
  heading.textContent =
    t("sta-officers-log.supporting.introducedCrewTitle") || "Introduced Crew";

  // Chip row
  const list = document.createElement("div");
  list.className = "sta-officers-introduced-crew-list";

  if (chars.length === 0) {
    const empty = document.createElement("span");
    empty.className = "sta-officers-introduced-crew-empty";
    empty.textContent =
      t("sta-officers-log.supporting.introducedCrewEmpty") || "—";
    list.appendChild(empty);
  } else {
    for (const actor of chars) {
      const chip = document.createElement("button");
      chip.type = "button";
      const isSupervisor = isSupervisoryChar(actor);
      chip.className =
        "sta-officers-crew-chip" +
        (isSupervisor ? " sta-officers-crew-chip--supervisor" : "");
      chip.title = actor.name ?? "";
      chip.dataset.actorId = actor.id;

      const img = document.createElement("img");
      img.src = actor.img ?? "icons/svg/mystery-man.svg";
      img.alt = actor.name ?? "";
      img.draggable = false;

      const nameEl = document.createElement("span");
      nameEl.textContent = actor.name ?? "";

      chip.appendChild(img);
      chip.appendChild(nameEl);

      if (isSupervisor) {
        const badge = document.createElement("span");
        badge.className = "sta-officers-crew-chip-badge";
        badge.title = t("sta-officers-log.supporting.supervisoryCharTooltip");
        badge.textContent = "S";
        chip.appendChild(badge);
      }

      chip.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        actor.sheet?.render(true);
      });

      list.appendChild(chip);
    }
  }

  container.appendChild(heading);
  container.appendChild(list);

  // Insert directly after the crew support track
  crewTrack.insertAdjacentElement("afterend", container);
}
