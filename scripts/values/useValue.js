/**
 * Use Value Button & Dialog
 *
 * Adds a "Use Value" button to each value entry on character sheets,
 * allowing players to invoke values (positive/negative/challenge) with
 * GM approval workflow for negative/challenge usage.
 */

import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import { getModuleSocket } from "../core/socket.js";
import { getCurrentMissionLogIdForUser } from "../missions/mission.js";
import {
  isValueChallenged,
  setValueChallenged,
  mergeValueStateArray,
} from "./values.js";
import { isValueTrauma } from "./trauma/trauma.js";
import {
  gainDetermination,
  spendDetermination,
  promptCallbackForActorAsGM,
  sendCallbackPromptToUser,
} from "../callback/gmFlow.js";
import { getUserIdForCharacterActor } from "../core/utils.js";
import { hasEligibleCallbackTargetForValueId } from "../callback/callbackEligibility.js";
import { shouldHideChallengedToggle } from "../settings/clientSettings.js";

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Crit Value Use (sta-utils integration)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle "Before Roll: Auto-Crit" value use via the sta-utils dice pool API.
 *
 * Opens the sta-utils dice pool dialog (pre-selecting the value being used),
 * then — if the user completes the roll — applies the normal positive value-use
 * side effects (spend determination, trauma stress, log recording, callback).
 *
 * @param {object}  opts
 * @param {Actor}   opts.actor      – The actor using the value.
 * @param {Item}    opts.valueItem  – The value item being used.
 * @returns {Promise<void>}
 */
export async function handleAutoCritValueUse({ actor, valueItem } = {}) {
  const dicePool = game.staUtils?.dicePool;
  if (!dicePool?.rollTask) {
    ui.notifications?.error("sta-utils dice pool API is not available.");
    return;
  }

  // Open the sta-utils dice pool dialog with the value pre-selected in the
  // determination dropdown (sta-officers-log replaces the checkbox with a
  // value picker; passing the item ID pre-selects it).
  const result = await dicePool.rollTask({
    actor,
    determination: valueItem.id,
  });

  // User cancelled the dialog — no cost, no effects.
  if (!result) return;

  // Roll completed — apply positive value-use side effects.
  await useValue({ actor, valueItemId: valueItem.id, useType: "positive" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Debounced Render Helper
// ─────────────────────────────────────────────────────────────────────────────

// Debounce state for sheet renders
const _pendingRenders = new WeakMap();
const RENDER_DEBOUNCE_MS = 50;

/**
 * Schedule a debounced render for an application.
 * Multiple rapid calls will be coalesced into one render.
 * @param {Application} app - The application to render
 */
function scheduleRender(app) {
  if (!app?.render) return;

  const existing = _pendingRenders.get(app);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    _pendingRenders.delete(app);
    try {
      app.render({ force: false, focus: false });
    } catch (_) {
      // app may have closed
    }
  }, RENDER_DEBOUNCE_MS);

  _pendingRenders.set(app, timer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Value Dialog (ApplicationV2)
// ─────────────────────────────────────────────────────────────────────────────

const _UseValueBase = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

class UseValueApp extends _UseValueBase {
  constructor(
    {
      valueName = "",
      prompt = "",
      chooseLabel = "Choose",
      options = [],
      resolve = null,
    } = {},
    appOptions = {},
  ) {
    super(appOptions);
    this._valueName = valueName;
    this._prompt = prompt;
    this._chooseLabel = chooseLabel;
    this._options = Array.isArray(options) ? options : [];
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-use-value`,
    window: { title: "Use Value" },
    classes: ["sta-officers-log", "use-value"],
    position: { width: 920, height: "auto" },
    resizable: false,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/use-value.hbs`,
    },
  };

  get title() {
    const v = this._valueName ? String(this._valueName) : "";
    return v ? `Use Value: ${v}` : "Use Value";
  }

  async _prepareContext(_options) {
    return {
      prompt: this._prompt,
      chooseLabel: this._chooseLabel,
      options: this._options,
    };
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error("sta-officers-log | UseValueApp resolve failed", err);
    }
  }

  async close(options = {}) {
    // If the window is closed via X, treat it as cancel.
    this._resolveOnce(null);
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, _options) {
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    // Prevent duplicate bindings on the same DOM node
    if (root.dataset.staUseValueBound === "1") return;
    root.dataset.staUseValueBound = "1";

    root.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action]");
      if (!(btn instanceof HTMLButtonElement)) return;
      if (btn.disabled) return;

      ev.preventDefault();
      ev.stopPropagation();

      const action = btn.getAttribute("data-action");
      this._resolveOnce(action);
      await super.close();
    });
  }
}

