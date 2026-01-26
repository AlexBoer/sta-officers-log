/**
 * Use Directive Button
 *
 * Adds a "Use Directive" button to the Values section of character sheets,
 * allowing players to invoke mission directives with GM approval workflow.
 */

import { MODULE_ID } from "../../core/constants.js";
import { t } from "../../core/i18n.js";
import { getModuleSocket } from "../../core/socket.js";
import {
  getCurrentMissionLogIdForUser,
  isLogUsed,
} from "../../data/mission.js";
import { escapeHTML, mergeValueStateArray } from "../../data/values.js";
import {
  gainDetermination,
  spendDetermination,
  promptCallbackForActorAsGM,
} from "../../callbackFlow.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  getDirectiveSnapshotForLog,
  getMissionDirectives,
  makeDirectiveKeyFromText,
  sanitizeDirectiveText,
  setDirectiveChallenged,
} from "../../data/directives.js";
import { promptUseValueChoice } from "./useValue.js";
import { getUserIdForCharacterActor } from "./sheetUtils.js";

/**
 * Check if there are eligible callback targets with any invoked directive.
 *
 * @param {Actor} actor - The actor to check.
 * @param {string} currentMissionLogId - The current mission log ID.
 * @returns {boolean} Whether there are eligible callback targets.
 */
function _hasEligibleCallbackTargetWithAnyInvokedDirective(
  actor,
  currentMissionLogId,
) {
  try {
    if (!actor || actor.type !== "character") return false;

    // If we can't resolve the mission log id, preserve previous behavior (allow prompting).
    const missionLogId = currentMissionLogId ? String(currentMissionLogId) : "";
    if (!missionLogId) return true;

    // Logs that are already used as a callback target (someone points to them) are not eligible.
    const callbackTargetIds = new Set();
    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      if (log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true) continue;
      const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
      const fromLogId = String(link?.fromLogId ?? "");
      if (fromLogId) callbackTargetIds.add(fromLogId);
    }

    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      const logId = String(log.id ?? "");
      if (!logId) continue;
      if (logId === missionLogId) continue;
      if (callbackTargetIds.has(logId)) continue;
      if (isLogUsed(log)) continue;

      const states = log.system?.valueStates ?? {};
      for (const [id, state] of Object.entries(states)) {
        if (!String(id).startsWith(DIRECTIVE_VALUE_ID_PREFIX)) continue;
        const s = String(state ?? "unused");
        if (["positive", "negative", "challenged"].includes(s)) return true;
      }
    }

    return false;
  } catch (_) {
    return true;
  }
}

/**
 * Install the "Use Directive" button in the Values section title.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 * @param {Application} app - The application instance for re-rendering.
 */
