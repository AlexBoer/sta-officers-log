/**
 * Use Value Button & Dialog
 *
 * Adds a "Use Value" button to each value entry on character sheets,
 * allowing players to invoke values (positive/negative/challenge) with
 * GM approval workflow for negative/challenge usage.
 */

import { MODULE_ID } from "../../core/constants.js";
import { t, tf } from "../../core/i18n.js";
import { getModuleSocket } from "../../core/socket.js";
import { getCurrentMissionLogIdForUser } from "../../data/mission.js";
import {
  isValueChallenged,
  setValueChallenged,
  mergeValueStateArray,
  isValueTrauma,
} from "../../data/values.js";
import {
  gainDetermination,
  spendDetermination,
  promptCallbackForActorAsGM,
  sendCallbackPromptToUser,
} from "../../callbackFlow.js";
import { getUserIdForCharacterActor } from "./sheetUtils.js";
import { hasEligibleCallbackTargetForValueId } from "../../data/logMetadata.js";

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
  return new Promise((resolve) => {
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
        {
          action: "positive",
          title: t("sta-officers-log.dialog.useValue.positiveTitle"),
          description: isTrauma
            ? tf("sta-officers-log.dialog.useTrauma.positiveDesc", {
                stress: traumaStressAmount,
              })
            : t("sta-officers-log.dialog.useValue.positiveDesc"),
          disabled: !canChoosePositive,
          buttonLabel: canChoosePositive ? null : "No Determination!",
        },
        {
          action: "negative",
          title: t("sta-officers-log.dialog.useValue.negativeTitle"),
          description: t(
            isTrauma
              ? "sta-officers-log.dialog.useTrauma.negativeDesc"
              : "sta-officers-log.dialog.useValue.negativeDesc",
          ),
        },
        {
          action: "challenge",
          title: t("sta-officers-log.dialog.useValue.challengeTitle"),
          description: t(
            isTrauma
              ? "sta-officers-log.dialog.useTrauma.challengeDesc"
              : "sta-officers-log.dialog.useValue.challengeDesc",
          ),
        },
      ],
      resolve,
    });
    app.render(true);
  });
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
      const isTrauma = isValueTrauma(valueItem);

      const choice = await promptUseValueChoice({
        valueName: valueItem.name ?? "",
        canChoosePositive: det > 0,
        isTrauma,
      });

      if (!choice) return;

      // Check if this is a supporting character (no logs, no callbacks)
      const isSupportingCharacter = (() => {
        const sheetClass =
          actor?.getFlag?.("core", "sheetClass") ??
          foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
          "";
        return String(sheetClass) === "sta.STASupportingSheet2e";
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

      const valueState =
        choice === "positive"
          ? "positive"
          : choice === "challenge"
            ? "challenged"
            : "negative";

      // Helper to adjust stress on an actor
      const adjustStress = async (delta) => {
        const current = Number(actor.system?.stress?.value ?? 0);
        const max = Number(actor.system?.stress?.max ?? current);
        const newValue = Math.max(0, Math.min(max, current + delta));
        await actor.update({ "system.stress.value": newValue });
      };

      // Helper to set stress to max
      const setStressToMax = async () => {
        const max = Number(actor.system?.stress?.max ?? 0);
        await actor.update({ "system.stress.value": max });
      };

      // Helper to record value state on log (only for main characters)
      const recordValueStateOnLog = async () => {
        if (isSupportingCharacter) return; // Skip for supporting characters
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

      // Trauma challenged: special handling - no GM approval, no determination, max stress
      if (isTrauma && choice === "challenge") {
        await setStressToMax();
        await setValueChallenged(valueItem, true);
        await recordValueStateOnLog();

        // Show callback prompt (GM or player) - only for main characters
        if (!isSupportingCharacter) {
          if (game.user.isGM) {
            const owningUserId = getUserIdForCharacterActor(actor);
            if (owningUserId) {
              if (
                hasEligibleCallbackTargetForValueId(
                  actor,
                  currentMissionLogId,
                  valueItem.id,
                )
              ) {
                await promptCallbackForActorAsGM(actor, owningUserId, {
                  reason: "Trauma challenged",
                  defaultValueId: valueItem.id,
                  defaultValueState: valueState,
                });
              }
            }
          } else {
            try {
              if (
                hasEligibleCallbackTargetForValueId(
                  actor,
                  currentMissionLogId,
                  valueItem.id,
                )
              ) {
                const targetUser = game.user;
                await sendCallbackPromptToUser(targetUser, {
                  reason: "Trauma challenged",
                  defaultValueId: valueItem.id,
                  defaultValueState: valueState,
                });
              }
            } catch (err) {
              console.error(
                "sta-officers-log | Failed to show callback prompt",
                err,
              );
            }
          }
        }

        app.render();
        return;
      }

      if (game.user.isGM) {
        if (valueState === "positive") {
          await spendDetermination(actor);
          if (isTrauma) {
            await adjustStress(1); // Trauma positive: +1 stress
          }
        } else {
          await gainDetermination(actor);
          if (isTrauma && valueState === "negative") {
            await adjustStress(-2); // Trauma negative: -2 stress
          }
          if (choice === "challenge") {
            await setValueChallenged(valueItem, true);
          }
        }

        await recordValueStateOnLog();

        // GM clicked "Use Value" on a player's sheet: prompt the GM locally for the callback,
        // but apply it for the owning player's mission/chain context.
        // (only for main characters, not supporting characters)
        if (!isSupportingCharacter) {
          const owningUserId = getUserIdForCharacterActor(actor);
          if (owningUserId) {
            if (
              hasEligibleCallbackTargetForValueId(
                actor,
                currentMissionLogId,
                valueItem.id,
              )
            ) {
              await promptCallbackForActorAsGM(actor, owningUserId, {
                reason: "Value used",
                defaultValueId: valueItem.id,
                defaultValueState: valueState,
              });
            }
          }
        }

        app.render();
        return;
      }

      const moduleSocket = getModuleSocket();
      if (!moduleSocket) {
        ui.notifications?.error(
          t("sta-officers-log.errors.socketNotAvailable"),
        );
        return;
      }

      if (choice === "positive") {
        await spendDetermination(actor);
        if (isTrauma) {
          await adjustStress(1); // Trauma positive: +1 stress
        }

        // Players can record the usage immediately.
        await recordValueStateOnLog();

        // Show callback prompt locally to the player (only for main characters).
        if (!isSupportingCharacter) {
          try {
            if (
              hasEligibleCallbackTargetForValueId(
                actor,
                currentMissionLogId,
                valueItem.id,
              )
            ) {
              const targetUser = game.user;
              await sendCallbackPromptToUser(targetUser, {
                reason: "Value used",
                defaultValueId: valueItem.id,
                defaultValueState: "positive",
              });
            }
          } catch (err) {
            console.error(
              "sta-officers-log | Failed to show callback prompt",
              err,
            );
          }
        }

        app.render();
        return;
      }

      // GM approval required for negative and challenge (non-trauma challenge handled above)
      try {
        const result = await moduleSocket.executeAsGM(
          "requestValueUseApproval",
          {
            requestingUserId: game.user.id,
            actorUuid: actor.uuid,
            actorName: actor.name,
            valueItemId: valueItem.id,
            valueName: valueItem.name,
            usage: choice,
            currentMissionLogId,
            isTrauma,
          },
        );

        if (result?.approved) {
          ui.notifications?.info(
            t("sta-officers-log.dialog.useValue.approved"),
          );
        } else {
          ui.notifications?.warn(t("sta-officers-log.dialog.useValue.denied"));
        }
      } catch (err) {
        console.error("sta-officers-log | Use Value approval failed", err);
        ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
      }

      app.render();
    };

    if (!challenged) {
      useBtn.addEventListener("click", onUse);
      useBtn.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") onUse(ev);
      });
    }

    toggleAnchor.parentElement.insertBefore(useBtn, toggleAnchor);
  }
}