/**
 * Prompt the user to choose how to use a value (positive/negative/challenge).
 *
 * @param {object} options
 * @param {string} options.valueName - The name of the value being used.
 * @param {boolean} options.canChoosePositive - Whether positive usage is allowed.
 * @param {boolean} options.isTrauma - Whether the value is a trauma.
 * @param {number} options.traumaStressAmount - Stress cost for trauma positive usage.
 * @returns {Promise<string|null>} The chosen action or null if cancelled.
 */
export async function promptUseValueChoice({
  valueName,
  canChoosePositive = true,
  isTrauma = false,
  traumaStressAmount = 1,
}) {
  const staUtilsActive = game.modules.get("sta-utils")?.active;

  return new Promise((resolve) => {
    const positiveOption = {
      action: "positive",
      title: t("sta-officers-log.dialog.useValue.positiveTitle"),
      description: isTrauma
        ? tf("sta-officers-log.dialog.useTrauma.positiveDesc", {
            stress: traumaStressAmount,
          })
        : t("sta-officers-log.dialog.useValue.positiveDesc"),
      disabled: !canChoosePositive,
      buttonLabel: canChoosePositive ? null : "No Determination!",
    };

    // When sta-utils is active, split the positive button into two variants.
    if (staUtilsActive) {
      positiveOption.buttons = [
        {
          action: "positive",
          label: "After Roll: Reroll Dice",
          disabled: !canChoosePositive,
        },
        {
          action: "positive-crit",
          label: "Before Roll: Auto-Crit",
          disabled: !canChoosePositive,
        },
      ];
    }

    const app = new UseValueApp({
      valueName,
      prompt: tf(
        isTrauma
          ? "sta-officers-log.dialog.useTrauma.prompt"
          : "sta-officers-log.dialog.useValue.prompt",
        { value: valueName ?? "" },
      ),
      chooseLabel: t("sta-officers-log.dialog.useValue.choose"),
      options: [
        positiveOption,
        {
          action: "negative",
          title: t("sta-officers-log.dialog.useValue.negativeTitle"),
          description: t(
            isTrauma
              ? "sta-officers-log.dialog.useTrauma.negativeDesc"
              : "sta-officers-log.dialog.useValue.negativeDesc",
          ),
          buttonLabel: t("sta-officers-log.dialog.useValue.negativeButton"),
        },
        {
          action: "challenge",
          title: t("sta-officers-log.dialog.useValue.challengeTitle"),
          description: t(
            isTrauma
              ? "sta-officers-log.dialog.useTrauma.challengeDesc"
              : "sta-officers-log.dialog.useValue.challengeDesc",
          ),
          buttonLabel: t("sta-officers-log.dialog.useValue.challengeButton"),
        },
      ],
      resolve,
    });
    app.render(true);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Programmatic Value Use  (Public API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid use-type strings accepted by {@link useValue}.
 * @type {ReadonlySet<string>}
 */
const VALID_USE_TYPES = Object.freeze(
  new Set(["positive", "negative", "challenge"]),
);

/**
 * Programmatically use a Value on a character — the equivalent of a user
 * clicking the "Use Value" button and choosing positive / negative / challenge.
 *
 * This is the **public API** intended for other modules to integrate with
 * Officers Log.  It runs the full flow: determination adjustment, stress
 * changes (trauma), value-state recording on the current mission log, GM
 * approval (for player-initiated negative/challenge), and callback
 * eligibility prompting.
 *
 * @param {object}          opts
 * @param {Actor|string}    opts.actor        – The character Actor instance,
 *                                              or a UUID string that resolves
 *                                              to one.
 * @param {string}          opts.valueItemId  – The `id` of the value Item on
 *                                              the actor.
 * @param {"positive"|"negative"|"challenge"} opts.useType
 *        How the value is being used.
 *
 * @returns {Promise<{success:boolean, valueState?:string, reason?:string}>}
 *   Resolves with `{ success: true, valueState }` on success, or
 *   `{ success: false, reason }` if the use could not be completed.
 */
export async function useValue({ actor, valueItemId, useType } = {}) {
  // ── Resolve actor ────────────────────────────────────────────────────────
  if (typeof actor === "string") {
    try {
      actor = await fromUuid(actor);
    } catch (_) {
      return { success: false, reason: "actor-uuid-invalid" };
    }
  }
  if (!actor || typeof actor.update !== "function") {
    return { success: false, reason: "actor-missing" };
  }

  // ── Validate useType ─────────────────────────────────────────────────────
  if (!VALID_USE_TYPES.has(useType)) {
    return {
      success: false,
      reason: `invalid-use-type: expected positive|negative|challenge, got "${useType}"`,
    };
  }

  // ── Look up value item ───────────────────────────────────────────────────
  const valueItem = valueItemId ? actor.items.get(String(valueItemId)) : null;
  if (!valueItem || valueItem.type !== "value") {
    return { success: false, reason: "value-item-not-found" };
  }

  // ── Guards ───────────────────────────────────────────────────────────────
  if (isValueChallenged(valueItem)) {
    return { success: false, reason: "already-challenged" };
  }

  const det = Number(actor.system?.determination?.value ?? 0);
  if (useType === "positive" && det <= 0) {
    return { success: false, reason: "no-determination" };
  }

  const isTrauma = isValueTrauma(valueItem);

  const valueState =
    useType === "positive"
      ? "positive"
      : useType === "challenge"
        ? "challenged"
        : "negative";

  // ── Supporting-character check ──────────────────────────────────────────
  const isSupportingCharacter = (() => {
    const sheetClass =
      actor?.getFlag?.("core", "sheetClass") ??
      foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
      "";
    return (
      String(sheetClass) === "sta.STASupportingSheet2e" ||
      String(sheetClass) === "sta-utils.LcarsSupportingSheet2e"
    );
  })();

  const missionUserId = !isSupportingCharacter
    ? game.user.isGM
      ? getUserIdForCharacterActor(actor)
      : game.user.id
    : null;
  const currentMissionLogId =
    !isSupportingCharacter && missionUserId
      ? getCurrentMissionLogIdForUser(missionUserId)
      : null;

  // ── Helpers ──────────────────────────────────────────────────────────────
  const adjustStress = async (delta) => {
    const current = Number(actor.system?.stress?.value ?? 0);
    const max = Number(actor.system?.stress?.max ?? current);
    const newValue = Math.max(0, Math.min(max, current + delta));
    await actor.update({ "system.stress.value": newValue });
  };

  const setStressToMax = async () => {
    const max = Number(actor.system?.stress?.max ?? 0);
    await actor.update({ "system.stress.value": max });
  };

  const recordValueStateOnLog = async () => {
    if (isSupportingCharacter) return;
    const currentLog = currentMissionLogId
      ? actor.items.get(String(currentMissionLogId))
      : null;
    if (currentLog) {
      const existingRaw =
        currentLog.system?.valueStates?.[String(valueItem.id)];
      await currentLog.update({
        [`system.valueStates.${valueItem.id}`]: mergeValueStateArray(
          existingRaw,
          valueState,
        ),
      });
    }
  };

  // Helper: prompt callback after value use (GM or player)
  const promptCallback = async (reason) => {
    console.debug("sta-officers-log | useValue.promptCallback called", {
      reason,
      isSupportingCharacter,
      actorName: actor?.name,
      actorType: actor?.type,
      valueItemId: valueItem?.id,
      valueItemName: valueItem?.name,
      currentMissionLogId,
      missionUserId,
      isGM: game.user.isGM,
      userId: game.user.id,
    });

    if (isSupportingCharacter) {
      console.debug(
        "sta-officers-log | useValue.promptCallback: skipping — supporting character",
      );
      return false;
    }

    const eligible = hasEligibleCallbackTargetForValueId(
      actor,
      currentMissionLogId,
      valueItem.id,
    );
    console.debug(
      "sta-officers-log | useValue.promptCallback: eligibility check",
      {
        eligible,
        currentMissionLogId,
        valueId: valueItem.id,
      },
    );

    if (!eligible) {
      return false;
    }

    if (game.user.isGM) {
      const owningUserId = getUserIdForCharacterActor(actor);
      console.debug("sta-officers-log | useValue.promptCallback: GM path", {
        owningUserId,
      });
      if (owningUserId) {
        await promptCallbackForActorAsGM(actor, owningUserId, {
          reason,
          defaultValueId: valueItem.id,
          defaultValueState: valueState,
        });
        return true;
      }
      console.debug(
        "sta-officers-log | useValue.promptCallback: GM path — no owning user found, skipping",
      );
    } else {
      console.debug("sta-officers-log | useValue.promptCallback: player path");
      try {
        await sendCallbackPromptToUser(game.user, {
          reason,
          defaultValueId: valueItem.id,
          defaultValueState: valueState,
        });
        return true;
      } catch (err) {
        console.error("sta-officers-log | Failed to show callback prompt", err);
      }
    }
    return false;
  };

  // ── Trauma + Challenge (special path) ───────────────────────────────────
  if (isTrauma && useType === "challenge") {
    await setStressToMax();
    await setValueChallenged(valueItem, true);
    await recordValueStateOnLog();
    await promptCallback("Trauma challenged");
    return { success: true, valueState };
  }

  // ── GM client ───────────────────────────────────────────────────────────
  if (game.user.isGM) {
    if (valueState === "positive") {
      await spendDetermination(actor);
      if (isTrauma) await adjustStress(1);
    } else {
      await gainDetermination(actor);
      if (isTrauma && valueState === "negative") await adjustStress(-2);
      if (useType === "challenge") await setValueChallenged(valueItem, true);
    }
    await recordValueStateOnLog();
    await promptCallback("Value used");
    return { success: true, valueState };
  }

  // ── Player client ──────────────────────────────────────────────────────
  const moduleSocket = getModuleSocket();
  if (!moduleSocket) {
    return { success: false, reason: "socket-not-available" };
  }

  // Positive: player can apply immediately
  if (useType === "positive") {
    await spendDetermination(actor);
    if (isTrauma) await adjustStress(1);
    await recordValueStateOnLog();
    await promptCallback("Value used");
    return { success: true, valueState };
  }

  // Negative / Challenge: requires GM approval via socket
  try {
    const result = await moduleSocket.executeAsGM("requestValueUseApproval", {
      requestingUserId: game.user.id,
      actorUuid: actor.uuid,
      actorName: actor.name,
      valueItemId: valueItem.id,
      valueName: valueItem.name,
      usage: useType,
      currentMissionLogId,
      isTrauma,
    });

    if (result?.approved) {
      ui.notifications?.info(t("sta-officers-log.dialog.useValue.approved"));
      return { success: true, valueState };
    }
    ui.notifications?.warn(t("sta-officers-log.dialog.useValue.denied"));
    return { success: false, reason: "gm-denied" };
  } catch (err) {
    console.error("sta-officers-log | Use Value approval failed", err);
    ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
    return { success: false, reason: "approval-error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Value Buttons (Sheet Enhancement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Install "Use Value" buttons on value entries in the character sheet.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The application instance for re-rendering.
 */
export function installUseValueButtons(root, actor, app) {
  const valueEntries = root.querySelectorAll(
    'div.section.values li.row.entry[data-item-type="value"]',
  );

  const hideChallengedToggle = shouldHideChallengedToggle();
  let anyChallenged = false;

  for (const entry of valueEntries) {
    const toggleEl = entry.querySelector(
      'a.value-used.control.toggle, a.value-used.control.toggle > i[data-action="onStrikeThrough"]',
    );
    const toggleAnchor =
      toggleEl instanceof HTMLElement && toggleEl.tagName === "A"
        ? toggleEl
        : toggleEl?.closest?.("a.value-used.control.toggle");
    if (!toggleAnchor) continue;
    if (toggleAnchor.querySelector(".sta-use-value-btn")) continue;

    const itemId = entry?.dataset?.itemId;
    const valueItem = itemId ? actor.items.get(itemId) : null;
    if (!valueItem) continue;

    const challenged = isValueChallenged(valueItem);
    const valueIsTrauma = isValueTrauma(valueItem);

    if (challenged) anyChallenged = true;

    // Hide the toggle icon if setting is enabled and value is not challenged
    if (hideChallengedToggle) {
      const toggleIcon = toggleAnchor.querySelector(
        "i[data-action='onStrikeThrough']",
      );
      if (toggleIcon) {
        toggleIcon.style.display = challenged ? "" : "none";
      }
    }

    const useBtn = document.createElement("span");
    useBtn.className = "sta-use-value-btn sta-inline-sheet-btn";
    useBtn.title = valueIsTrauma
      ? t("sta-officers-log.values.useTraumaTooltip")
      : t("sta-officers-log.values.useValueTooltip");
    useBtn.textContent = valueIsTrauma
      ? t("sta-officers-log.values.useTrauma")
      : t("sta-officers-log.values.useValue");
    useBtn.setAttribute("role", "button");
    useBtn.tabIndex = challenged ? -1 : 0;

    if (challenged) {
      useBtn.classList.add("is-disabled");
      useBtn.setAttribute("aria-disabled", "true");
      useBtn.title = `${useBtn.title} (Challenged)`;
    }

    const onUse = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (isValueChallenged(valueItem)) return;

      const det = Number(actor.system?.determination?.value ?? 0);
      const isTraumaVal = isValueTrauma(valueItem);

      const choice = await promptUseValueChoice({
        valueName: valueItem.name ?? "",
        canChoosePositive: det > 0,
        isTrauma: isTraumaVal,
      });

      if (!choice) return;

      if (choice === "positive-crit") {
        await handleAutoCritValueUse({ actor, valueItem });
        scheduleRender(app);
        return;
      }

      await useValue({ actor, valueItemId: valueItem.id, useType: choice });
      scheduleRender(app);
    };

    if (!challenged) {
      useBtn.addEventListener("click", onUse);
      useBtn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") onUse(ev);
      });
    }

    toggleAnchor.parentElement.insertBefore(useBtn, toggleAnchor);
  }

  // Hide the "Chal?" column header if setting is enabled and no values are challenged
  if (hideChallengedToggle) {
    const headerValueUsed = root.querySelector(
      "div.section.values .header.row.item .value-used",
    );
    if (headerValueUsed) {
      headerValueUsed.style.display = anyChallenged ? "" : "none";
    }
  }
}