export function installUseDirectiveButton(root, actor, app) {
  const titleEl = root?.querySelector?.("div.section.values > div.title");
  if (!titleEl) return;
  if (titleEl.querySelector(".sta-use-directive-btn")) return;

  titleEl.classList.add("sta-values-title-with-button");

  const dirBtn = document.createElement("a");
  dirBtn.className = "sta-use-directive-btn";
  dirBtn.title = t("sta-officers-log.values.useDirectiveTooltip");
  dirBtn.innerHTML = `${t(
    "sta-officers-log.values.useDirective",
  )} <i class="fa-solid fa-flag"></i>`;

  dirBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    // Check if this is a supporting character (no logs, no callbacks)
    const isSupportingCharacter = (() => {
      const sheetClass =
        actor?.getFlag?.("core", "sheetClass") ??
        foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
        "";
      return String(sheetClass) === "sta.STASupportingSheet2e";
    })();

    const det = Number(actor.system?.determination?.value ?? 0);

    const missionUserId = !isSupportingCharacter
      ? game.user.isGM
        ? getUserIdForCharacterActor(actor)
        : game.user.id
      : null;
    const currentMissionLogId =
      !isSupportingCharacter && missionUserId
        ? getCurrentMissionLogIdForUser(missionUserId)
        : null;

    const currentLog = currentMissionLogId
      ? actor.items.get(String(currentMissionLogId))
      : null;

    // Prefer per-log snapshot (permanently copied at mission start)
    const snapshot = currentLog ? getDirectiveSnapshotForLog(currentLog) : [];
    const directives = snapshot.length ? snapshot : getMissionDirectives();

    const byKey = new Map();
    for (const d of directives) {
      const text = sanitizeDirectiveText(d);
      if (!text) continue;
      const key = makeDirectiveKeyFromText(text);
      if (!key) continue;
      byKey.set(key, text);
    }

    const directiveOptions = [];
    for (const [key, text] of byKey.entries()) {
      directiveOptions.push(
        `<option value="${escapeHTML(key)}">${escapeHTML(text)}</option>`,
      );
    }

    const pick = await foundry.applications.api.DialogV2.wait({
      window: { title: t("sta-officers-log.dialog.useDirective.title") },
      content: `
        <div class="form-group">
          <label>${escapeHTML(
            t("sta-officers-log.dialog.useDirective.pick"),
          )}</label>
          <div class="form-fields">
            <select name="directiveKey">
              <option value="" selected disabled></option>
              ${directiveOptions.join("")}
              <option value="__other__">${escapeHTML(
                t("sta-officers-log.dialog.useDirective.other"),
              )}</option>
            </select>
          </div>
        </div>
        <div
          class="form-group"
          data-sta-directive-custom
          style="display: none;"
        >
          <label>${escapeHTML(
            t("sta-officers-log.dialog.useDirective.other"),
          )}</label>
          <div class="form-fields">
            <input
              type="text"
              name="directiveText"
              placeholder="${escapeHTML(
                t("sta-officers-log.dialog.useDirective.otherPlaceholder"),
              )}"
              disabled
            />
          </div>
          <p class="hint">
            ask the GM if your custom Directive is in play before proceeding
          </p>
        </div>
      `,
      render: (event, dialog) => {
        const html = dialog.element;
        const select = html?.querySelector('select[name="directiveKey"]');
        const customGroup = html?.querySelector("[data-sta-directive-custom]");
        const customInput = html?.querySelector('input[name="directiveText"]');
        if (select) {
          select.addEventListener("change", () => {
            const shouldShow = select.value === "__other__";
            if (customGroup)
              customGroup.style.display = shouldShow ? "" : "none";
            if (customInput) {
              customInput.disabled = !shouldShow;
              if (shouldShow) customInput.focus();
            }
          });
        }
      },
      buttons: [
        {
          action: "ok",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
          default: true,
          callback: (_event, button) => ({
            directiveKey: button.form?.elements?.directiveKey?.value ?? "",
            directiveText: button.form?.elements?.directiveText?.value ?? "",
          }),
        },
        {
          action: "cancel",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
        },
      ],
      rejectClose: false,
      modal: false,
    });

    if (!pick) return;

    const chosenKey = String(pick.directiveKey ?? "");
    const typed = sanitizeDirectiveText(pick.directiveText ?? "");

    const chosenTextRaw =
      chosenKey && chosenKey !== "__other__" ? byKey.get(chosenKey) : typed;
    const chosenText = sanitizeDirectiveText(chosenTextRaw);
    if (!chosenText) {
      ui.notifications?.warn?.(
        t("sta-officers-log.dialog.useDirective.missing"),
      );
      return;
    }

    const directiveKey = makeDirectiveKeyFromText(chosenText);
    const directiveValueId = `${DIRECTIVE_VALUE_ID_PREFIX}${directiveKey}`;

    const choice = await promptUseValueChoice({
      valueName: chosenText,
      canChoosePositive: det > 0,
    });

    if (!choice) return;

    const valueState =
      choice === "positive"
        ? "positive"
        : choice === "challenge"
          ? "challenged"
          : "negative";

    const applyLogUsage = async (logDoc) => {
      if (!logDoc || isSupportingCharacter) return; // Skip for supporting characters

      // Record invoked directive on the mission log
      const existingRaw =
        logDoc.system?.valueStates?.[String(directiveValueId)];
      await logDoc.update({
        [`system.valueStates.${directiveValueId}`]: mergeValueStateArray(
          existingRaw,
          valueState,
        ),
      });

      // Store a mapping so later UI can display the directive name.
      try {
        const existing = logDoc.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
        const cloned =
          existing && typeof existing === "object"
            ? foundry.utils.deepClone(existing)
            : {};
        cloned[String(directiveKey)] = chosenText;
        await logDoc.setFlag(MODULE_ID, "directiveLabels", cloned);
      } catch (_) {
        // ignore
      }
    };

    if (game.user.isGM) {
      if (valueState === "positive") {
        await spendDetermination(actor);
      } else {
        await gainDetermination(actor);
        if (choice === "challenge") {
          await setDirectiveChallenged(actor, directiveKey, true);
        }
      }

      await applyLogUsage(currentLog);

      // Prompt callback locally, but apply for owning player's mission context.
      // (only for main characters, not supporting characters)
      if (!isSupportingCharacter) {
        const owningUserId = getUserIdForCharacterActor(actor);
        if (owningUserId) {
          if (
            hasEligibleCallbackTargetWithAnyInvokedDirective(
              actor,
              currentMissionLogId,
            )
          ) {
            await promptCallbackForActorAsGM(actor, owningUserId, {
              reason: "Directive used",
              defaultValueId: directiveValueId,
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
      ui.notifications?.error(t("sta-officers-log.errors.socketNotAvailable"));
      return;
    }

    if (choice === "positive") {
      await spendDetermination(actor);
      await applyLogUsage(currentLog);

      // Ask the GM to prompt the player for a callback (only for main characters).
      if (!isSupportingCharacter) {
        try {
          if (
            hasEligibleCallbackTargetWithAnyInvokedDirective(
              actor,
              currentMissionLogId,
            )
          ) {
            await moduleSocket.executeAsGM("promptCallbackForUser", {
              targetUserId: game.user.id,
              reason: "Directive used",
              defaultValueId: directiveValueId,
              defaultValueState: "positive",
            });
          }
        } catch (err) {
          console.error(
            "sta-officers-log | Failed to request callback prompt",
            err,
          );
        }
      }

      app.render();
      return;
    }

    // GM approval required for negative and challenge
    try {
      const result = await moduleSocket.executeAsGM(
        "requestDirectiveUseApproval",
        {
          requestingUserId: game.user.id,
          actorUuid: actor.uuid,
          actorName: actor.name,
          directiveKey,
          directiveText: chosenText,
          usage: choice,
          currentMissionLogId,
        },
      );

      if (result?.approved) {
        ui.notifications?.info(t("sta-officers-log.dialog.useValue.approved"));
      } else {
        ui.notifications?.warn(t("sta-officers-log.dialog.useValue.denied"));
      }
    } catch (err) {
      console.error("sta-officers-log | Use Directive approval failed", err);
      ui.notifications?.error(t("sta-officers-log.dialog.useValue.error"));
    }

    app.render();
  });

  titleEl.appendChild(dirBtn);
}
