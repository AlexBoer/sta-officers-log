/**
 * Mission Log Sort Button
 *
 * Adds a sort mode toggle button to the Character Logs section title,
 * allowing users to switch between created/alpha/chain/custom sort modes.
 */

import {
  canCurrentUserChangeActor,
  rerenderOpenStaSheetsForActorId as refreshOpenSheet,
} from "./sheetUtils.js";
import {
  applyMissionLogSorting,
  getMissionLogSortModeForActor,
  setMissionLogSortModeForActor,
} from "./logSorting.js";

/**
 * Apply the appropriate label and icon to a sort button based on the current mode.
 *
 * @param {HTMLElement} btnEl - The button element to update.
 * @param {string} mode - The sort mode ("created", "alpha", "chain", or "custom").
 */
function applyMissionLogSortButtonLabel(btnEl, mode) {
  if (!btnEl) return;
  const m = String(mode ?? "created");

  // Use innerHTML so we can render a compact icon for A→Z.
  btnEl.innerHTML =
    m === "alpha"
      ? 'Sort: A⮕Z <i class="fa-solid fa-arrow-down-a-z"></i>'
      : m === "chain"
        ? 'Sort: Chain <i class="fa-solid fa-link"></i>'
        : m === "custom"
          ? 'Sort: Custom <i class="fa-solid fa-list"></i>'
          : 'Sort: Date <i class="fa-solid fa-calendar-day"></i>';

  btnEl.title =
    m === "alpha"
      ? "Mission Log sort: Alphabetical Order"
      : m === "chain"
        ? "Mission Log sort: Chain Order"
        : m === "custom"
          ? "Mission Log sort: Custom Order"
          : "Mission Log sort: Creation Order";
}

/**
 * Ensure the actions container exists in the logs section title.
 *
 * @param {HTMLElement} logsTitleEl - The title element of the logs section.
 * @returns {HTMLElement|null} The actions container, or null if the title element is missing.
 */
function ensureActionsContainer(logsTitleEl) {
  if (!logsTitleEl) return null;
  logsTitleEl.classList.add("sta-values-title-with-button");

  let actions = logsTitleEl.querySelector(":scope > .sta-title-actions");
  if (!actions) {
    actions = document.createElement("span");
    actions.className = "sta-title-actions";

    // If a previous render appended buttons directly, adopt them.
    const existingBtns = Array.from(
      logsTitleEl.querySelectorAll(":scope > a.sta-log-sort-btn"),
    );
    for (const b of existingBtns) actions.appendChild(b);

    logsTitleEl.appendChild(actions);
  }

  return actions;
}

/**
 * Install the mission log sort button in the Character Logs section.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @returns {HTMLElement|null} The actions container for use by other buttons.
 */
export function installMissionLogSortButton(root, actor) {
  // Find the logs section title
  const anyLogEntry = root.querySelector(
    'div.section.milestones li.row.entry[data-item-type="log"]',
  );
  const logsSection = anyLogEntry?.closest?.("div.section") ?? null;
  const logsTitleEl = logsSection
    ? logsSection.querySelector(":scope > div.title") ||
      logsSection.querySelector("div.title")
    : null;

  const actions = ensureActionsContainer(logsTitleEl);

  if (actions) {
    const canChange = canCurrentUserChangeActor(actor);
    const existingBtn = actions.querySelector(".sta-log-sort-btn");

    // Hide for non-owners.
    if (!canChange) {
      existingBtn?.remove?.();
    } else if (!existingBtn) {
      const btn = document.createElement("a");
      btn.className = "sta-log-sort-btn";

      const updateLabel = (modeOverride) => {
        const mode = modeOverride ?? getMissionLogSortModeForActor(actor);
        applyMissionLogSortButtonLabel(btn, mode);
      };

      updateLabel();

      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const cur = getMissionLogSortModeForActor(actor);
        const next =
          cur === "created"
            ? "alpha"
            : cur === "alpha"
              ? "chain"
              : cur === "chain"
                ? "custom"
                : "created";

        // Persist on the actor (per character). If this fails for some reason,
        // still apply locally so the user sees an immediate effect.
        const res = await setMissionLogSortModeForActor(actor, next);

        if (!res.ok) {
          ui?.notifications?.warn?.(
            "Couldn't save Mission Log sort preference for this character.",
          );
        }

        updateLabel(res.mode);
        applyMissionLogSorting(root, actor, res.mode);

        // Keep multiple open sheets for the same character in sync.
        if (res.ok) refreshOpenSheet(actor.id);
      });

      actions.appendChild(btn);
    } else {
      // Keep label in sync (in case another hook sets state before render)
      applyMissionLogSortButtonLabel(
        existingBtn,
        getMissionLogSortModeForActor(actor),
      );
    }
  }

  // Always apply sorting regardless of button presence
  applyMissionLogSorting(root, actor, getMissionLogSortModeForActor(actor));

  return actions;
}
