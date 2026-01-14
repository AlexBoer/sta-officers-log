import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";
import { setValueChallenged } from "./valueChallenged.js";
import { setMissionLogForUser } from "./mission.js";
import { isLogUsed } from "./mission.js";
import { isCallbackTargetCompatibleWithValue } from "./callbackEligibility.js";
import {
  getCompletedArcEndLogIds,
  getPrimaryValueIdForLog,
} from "./logMetadata.js";
import { getValueItems } from "./values.js";
import {
  DIRECTIVE_VALUE_ID_PREFIX,
  directiveIconPath,
  sanitizeDirectiveText,
  setDirectiveChallenged,
} from "./directives.js";

function _hasEligibleCallbackTargetForValueId(
  actor,
  currentMissionLogId,
  valueId
) {
  try {
    if (!actor || actor.type !== "character") return false;
    const vId = valueId ? String(valueId) : "";
    if (!vId) return false;

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

    const completedArcEndLogIds = getCompletedArcEndLogIds(actor);
    const valueItems = getValueItems(actor);

    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      const logId = String(log.id ?? "");
      if (!logId) continue;
      if (logId === missionLogId) continue;
      if (callbackTargetIds.has(logId)) continue;
      if (isLogUsed(log)) continue;

      const state = String(log.system?.valueStates?.[vId] ?? "unused");
      if (!["positive", "negative", "challenged"].includes(state)) continue;

      const primary = getPrimaryValueIdForLog(actor, log, valueItems);
      const chainOk = isCallbackTargetCompatibleWithValue({
        valueId: vId,
        targetPrimaryValueId: primary,
        isCompletedArcEnd: completedArcEndLogIds.has(logId),
      });
      if (!chainOk) continue;

      return true;
    }
    return false;
  } catch (_) {
    return true;
  }
}

function _hasEligibleCallbackTargetWithAnyInvokedDirective(
  actor,
  currentMissionLogId
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
        if (["positive", "negative", "challenged"].includes(String(state))) {
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
        `${MODULE_ID} | promptCallbackForUserId API not available on GM client.`
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

    // Mirror getUserIdForCharacterActor() from sheet utils to enforce per-actor mapping.
    const users = Array.from(game.users ?? []);
    const assignedNonGM = users.find(
      (u) => !u.isGM && u.character && u.character.id === actor.id
    );
    const expectedUserId = assignedNonGM
      ? assignedNonGM.id
      : users.find((u) => u.character && u.character.id === actor.id)?.id ??
        null;

    if (!expectedUserId || String(expectedUserId) !== userId) return false;

    const user = game.users?.get?.(userId) ?? null;
    if (!user) return false;

    await setMissionLogForUser(userId, logId);
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

  async function _gainDetermination(actor) {
    if (actor?.type !== "character") return;
    const prevDet = Number(actor.system?.determination?.value ?? 0);
    const nextDet = Math.min(3, prevDet + 1);
    if (nextDet !== prevDet) {
      await actor.update({ "system.determination.value": nextDet });
    }
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

    const requestingUserName = _formatUserName(msg.requestingUserId);
    const valueName = msg.valueName ?? valueItem.name ?? "";
    const actorName = msg.actorName ?? actor.name ?? "";

    const shouldAutoApprove =
      msg.autoApprove === true && msg.requestingUserId === game.user.id;

    const approved = shouldAutoApprove
      ? true
      : (await foundry.applications.api.DialogV2.wait({
          window: { title: t("sta-officers-log.dialog.useValue.gmTitle") },
          content: `
            <p><strong>${requestingUserName}</strong> requests to use <strong>${valueName}</strong> on <strong>${actorName}</strong> as <strong>${usage}</strong>.</p>
            <p>${t("sta-officers-log.dialog.useValue.gmHint")}</p>
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

    await _gainDetermination(actor);
    if (usage === "challenge") {
      await setValueChallenged(valueItem, true);
    }

    // Record usage on the current mission log (if provided by the requester).
    // This drives callback eligibility via log.system.valueStates.
    const missionLogId = msg.currentMissionLogId
      ? String(msg.currentMissionLogId)
      : "";
    const missionLog = missionLogId ? actor.items.get(missionLogId) : null;
    if (missionLog) {
      const valueState = usage === "challenge" ? "challenged" : "negative";
      await missionLog.update({
        [`system.valueStates.${valueItem.id}`]: valueState,
      });
    }

    // After approval, prompt the player to consider making a callback.
    try {
      const api = game.staCallbacksHelper;
      const fn = api?.promptCallbackForUserId;
      if (typeof fn === "function") {
        const valueState = usage === "challenge" ? "challenged" : "negative";
        if (
          _hasEligibleCallbackTargetForValueId(
            actor,
            missionLogId,
            valueItem.id
          )
        ) {
          await fn(String(msg.requestingUserId ?? ""), {
            reason: "Value used",
            defaultValueId: valueItem.id,
            defaultValueState: valueState,
          });
        }
      }
    } catch (err) {
      console.error(
        `${MODULE_ID} | failed to prompt callback after approval`,
        err
      );
    }

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
            directiveText
          )}</strong> on <strong>${foundry.utils.escapeHTML(
            actorName
          )}</strong> as <strong>${foundry.utils.escapeHTML(
            usage
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

    await _gainDetermination(actor);
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
      await missionLog.update({
        [`system.valueStates.${directiveValueId}`]: valueState,
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

    // After approval, prompt the player to consider making a callback.
    try {
      const api = game.staCallbacksHelper;
      const fn = api?.promptCallbackForUserId;
      if (typeof fn === "function") {
        const valueState = usage === "challenge" ? "challenged" : "negative";
        if (
          _hasEligibleCallbackTargetWithAnyInvokedDirective(actor, missionLogId)
        ) {
          await fn(String(msg.requestingUserId ?? ""), {
            reason: "Directive used",
            defaultValueId: directiveValueId,
            defaultValueState: valueState,
          });
        }
      }
    } catch (err) {
      console.error(
        `${MODULE_ID} | failed to prompt callback after directive approval`,
        err
      );
    }

    return { approved: true };
  });

  return moduleSocket;
}
