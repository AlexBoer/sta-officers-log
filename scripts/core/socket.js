import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";
import { setValueChallenged } from "../data/values.js";
import {
  isLogUsed,
  setMissionLogForUser,
  setCurrentMissionLogForActor,
} from "../data/mission.js";
import { gainDetermination } from "../callbackFlow/milestones.js";
import {
  getCompletedArcEndLogIds,
  getPrimaryValueIdForLog,
  hasEligibleCallbackTargetForValueId,
} from "../data/logMetadata.js";
import {
  getValueItems,
  mergeValueStateArray,
  normalizeValueStateArray,
  isValueInvokedState,
} from "../data/values.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  directiveIconPath,
  sanitizeDirectiveText,
  setDirectiveChallenged,
} from "../data/directives.js";
import { getUserIdForCharacterActor } from "../hooks/renderAppV2/sheetUtils.js";

function _hasEligibleCallbackTargetWithAnyInvokedDirective(
  actor,
  currentMissionLogId,
) {
  try {
    if (!actor || actor.type !== "character") return false;

    const missionLogId = currentMissionLogId ? String(currentMissionLogId) : "";
    if (!missionLogId) return true;

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
        const stateArray = normalizeValueStateArray(state);
        if (stateArray.some((s) => isValueInvokedState(String(s)))) {
          return true;
        }
      }
    }

    return false;
  } catch (_) {
    return true;
  }
}

let moduleSocket = null;

export function getModuleSocket() {
  return moduleSocket;
}

