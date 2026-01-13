import { MODULE_ID } from "../constants.js";
import { t, tf } from "../i18n.js";
import { getModuleSocket } from "../socket.js";
import {
  getCurrentMissionLogIdForUser,
  getMissionLogByUser,
  hasUsedCallbackThisMission,
  isLogUsed,
  setUsedCallbackThisMission,
} from "../mission.js";
import { isValueChallenged } from "../valueChallenged.js";
import {
  escapeHTML,
  getValueIconPathForValueId,
  getValueItems,
} from "../values.js";
import { getCharacterArcEligibility } from "../arcChains.js";
import {
  getCompletedArcEndLogIds,
  getPrimaryValueIdForLog,
} from "../logMetadata.js";
import { pendingResponses } from "./state.js";
import { gainDetermination as _gainDetermination } from "./milestones.js";

export { gainDetermination, spendDetermination } from "./milestones.js";

function buildInvokedValues(actor, log) {
  const valueStates = log.system?.valueStates ?? {};
  const rows = [];

  for (const [valueId, state] of Object.entries(valueStates)) {
    if (state === "unused") continue;
    const valueItem = actor.items.get(valueId);
    rows.push({
      id: valueId,
      name: valueItem?.name ?? `(Missing Value: ${valueId})`,
      state: String(state),
    });
  }
  return rows;
}

function buildValuesPayload(actor) {
  const values = getValueItems(actor).slice();

  // Stable ordering by sort so V1..V8 mapping is consistent
  values.sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));

  return values.map((v) => ({
    id: v.id,
    // NOTE: the callback-request template uses normal Handlebars escaping for this field.
    // Do not pre-escape here or it will render as "&amp;" etc.
    name: v.name ?? "",
    disabled: isValueChallenged(v),
  }));
}

async function markLogUsed(item) {
  const sys = item.system ?? {};
  if (Object.prototype.hasOwnProperty.call(sys, "used")) {
    return item.update({ "system.used": true });
  }
  return item.setFlag("world", "used", true);
}

