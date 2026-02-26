/**
 * Unused Log Filter Button
 *
 * Adds a toggle button to the Character Logs section title allowing players
 * to hide mission logs that have no invoked ValueStates (i.e. values that
 * were not used during the mission).
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { getCurrentMissionLogForActor } from "../missions/mission.js";
import { logHasAnyInvokedValue } from "../values/values.js";
import { rerenderOpenStaSheetsForActorId as refreshOpenSheet } from "../sheet/sheetUtils.js";

// ── Per-actor persistence ────────────────────────────────────────────────────

const _FLAG_KEY = "hideUnusedLogs";

/**
 * Read the hide-unused-logs toggle state from the actor's flags.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function getHideUnusedLogsForActor(actor) {
  try {
    return Boolean(actor?.getFlag?.(MODULE_ID, _FLAG_KEY));
  } catch (_) {
    return false;
  }
}

/**
 * Persist the hide-unused-logs toggle state on the actor.
 *
 * @param {Actor} actor
 * @param {boolean} hidden
 * @returns {Promise<{ok:boolean, hidden:boolean}>}
 */
export async function setHideUnusedLogsForActor(actor, hidden) {
  const value = Boolean(hidden);
  if (!actor?.update) return { ok: false, hidden: value };

  try {
    const flagPath = `flags.${MODULE_ID}.${_FLAG_KEY}`;
    await actor.update({ [flagPath]: value }, { render: false });
    return { ok: true, hidden: value };
  } catch (err) {
    console.warn(
      `${MODULE_ID} | failed to persist hideUnusedLogs on actor`,
      err,
    );
    return { ok: false, hidden: value };
  }
}

// ── DOM filtering ────────────────────────────────────────────────────────────

/**
 * Apply or remove the unused-log filter on the visible log rows.
 *
 * @param {HTMLElement} root - The character sheet root element.
 * @param {Actor} actor - The actor whose logs to filter.
 * @param {boolean} hidden - Whether to hide logs with no invoked values.
 */
export function applyUnusedLogFilter(root, actor, hidden) {
  const section = root?.querySelector?.("div.section.milestones");
  if (!section) return;

  const logEntryEls = Array.from(
    section.querySelectorAll('li.row.entry[data-item-type="log"]'),
  );
  if (!logEntryEls.length) return;

  const currentMissionLogId = getCurrentMissionLogForActor(actor);

  for (const el of logEntryEls) {
    const id = el?.dataset?.itemId ? String(el.dataset.itemId) : "";
    const item = id ? actor.items.get(id) : null;

    if (!item || item.type !== "log") continue;

    // Never hide the current mission's log — it's expected to start empty.
    const isCurrentMission = currentMissionLogId && id === currentMissionLogId;

    if (hidden && !isCurrentMission && !logHasAnyInvokedValue(item)) {
      el.style.display = "none";
    } else {
      // Only clear display if we were the ones who set it; avoid interfering
      // with arc-collapse or other display overrides.
      if (el.style.display === "none" && el.dataset.staHiddenUnused === "1") {
        el.style.display = "";
      }
    }

    // Mark whether *we* hid this element so we can clean up later.
    el.dataset.staHiddenUnused =
      hidden && !isCurrentMission && !logHasAnyInvokedValue(item) ? "1" : "0";
  }
}

// ── Button installation ──────────────────────────────────────────────────────

/**
 * Update the toggle button label/icon to reflect the current state.
 *
 * @param {HTMLElement} btnEl
 * @param {boolean} hidden - Whether unused logs are currently hidden.
 */
function applyFilterButtonLabel(btnEl, hidden) {
  if (!btnEl) return;

  btnEl.innerHTML = hidden
    ? '<i class="fa-solid fa-eye-slash"></i>'
    : '<i class="fa-solid fa-eye"></i>';

  btnEl.title = hidden
    ? t("sta-officers-log.logFilter.showAll")
    : t("sta-officers-log.logFilter.hideUnused");
}

/**
 * Install the unused-log filter toggle button in the Character Logs section.
 *
 * @param {HTMLElement} root - The character sheet root element.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {HTMLElement|null} actionsContainer - The .sta-title-actions container
 *   created by installMissionLogSortButton.
 */
export function installUnusedLogFilterButton(root, actor, actionsContainer) {
  const actions = actionsContainer;
  if (!actions) return;

  const existingBtn = actions.querySelector(".sta-log-filter-unused-btn");
  const hidden = getHideUnusedLogsForActor(actor);

  if (!existingBtn) {
    const btn = document.createElement("a");
    btn.className = "sta-log-filter-unused-btn";

    applyFilterButtonLabel(btn, hidden);

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const cur = getHideUnusedLogsForActor(actor);
      const next = !cur;

      const res = await setHideUnusedLogsForActor(actor, next);

      applyFilterButtonLabel(btn, res.hidden);
      applyUnusedLogFilter(root, actor, res.hidden);

      // Keep multiple open sheets for the same character in sync.
      if (res.ok) refreshOpenSheet(actor.id);
    });

    actions.appendChild(btn);
  } else {
    // Keep label in sync across rerenders.
    applyFilterButtonLabel(existingBtn, hidden);
  }

  // Always apply filtering regardless of button freshness.
  applyUnusedLogFilter(root, actor, hidden);
}