export function initSocket({ CallbackRequestApp, pendingResponses }) {
  // SocketLib exposes `socketlib` (lowercase) globally in v13
  const socketlib = globalThis.socketlib;
  if (!socketlib) {
    ui.notifications?.error(t("sta-officers-log.errors.socketLibRequired"));
    return null;
  }

  moduleSocket = socketlib.registerModule(MODULE_ID);

  // Make it accessible to the player-side app
  game.staCallbacksHelperSocket = moduleSocket;

  // --- RPC: GM -> Player (show callback dialog) ---
  moduleSocket.register("showCallbackRequest", async (msg) => {
    if (game.user.id !== msg.targetUserId) return;

    const app = new CallbackRequestApp({
      requestId: msg.requestId,
      targetUserId: msg.targetUserId,
      actorUuid: msg.actorUuid,
      title: msg.title,
      bodyHtml: msg.bodyHtml,
      logs: msg.logs,
      hasLogs: msg.hasLogs,
      values: msg.values,
      directives: msg.directives ?? [],
      defaultValueId: msg.defaultValueId ?? "",
      defaultValueState: msg.defaultValueState ?? "positive",
    });

    app.render(true);
  });

  // --- RPC: Player -> GM (ask GM to prompt callback dialog) ---
  moduleSocket.register("promptCallbackForUser", async (msg) => {
    if (!game.user.isGM) return false;

    const targetUserId = msg?.targetUserId ? String(msg.targetUserId) : "";
    if (!targetUserId) return false;

    const api = game.staCallbacksHelper;
    const fn = api?.promptCallbackForUserId;
    if (typeof fn !== "function") {
      console.warn(
        `${MODULE_ID} | promptCallbackForUserId API not available on GM client.`,
      );
      return false;
    }

    await fn(targetUserId, {
      reason: msg?.reason ?? "Value used",
      messageId: msg?.messageId ?? "",
      defaultValueId: msg?.defaultValueId ?? "",
      defaultValueState: msg?.defaultValueState ?? "positive",
    });

    return true;
  });

  // --- RPC: GM -> Player (tell player to show their callback prompt) ---
  moduleSocket.register("showCallbackPromptToPlayer", async (msg) => {
    if (game.user.id !== msg.targetUserId) {
      return;
    }

    // Import directly and call the function
    const { sendCallbackPromptToUser } =
      await import("../callbackFlow/gmFlow.js");

    if (typeof sendCallbackPromptToUser !== "function") {
      console.error(
        "[sta-officers-log] sendCallbackPromptToUser not found in gmFlow.js",
      );
      return;
    }

    const user = game.user;
    await sendCallbackPromptToUser(user, {
      reason: msg?.reason ?? "Value used",
      messageId: msg?.messageId ?? "",
      defaultValueId: msg?.defaultValueId ?? "",
      defaultValueState: msg?.defaultValueState ?? "positive",
    });
  });

  // --- RPC: Player -> GM (set current mission log for the actor's assigned user) ---
  moduleSocket.register("setCurrentMissionLogForUser", async (msg) => {
    if (!game.user.isGM) return false;

    const actorId = msg?.actorId ? String(msg.actorId) : "";
    const userId = msg?.userId ? String(msg.userId) : "";
    const logId = msg?.logId ? String(msg.logId) : "";
    if (!actorId || !userId || !logId) return false;

    const actor = game.actors?.get?.(actorId) ?? null;
    if (!actor || actor.type !== "character") return false;

    const log = actor.items?.get?.(logId) ?? null;
    if (!log || log.type !== "log") return false;

    // Verify the userId matches the actor's assigned user.
    const expectedUserId = getUserIdForCharacterActor(actor);
    if (!expectedUserId || String(expectedUserId) !== userId) return false;

    const user = game.users?.get?.(userId) ?? null;
    if (!user) return false;

    await setMissionLogForUser(userId, logId);
    return true;
  });

  // --- RPC: Player -> GM (set current mission log directly on actor) ---
  moduleSocket.register("setCurrentMissionLogForActor", async (msg) => {
    if (!game.user.isGM) return false;

    const actorId = msg?.actorId ? String(msg.actorId) : "";
    const logId = msg?.logId ? String(msg.logId) : "";
    if (!actorId || !logId) return false;

    const actor = game.actors?.get?.(actorId) ?? null;
    if (!actor || actor.type !== "character") return false;

    const log = actor.items?.get?.(logId) ?? null;
    if (!log || log.type !== "log") return false;

    await setCurrentMissionLogForActor(actor, logId);
    return true;
  });

  // --- RPC: Player -> GM (deliver response) ---
  moduleSocket.register("deliverCallbackResponse", async (msg) => {
    if (!game.user.isGM) return;

    const resolve = pendingResponses?.get?.(msg.requestId);
    if (resolve) {
      pendingResponses.delete(msg.requestId);
      resolve(msg);
    }
  });

  // --- RPC: GM -> Player (show reward) ---
  moduleSocket.register("showCallbackReward", async (msg) => {
    if (game.user.id !== msg.targetUserId) return;

    await foundry.applications.api.DialogV2.prompt({
      window: { title: msg.title ?? "Making a callback" },
      content: msg.rewardHtml ?? "",
      modal: false,
      rejectClose: false,
      ok: { label: "OK" },
    });
  });

  function _formatUserName(userId) {
    const u = game.users?.get?.(userId);
    return u?.name ?? "(Unknown user)";
  }

  // --- RPC: Player -> GM (request approval for Value usage) ---
  moduleSocket.register("requestValueUseApproval", async (msg) => {
    if (!game.user.isGM) return { approved: false, reason: "not-gm" };

    const actor = msg.actorUuid ? await fromUuid(msg.actorUuid) : null;
    if (!actor) return { approved: false, reason: "actor-missing" };

    const valueItem = msg.valueItemId ? actor.items.get(msg.valueItemId) : null;
    if (!valueItem) return { approved: false, reason: "value-missing" };

    const usage = String(msg.usage ?? "");
    if (usage !== "negative" && usage !== "challenge") {
      return { approved: false, reason: "invalid-usage" };
    }

    const isTrauma = msg.isTrauma === true;
    const requestingUserName = _formatUserName(msg.requestingUserId);
    const valueName = msg.valueName ?? valueItem.name ?? "";
    const actorName = msg.actorName ?? actor.name ?? "";

    const shouldAutoApprove =
      msg.autoApprove === true && msg.requestingUserId === game.user.id;

    const gmTitle = isTrauma
      ? t("sta-officers-log.dialog.useTrauma.gmTitle")
      : t("sta-officers-log.dialog.useValue.gmTitle");
    const gmHint = isTrauma
      ? t("sta-officers-log.dialog.useTrauma.gmHint")
      : t("sta-officers-log.dialog.useValue.gmHint");

    const approved = shouldAutoApprove
      ? true
      : (await foundry.applications.api.DialogV2.wait({
          window: { title: gmTitle },
          content: `
            <p><strong>${foundry.utils.escapeHTML(
              requestingUserName,
            )}</strong> requests to use <strong>${foundry.utils.escapeHTML(
              valueName,
            )}</strong> on <strong>${foundry.utils.escapeHTML(
              actorName,
            )}</strong> as <strong>${foundry.utils.escapeHTML(
              usage,
            )}</strong>.</p>
            <p>${gmHint}</p>
          `,
          buttons: [
            {
              action: "approve",
              label: t("sta-officers-log.dialog.useValue.gmApprove"),
              default: true,
            },
            {
              action: "deny",
              label: t("sta-officers-log.dialog.useValue.gmDeny"),
            },
          ],
          rejectClose: false,
          modal: false,
        })) === "approve";

    if (!approved) return { approved: false };

    await gainDetermination(actor);
    if (usage === "challenge") {
      await setValueChallenged(valueItem, true);
    }

    // Trauma negative: -2 stress
    if (isTrauma && usage === "negative") {
      const current = Number(actor.system?.stress?.value ?? 0);
      const newValue = Math.max(0, current - 2);
      await actor.update({ "system.stress.value": newValue });
    }

    // Record usage on the current mission log (if provided by the requester).
    // This drives callback eligibility via log.system.valueStates.
    const missionLogId = msg.currentMissionLogId
      ? String(msg.currentMissionLogId)
      : "";
    const missionLog = missionLogId ? actor.items.get(missionLogId) : null;
    if (missionLog) {
      const valueState = usage === "challenge" ? "challenged" : "negative";
      const existingRaw =
        missionLog.system?.valueStates?.[String(valueItem.id)];
      await missionLog.update({
        [`system.valueStates.${valueItem.id}`]: mergeValueStateArray(
          existingRaw,
          valueState,
        ),
      });
    }

    // After approval, tell the requesting player to show their own callback prompt.
    try {
      const valueState = usage === "challenge" ? "challenged" : "negative";
      if (
        hasEligibleCallbackTargetForValueId(actor, missionLogId, valueItem.id)
      ) {
        await moduleSocket.executeAsUser(
          "showCallbackPromptToPlayer",
          String(msg.requestingUserId ?? ""),
          {
            targetUserId: String(msg.requestingUserId ?? ""),
            reason: "Value used",
            defaultValueId: valueItem.id,
            defaultValueState: valueState,
          },
        );
      }
    } catch (err) {
      console.error(
        `${MODULE_ID} | failed to prompt callback after approval`,
        err,
      );
    }

    return { approved: true };
  });

  // --- RPC: Player -> GM (request approval for Scar usage) ---
  moduleSocket.register("requestScarUseApproval", async (msg) => {
    if (!game.user.isGM) return { approved: false, reason: "not-gm" };

    const actor = msg.actorUuid ? await fromUuid(msg.actorUuid) : null;
    if (!actor) return { approved: false, reason: "actor-missing" };

    const traitItem = msg.traitItemId ? actor.items.get(msg.traitItemId) : null;
    if (!traitItem || traitItem.type !== "trait") {
      return { approved: false, reason: "trait-missing" };
    }

    const requestingUserName = _formatUserName(msg.requestingUserId);
    const traitName = msg.traitName ?? traitItem.name ?? "";
    const actorName = msg.actorName ?? actor.name ?? "";

    const approved =
      (await foundry.applications.api.DialogV2.wait({
        window: { title: "Approve Scar Usage" },
        content: `
          <p><strong>${requestingUserName}</strong> requests to use the scar <strong>${foundry.utils.escapeHTML(
            traitName,
          )}</strong> on <strong>${foundry.utils.escapeHTML(
            actorName,
          )}</strong>.</p>
          <p>If approved, ${foundry.utils.escapeHTML(
            actorName,
          )} gains +1 Determination.</p>
        `,
        buttons: [
          {
            action: "approve",
            label: "Approve",
            default: true,
          },
          {
            action: "deny",
            label: "Deny",
          },
        ],
        rejectClose: false,
        modal: false,
      })) === "approve";

    if (!approved) return { approved: false };

    await gainDetermination(actor);

    return { approved: true };
  });

  // --- RPC: Player -> GM (request approval for Directive usage) ---
  moduleSocket.register("requestDirectiveUseApproval", async (msg) => {
    if (!game.user.isGM) return { approved: false, reason: "not-gm" };

    const actor = msg.actorUuid ? await fromUuid(msg.actorUuid) : null;
    if (!actor) return { approved: false, reason: "actor-missing" };

    const usage = String(msg.usage ?? "");
    if (usage !== "negative" && usage !== "challenge") {
      return { approved: false, reason: "invalid-usage" };
    }

    const requestingUserName = _formatUserName(msg.requestingUserId);
    const actorName = msg.actorName ?? actor.name ?? "";
    const directiveKey = String(msg.directiveKey ?? "");
    const directiveText = sanitizeDirectiveText(msg.directiveText ?? "");
    if (!directiveKey || !directiveText) {
      return { approved: false, reason: "directive-missing" };
    }

    const shouldAutoApprove =
      msg.autoApprove === true && msg.requestingUserId === game.user.id;

    const approved = shouldAutoApprove
      ? true
      : (await foundry.applications.api.DialogV2.wait({
          window: { title: t("sta-officers-log.dialog.useDirective.gmTitle") },
          content: `
            <p><strong>${requestingUserName}</strong> requests to use <strong>${foundry.utils.escapeHTML(
              directiveText,
            )}</strong> on <strong>${foundry.utils.escapeHTML(
              actorName,
            )}</strong> as <strong>${foundry.utils.escapeHTML(
              usage,
            )}</strong>.</p>
            <p>${t("sta-officers-log.dialog.useDirective.gmHint")}</p>
          `,
          buttons: [
            {
              action: "approve",
              label: t("sta-officers-log.dialog.useDirective.gmApprove"),
              default: true,
            },
            {
              action: "deny",
              label: t("sta-officers-log.dialog.useDirective.gmDeny"),
            },
          ],
          rejectClose: false,
          modal: false,
        })) === "approve";

    if (!approved) return { approved: false };

    await gainDetermination(actor);
    if (usage === "challenge") {
      await setDirectiveChallenged(actor, directiveKey, true);
    }

    const directiveValueId = `${DIRECTIVE_VALUE_ID_PREFIX}${directiveKey}`;

    // Record usage on the current mission log (if provided by the requester).
    const missionLogId = msg.currentMissionLogId
      ? String(msg.currentMissionLogId)
      : "";
    const missionLog = missionLogId ? actor.items.get(missionLogId) : null;
    if (missionLog) {
      const valueState = usage === "challenge" ? "challenged" : "negative";
      const existingRaw =
        missionLog.system?.valueStates?.[String(directiveValueId)];
      await missionLog.update({
        [`system.valueStates.${directiveValueId}`]: mergeValueStateArray(
          existingRaw,
          valueState,
        ),
      });

      // Store mapping for display
      try {
        const existing =
          missionLog.getFlag?.(MODULE_ID, "directiveLabels") ?? {};
        const cloned =
          existing && typeof existing === "object"
            ? foundry.utils.deepClone(existing)
            : {};
        cloned[String(directiveKey)] = directiveText;
        await missionLog.setFlag(MODULE_ID, "directiveLabels", cloned);
      } catch (_) {
        // ignore
      }

      // Keep mission log icon aligned (best-effort)
      try {
        const icon = directiveIconPath();
        if (icon && String(missionLog.img ?? "") !== String(icon)) {
          await missionLog.update({ img: icon });
        }
      } catch (_) {
        // ignore
      }
    }

    // After approval, tell the requesting player to show their own callback prompt.
    try {
      const valueState = usage === "challenge" ? "challenged" : "negative";
      if (
        _hasEligibleCallbackTargetWithAnyInvokedDirective(actor, missionLogId)
      ) {
        await moduleSocket.executeAsUser(
          "showCallbackPromptToPlayer",
          String(msg.requestingUserId ?? ""),
          {
            targetUserId: String(msg.requestingUserId ?? ""),
            reason: "Directive used",
            defaultValueId: directiveValueId,
            defaultValueState: valueState,
          },
        );
      }
    } catch (err) {
      console.error(
        `${MODULE_ID} | failed to prompt callback after directive approval`,
        err,
      );
    }

    return { approved: true };
  });

  return moduleSocket;
}