async function orchestrateCallbackPrompt({
  actor,
  targetUser,
  requestUserId,
  reason = "",
  messageId = "",
  defaultValueId = "",
  defaultValueState = "positive",
  warnOnUsed = false,
  warnOnNoLogs = false,
  suppressRewardErrors = false,
}) {
  if (hasUsedCallbackThisMission(targetUser.id)) {
    if (warnOnUsed) {
      ui.notifications.warn(
        `${targetUser.name} already made a callback this mission.`
      );
    }
    return;
  }

  const missionLogId = getMissionLogByUser()?.[targetUser.id] ?? null;

  // Derive "already-targeted" logs from the actual callbackLink graph so we
  // don't rely on system.used / flags being perfectly up-to-date.
  const callbackTargetIds = new Set();
  try {
    for (const log of actor.items ?? []) {
      if (log?.type !== "log") continue;
      if (log.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true) continue;

      const link = log.getFlag?.(MODULE_ID, "callbackLink") ?? {};
      const fromLogId = String(link?.fromLogId ?? "");
      if (fromLogId) callbackTargetIds.add(fromLogId);
    }
  } catch (_) {
    // ignore
  }

  const unusedLogs = actor.items.filter(
    (i) =>
      i.type === "log" &&
      !isLogUsed(i) &&
      i.id !== missionLogId &&
      !callbackTargetIds.has(String(i.id))
  );

  if (!unusedLogs.length) {
    if (warnOnNoLogs) {
      ui.notifications.warn(
        `${targetUser.name} has no eligible logs to callback to.`
      );
    }
    return;
  }

  const valueItems = getValueItems(actor);
  const completedArcEndLogIds = getCompletedArcEndLogIds(actor);

  const logsPayload = unusedLogs.map((log) => {
    const invoked = buildInvokedValues(actor, log);
    const primaryValueId = getPrimaryValueIdForLog(actor, log, valueItems);
    return {
      id: log.id,
      name: escapeHTML(log.name),
      invoked,
      invokedIds: invoked.map((x) => x.id),
      primaryValueId,
      isCompletedArcEnd: completedArcEndLogIds.has(String(log.id)),
    };
  });

  const valuesPayload = buildValuesPayload(actor);

  const bodyHtml = `
    ${t("sta-officers-log.callback.bodyHtml")}
  `;

  const rewardHtml = `
    ${t("sta-officers-log.callback.rewardHtml")}
  `;

  const requestId = foundry.utils.randomID();
  const moduleSocket = getModuleSocket();

  if (!moduleSocket)
    return ui.notifications?.error("SocketLib not initialized.");

  if (!pendingResponses) {
    console.error(
      `${MODULE_ID} | pendingResponses map not set (setPendingResponses())`
    );
    return;
  }

  const dvs = ["positive", "negative", "challenged"].includes(
    String(defaultValueState)
  )
    ? String(defaultValueState)
    : "positive";

  const dvi = defaultValueId ? String(defaultValueId) : "";

  const showRequestUserId = String(requestUserId ?? targetUser.id);

  try {
    await moduleSocket.executeAsUser("showCallbackRequest", showRequestUserId, {
      requestId,
      targetUserId: showRequestUserId,
      actorUuid: actor.uuid,
      title: t("sta-officers-log.callback.title"),
      bodyHtml,
      logs: logsPayload,
      hasLogs: logsPayload.length > 0,
      values: valuesPayload,
      defaultValueId: dvi,
      defaultValueState: dvs,
      reason,
      messageId,
    });
  } catch (err) {
    console.error(
      `${MODULE_ID} | failed to show callback request for user ${showRequestUserId}`,
      err
    );
    return;
  }

  const response = await new Promise((resolve) => {
    pendingResponses.set(requestId, resolve);
    setTimeout(() => {
      if (pendingResponses.has(requestId)) {
        pendingResponses.delete(requestId);
        resolve({
          module: MODULE_ID,
          type: "callback:response",
          requestId,
          action: "timeout",
        });
      }
    }, 120_000);
  });

  if (!response || response.action !== "yes") return;

  console.log("sta-officers-log | response received", response);

  const actorDoc = await fromUuid(response.actorUuid);
  if (!actorDoc) return;

  const chosenLog = actorDoc.items.get(response.logId);
  if (!chosenLog) {
    console.error("Chosen log not found on actor:", response.logId, actorDoc);
    return;
  }

  const chosenValue = actorDoc.items.get(response.valueId);
  if (!chosenValue) {
    console.error(
      "Chosen value not found on actor:",
      response.valueId,
      actorDoc
    );
    return;
  }

  const currentId = getCurrentMissionLogIdForUser(targetUser.id);
  const currentLog = currentId ? actorDoc.items.get(currentId) : null;

  // Final gate: re-check whether chosenLog is already a callback target.
  // This catches race/stale prompt cases where another update occurs after the
  // prompt is shown but before the user clicks "Yes".
  try {
    const chosenId = String(chosenLog?.id ?? "");
    const incomingChildren = Array.from(actorDoc.items ?? []).filter((it) => {
      if (it?.type !== "log") return false;
      if (it.getFlag?.(MODULE_ID, "callbackLinkDisabled") === true)
        return false;
      const link = it.getFlag?.(MODULE_ID, "callbackLink") ?? {};
      return String(link?.fromLogId ?? "") === chosenId;
    });

    const allowed =
      incomingChildren.length === 0 ||
      (incomingChildren.length === 1 &&
        currentLog?.id &&
        String(incomingChildren[0]?.id ?? "") === String(currentLog.id));

    if (!allowed) {
      ui.notifications?.warn?.(
        "Callback rejected: that log is already a callback target. Choose another log."
      );
      return;
    }
  } catch (_) {
    ui.notifications?.warn?.(
      "Callback rejected: unable to validate callback target uniqueness."
    );
    return;
  }

  try {
    const completedArcEndLogIds2 = getCompletedArcEndLogIds(actorDoc);
    const isArcEnd = completedArcEndLogIds2.has(String(chosenLog.id));
    if (!isArcEnd) {
      const primary = getPrimaryValueIdForLog(
        actorDoc,
        chosenLog,
        getValueItems(actorDoc)
      );
      const chosenValueId = String(response.valueId ?? "");
      if (primary && chosenValueId && String(primary) !== chosenValueId) {
        ui.notifications?.warn(
          `Callback rejected: ${chosenLog.name} is in a different primary-value chain.`
        );
        return;
      }
    }
  } catch (_) {
    ui.notifications?.warn(
      "Callback rejected: unable to validate chain rules."
    );
    return;
  }

  if (isLogUsed(chosenLog)) return;

  const valueId = response.valueId;
  const valueState = response.valueState;

  if (!valueId) return;
  if (!["positive", "negative", "challenged"].includes(valueState)) return;

  const valueImg = chosenValue?.img ? String(chosenValue.img) : "";

  await _gainDetermination(actorDoc);
  await setUsedCallbackThisMission(targetUser.id, true);

  async function persistInternalCurrentLogFlags() {
    if (!currentLog) return;

    await currentLog.setFlag(MODULE_ID, "callbackLink", {
      fromLogId: chosenLog.id,
      valueId,
    });

    try {
      await currentLog.setFlag(MODULE_ID, "primaryValueId", valueId);
    } catch (_) {
      // ignore
    }

    const eligibility = getCharacterArcEligibility(actorDoc, {
      valueId,
      endLogId: currentLog.id,
    });

    const arcInfo = eligibility.qualifies
      ? {
          isArc: true,
          steps: eligibility.requiredChainLength,
          chainLogIds: eligibility.chainForArc ?? [],
          valueId,
        }
      : null;

    if (arcInfo) {
      await currentLog.setFlag(MODULE_ID, "arcInfo", arcInfo);
    }

    await currentLog.setFlag(MODULE_ID, "pendingMilestoneBenefit", {
      milestoneId: null,
      chosenLogId: chosenLog.id,
      valueId,
      valueImg,
      arc: arcInfo,
    });
  }

  await markLogUsed(chosenLog);

  if (currentLog) {
    await currentLog.update({
      [`system.valueStates.${valueId}`]: valueState,
    });
  }

  await persistInternalCurrentLogFlags();

  try {
    const existingPrimary = String(
      chosenLog.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
    );
    if (!existingPrimary) {
      await chosenLog.setFlag(MODULE_ID, "primaryValueId", valueId);
    }
  } catch (_) {
    // ignore
  }

  if (valueImg) {
    const updates = [];
    // Do not overwrite the icon of an arc-ending log.
    // Arc-ending logs are stable “chapter markers” and should keep their icon,
    // even if a later callback uses a different value.
    try {
      const arcInfo = chosenLog.getFlag?.(MODULE_ID, "arcInfo") ?? null;
      const isArcEnd = arcInfo?.isArc === true;
      if (!isArcEnd) updates.push(chosenLog.update({ img: valueImg }));
    } catch (_) {
      // If flag access fails, fall back to previous behavior.
      updates.push(chosenLog.update({ img: valueImg }));
    }
    if (currentLog) updates.push(currentLog.update({ img: valueImg }));
    await Promise.allSettled(updates);
  }

  ui.notifications.info(
    `${targetUser.name} made a callback${
      chosenLog?.name ? ` (${chosenLog.name})` : ""
    }.`
  );

  const rewardPayload = {
    targetUserId: targetUser.id,
    title: t("sta-officers-log.callback.title"),
    rewardHtml,
  };

  if (suppressRewardErrors) {
    try {
      await moduleSocket.executeAsUser(
        "showCallbackReward",
        targetUser.id,
        rewardPayload
      );
    } catch (_) {
      // ignore
    }
  } else {
    await moduleSocket.executeAsUser(
      "showCallbackReward",
      targetUser.id,
      rewardPayload
    );
  }
}

