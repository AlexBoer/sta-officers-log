import { MODULE_ID } from "./constants.js";
import { t } from "./i18n.js";
import { setValueChallenged } from "./valueChallenged.js";

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
        await fn(String(msg.requestingUserId ?? ""), {
          reason: "Value used",
          defaultValueId: valueItem.id,
          defaultValueState: valueState,
        });
      }
    } catch (err) {
      console.error(
        `${MODULE_ID} | failed to prompt callback after approval`,
        err
      );
    }

    return { approved: true };
  });

  return moduleSocket;
}