export async function sendCallbackPromptToUser(
  targetUser,
  {
    reason = "",
    messageId = "",
    defaultValueId = "",
    defaultValueState = "positive",
  } = {}
) {
  if (!game.user.isGM) return;

  // Safety: only prompt connected non-GM users
  if (!targetUser?.active || targetUser.isGM) return;

  const actor = targetUser.character;
  if (!actor) {
    ui.notifications.warn(
      `${targetUser.name} has no assigned character (User Configuration → Character).`
    );
    return;
  }

  return orchestrateCallbackPrompt({
    actor,
    targetUser,
    requestUserId: targetUser.id,
    reason,
    messageId,
    defaultValueId,
    defaultValueState,
    warnOnUsed: reason === "GM triggered",
    warnOnNoLogs: reason === "GM triggered",
  });
}

export async function promptCallbackForUserId(
  targetUserId,
  {
    reason = "GM triggered",
    messageId = "",
    defaultValueId = "",
    defaultValueState = "positive",
  } = {}
) {
  if (!game.user.isGM) return;
  const u = targetUserId ? game.users.get(String(targetUserId)) : null;
  if (!u) return;
  return sendCallbackPromptToUser(u, {
    reason,
    messageId,
    defaultValueId,
    defaultValueState,
  });
}

// GM-only: show the callback prompt UI to the GM (locally) for a specific character actor,
// but apply the results as a callback made by the owning player (targetUserId).
// This is used when the GM clicks "Use Value" on a player's character sheet.
export async function promptCallbackForActorAsGM(
  actor,
  targetUserId,
  {
    reason = "Value used",
    messageId = "",
    defaultValueId = "",
    defaultValueState = "positive",
  } = {}
) {
  if (!game.user?.isGM) return;
  if (!actor || actor.type !== "character") return;

  const userId = targetUserId ? String(targetUserId) : "";
  const targetUser = userId ? game.users.get(userId) : null;
  if (!targetUser || targetUser.isGM) {
    ui.notifications?.warn(
      "Cannot prompt for callback: no owning player user found for this character."
    );
    return;
  }
  return orchestrateCallbackPrompt({
    actor,
    targetUser,
    requestUserId: game.user.id,
    reason,
    messageId,
    defaultValueId,
    defaultValueState,
    warnOnUsed: true,
    warnOnNoLogs: true,
    suppressRewardErrors: true,
  });
}

function isGM() {
  return game.user?.isGM;
}

function getActiveNonGMUsers() {
  return game.users.filter((u) => u.active && !u.isGM);
}

export async function openGMFlow() {
  if (!isGM())
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const players = getActiveNonGMUsers();
  if (!players.length) {
    return ui.notifications.warn(
      t("sta-officers-log.warnings.noActivePlayers")
    );
  }

  // If only one player and they've already used a callback, stop early.
  if (players.length === 1 && hasUsedCallbackThisMission(players[0].id)) {
    return ui.notifications.warn(
      tf("sta-officers-log.warnings.alreadyUsedThisMission", {
        user: players[0].name,
      })
    );
  }

  let target = players[0];

  // If multiple active players, pick one (show used players disabled)
  if (players.length > 1) {
    const available = players.filter((u) => !hasUsedCallbackThisMission(u.id));
    const used = players.filter((u) => hasUsedCallbackThisMission(u.id));

    if (!available.length) {
      return ui.notifications.warn(
        t("sta-officers-log.warnings.allActivePlayersUsed")
      );
    }

    const optionsAvailable = available
      .map((u, idx) => {
        const sel = idx === 0 ? " selected" : "";
        return `<option value="${u.id}"${sel}>${escapeHTML(u.name)}</option>`;
      })
      .join("");

    const optionsUsed = used
      .map(
        (u) =>
          `<option value="${u.id}" disabled>${escapeHTML(
            u.name
          )} (already used)</option>`
      )
      .join("");

    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: t("sta-officers-log.dialog.pickPlayer.title") },
      content: `
        <div class="form-group">
          <label>${t("sta-officers-log.dialog.pickPlayer.playerLabel")}</label>
          <select name="userId">
            ${optionsAvailable}
            ${optionsUsed}
          </select>
          <p class="hint">${t(
            "sta-officers-log.dialog.pickPlayer.usedHint"
          )}</p>
        </div>
      `,
      buttons: [
        {
          action: "send",
          label: t("sta-officers-log.dialog.pickPlayer.send"),
          default: true,
          callback: (_event, button) => button.form.elements.userId.value,
        },
        {
          action: "cancel",
          label: t("sta-officers-log.dialog.pickPlayer.cancel"),
        },
      ],
      rejectClose: false,
      modal: false,
    });

    if (!picked || picked === "cancel") return;

    target = game.users.get(picked);
    if (!target?.active)
      return ui.notifications.warn(
        t("sta-officers-log.warnings.userNotConnected")
      );

    // Double-check (in case state changed while dialog was open)
    if (hasUsedCallbackThisMission(target.id)) {
      return ui.notifications.warn(
        tf("sta-officers-log.warnings.alreadyUsedThisMission", {
          user: target.name,
        })
      );
    }
  }

  await sendCallbackPromptToUser(target, { reason: "GM triggered" });
}
