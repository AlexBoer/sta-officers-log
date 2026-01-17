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
  normalizeValueStateArray,
  isValueInvokedState,
  mergeValueStateArray,
} from "../values.js";
import {
  directiveIconPath,
  getDirectiveSnapshotForLog,
  getDirectiveKeyFromValueId,
  getDirectiveTextForValueId,
  getMissionDirectives,
  isDirectiveChallenged,
  isDirectiveValueId,
  makeDirectiveValueIdFromText,
} from "../directives.js";
import { getCharacterArcEligibility } from "../arcChains.js";
import {
  getCompletedArcEndLogIds,
  getPrimaryValueIdForLog,
} from "../logMetadata.js";
import { gainDetermination as _gainDetermination } from "./milestones.js";

export { gainDetermination, spendDetermination } from "./milestones.js";

function buildInvokedValues(actor, log) {
  const valueStates = log.system?.valueStates ?? {};
  const rows = [];

  for (const [valueId, rawState] of Object.entries(valueStates)) {
    const stateArray = normalizeValueStateArray(rawState);
    const invoked = stateArray.filter((s) => isValueInvokedState(String(s)));
    if (invoked.length === 0) continue;
    const state = String(invoked[0]);

    if (isDirectiveValueId(valueId)) {
      const name = getDirectiveTextForValueId(log, valueId);
      rows.push({
        id: valueId,
        name: name || "(Directive)",
        state: String(state),
      });
      continue;
    }

    const valueItem = actor.items.get(valueId);
    rows.push({
      id: valueId,
      name: valueItem?.name ?? `(Missing Value: ${valueId})`,
      state: String(state),
    });
  }
  return rows;
}

function buildValuesPayload(
  actor,
  directiveValueIds = [],
  logsPayload = [],
  completedArcEndLogIds = new Set()
) {
  const values = getValueItems(actor).slice();

  // Stable ordering by sort so V1..V8 mapping is consistent
  values.sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0));

  // Filter values to only include those that have at least one eligible log
  // A value is eligible if there's at least one log that:
  // 1. Has invoked the value (invokedIds includes valueId), AND
  // 2. Is compatible with the value's primary-value chain
  const valueOptions = values
    .filter((v) => {
      const valueId = String(v.id);
      // Check if any log has invoked this value AND is compatible with it
      const isEligible = logsPayload.some((log) => {
        const isInvoked = log.invokedIds.includes(valueId);
        if (!isInvoked) return false;

        // Now check if this log is compatible with the value
        // using the same rules as isCallbackTargetCompatibleWithValue
        const logPrimaryValueId = log.primaryValueId
          ? String(log.primaryValueId)
          : "";
        const isCompletedArcEnd = log.isCompletedArcEnd;

        // Empty primary value: always compatible
        if (!logPrimaryValueId) return true;

        // Completed arc end: always compatible
        if (isCompletedArcEnd) return true;

        // Otherwise: primary value must match
        return logPrimaryValueId === valueId;
      });

      return isEligible;
    })
    .map((v) => ({
      id: v.id,
      // NOTE: the callback-request template uses normal Handlebars escaping for this field.
      // Do not pre-escape here or it will render as "&amp;" etc.
      name: v.name ?? "",
      disabled: isValueChallenged(v),
    }));

  const directiveOptions = (directiveValueIds ?? []).map((directiveValueId) => {
    const key = getDirectiveKeyFromValueId(directiveValueId);
    // Try to decode for display. If that fails, show a generic label.
    let name = "(Directive)";
    try {
      // The encoded key is derived from the sanitized directive text.
      // It's fine to decode; worst-case fallback is generic.
      name = getDirectiveTextForValueId(null, directiveValueId) || name;
    } catch (_) {
      // ignore
    }
    return {
      id: directiveValueId,
      name,
      disabled: isDirectiveChallenged(actor, key),
    };
  });

  return { values: valueOptions, directives: directiveOptions };
}

async function markLogUsed(item) {
  const sys = item.system ?? {};
  if (Object.prototype.hasOwnProperty.call(sys, "used")) {
    return item.update({ "system.used": true });
  }
  return item.setFlag("world", "used", true);
}

/**
 * Process a callback response and apply all the database updates.
 * This is the core callback logic extracted from orchestrateCallbackPrompt
 * so it can be called locally (player or GM client) without RPC dependency.
 */
async function processCallbackResponse({
  response,
  targetUser,
  suppressRewardErrors = false,
}) {
  console.log("sta-officers-log | response received", response);

  const actorDoc = await fromUuid(response.actorUuid);
  if (!actorDoc) return;

  // Only the owning player OR a GM should process/apply the callback updates.
  // This prevents non-owning players from trying to apply updates, while allowing
  // GMs to submit callbacks from player sheets (GM has full document permissions).
  const canProcess = targetUser.id === game.user.id || game.user.isGM;
  if (!canProcess) return;

  // Owner processes the callback and applies updates
  await applyCallbackUpdates(response, targetUser, actorDoc, {
    suppressRewardErrors,
  });
}

/**
 * Apply all database updates for a callback response.
 * This is only invoked on the owning user's client (see processCallbackResponse),
 * so we avoid broad error-swallowing and instead log failures per update group.
 */
async function applyCallbackUpdates(
  response,
  targetUser,
  actorDoc,
  { suppressRewardErrors = false } = {}
) {
  const chosenLog = actorDoc.items.get(response.logId);
  if (!chosenLog) {
    console.error("Chosen log not found on actor:", response.logId, actorDoc);
    return;
  }

  const chosenValueId = response.valueId ? String(response.valueId) : "";
  const chosenValue = !isDirectiveValueId(chosenValueId)
    ? actorDoc.items.get(chosenValueId)
    : null;
  if (!isDirectiveValueId(chosenValueId) && !chosenValue) {
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
        "Another player already used that log for a callback. Choose another log."
      );
      return;
    }
  } catch (err) {
    console.warn(
      "sta-officers-log | Callback rejected: unable to validate callback target uniqueness.",
      err
    );
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
  } catch (err) {
    console.warn(
      "sta-officers-log | Callback rejected: unable to validate chain rules.",
      err
    );
    ui.notifications?.warn(
      "Callback rejected: unable to validate chain rules."
    );
    return;
  }

  if (isLogUsed(chosenLog)) return;

  const valueId = chosenValueId;
  const valueState = response.valueState;

  if (!valueId) return;
  if (!["positive", "negative", "challenged"].includes(valueState)) return;

  const valueImg = isDirectiveValueId(valueId)
    ? directiveIconPath()
    : chosenValue?.img
    ? String(chosenValue.img)
    : "";

  // Consolidate database operations into 3 atomic groups for better reliability

  // Group 1: Actor-level updates (determination, callback-used flag)
  {
    const results = await Promise.allSettled([
      _gainDetermination(actorDoc),
      setUsedCallbackThisMission(targetUser.id, true),
    ]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      console.error(
        "sta-officers-log | Group 1 updates had failures:",
        failed.map((f) => f.reason)
      );
    }
  }

  // Group 2: Chosen log updates (mark used, primary value, image)
  const chosenLogUpdates = [];

  // Mark log as used
  chosenLogUpdates.push(markLogUsed(chosenLog));

  // Set primary value if not already set
  const existingPrimary = String(
    chosenLog.getFlag?.(MODULE_ID, "primaryValueId") ?? ""
  );
  if (!existingPrimary) {
    chosenLogUpdates.push(
      chosenLog.setFlag(MODULE_ID, "primaryValueId", valueId)
    );
  }

  // Update image if needed (avoid overwriting arc-end logs)
  if (valueImg) {
    const arcInfo = chosenLog.getFlag?.(MODULE_ID, "arcInfo") ?? null;
    const isArcEnd = arcInfo?.isArc === true;
    if (!isArcEnd) {
      chosenLogUpdates.push(chosenLog.update({ img: valueImg }));
    }
  }

  {
    const results = await Promise.allSettled(chosenLogUpdates);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      console.error(
        "sta-officers-log | Group 2 updates had failures:",
        failed.map((f) => f.reason)
      );
    }
  }

  // Group 3: Current log updates (all flags and value states)
  if (currentLog) {
    // IMPORTANT: Persist the callbackLink edge first.
    // getCharacterArcEligibility() derives the chain from callbackLink flags,
    // so if we compute eligibility before writing the link, arcs will fail to detect.
    {
      const results = await Promise.allSettled([
        currentLog.setFlag(MODULE_ID, "callbackLink", {
          fromLogId: chosenLog.id,
          valueId,
        }),
      ]);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        console.error(
          "sta-officers-log | Group 3 (phase 1) updates had failures:",
          failed.map((f) => f.reason)
        );
      }
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

    const currentLogUpdates = [];

    // Update value state
    const existingRaw = currentLog.system?.valueStates?.[String(valueId)];
    currentLogUpdates.push(
      currentLog.update({
        [`system.valueStates.${valueId}`]: mergeValueStateArray(
          existingRaw,
          valueState
        ),
      })
    );

    // Set primary value flag
    currentLogUpdates.push(
      currentLog.setFlag(MODULE_ID, "primaryValueId", valueId)
    );

    // Set arc info if applicable
    if (arcInfo) {
      currentLogUpdates.push(currentLog.setFlag(MODULE_ID, "arcInfo", arcInfo));
    }

    // Set pending milestone benefit (includes arc payload for milestone creation)
    currentLogUpdates.push(
      currentLog.setFlag(MODULE_ID, "pendingMilestoneBenefit", {
        milestoneId: null,
        chosenLogId: chosenLog.id,
        valueId,
        valueImg,
        arc: arcInfo,
      })
    );

    // Update image if needed
    if (valueImg) {
      currentLogUpdates.push(currentLog.update({ img: valueImg }));
    }

    {
      const results = await Promise.allSettled(currentLogUpdates);
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length) {
        console.error(
          "sta-officers-log | Group 3 (phase 2) updates had failures:",
          failed.map((f) => f.reason)
        );
      }
    }
  }

  ui.notifications.info(
    `${targetUser.name} made a callback${
      chosenLog?.name ? ` (${chosenLog.name})` : ""
    }.`
  );

  const rewardHtml = `
    ${t("sta-officers-log.callback.rewardHtml")}
  `;

  const rewardPayload = {
    targetUserId: targetUser.id,
    title: t("sta-officers-log.callback.title"),
    rewardHtml,
  };

  const moduleSocket = getModuleSocket();

  // Show reward notification to the player (if they're not the current user)
  if (moduleSocket && targetUser.id !== game.user.id) {
    try {
      await moduleSocket.executeAsUser(
        "showCallbackReward",
        targetUser.id,
        rewardPayload
      );
    } catch (err) {
      if (!suppressRewardErrors) {
        console.error(
          "sta-officers-log | Failed sending callback reward notification:",
          err
        );
      } else {
        console.debug(
          "sta-officers-log | Suppressed reward notification error:",
          err
        );
      }
    }
  }
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

  // Include directive "value" options found in eligible logs,
  // PLUS the current mission's directive list (so the user can select a directive
  // even if no eligible logs match it, which will show the normal "no match" hint).
  const directiveValueIds = new Set();

  // Seed from mission directives snapshot/world list.
  try {
    const currentId = getCurrentMissionLogIdForUser(targetUser.id);
    const currentLog = currentId ? actor.items.get(String(currentId)) : null;
    const list = currentLog
      ? getDirectiveSnapshotForLog(currentLog)
      : getMissionDirectives();

    for (const text of list) {
      const id = makeDirectiveValueIdFromText(text);
      if (id) directiveValueIds.add(String(id));
    }
  } catch (_) {
    // ignore
  }

  // Ensure the default directive (e.g. from "Use Directive") is selectable.
  try {
    const dvi = defaultValueId ? String(defaultValueId) : "";
    if (dvi && isDirectiveValueId(dvi)) directiveValueIds.add(dvi);
  } catch (_) {
    // ignore
  }

  try {
    for (const log of unusedLogs) {
      const states = log.system?.valueStates ?? {};
      for (const valueId of Object.keys(states)) {
        if (isDirectiveValueId(valueId)) directiveValueIds.add(String(valueId));
      }
    }
  } catch (_) {
    // ignore
  }

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

  // If a specific value was pre-selected (e.g., by GM via STATracker button),
  // filter logs to only show those that have invoked that value and are compatible with it
  let filteredLogsPayload = logsPayload;
  const dvi = defaultValueId ? String(defaultValueId) : "";
  if (dvi) {
    filteredLogsPayload = logsPayload.filter((log) => {
      // Log must have invoked the value
      if (!log.invokedIds.includes(dvi)) return false;

      // Check compatibility with primary-value chain
      const logPrimaryValueId = log.primaryValueId
        ? String(log.primaryValueId)
        : "";

      // Empty primary value: always compatible
      if (!logPrimaryValueId) return true;

      // Completed arc end: always compatible
      if (log.isCompletedArcEnd) return true;

      // Otherwise: primary value must match
      return logPrimaryValueId === dvi;
    });
  }

  const valuesPayload = buildValuesPayload(
    actor,
    Array.from(directiveValueIds),
    logsPayload,
    completedArcEndLogIds
  );

  const bodyHtml = `
    ${t("sta-officers-log.callback.bodyHtml")}
  `;

  const rewardHtml = `
    ${t("sta-officers-log.callback.rewardHtml")}
  `;

  const requestId = foundry.utils.randomID();

  const dvs = ["positive", "negative", "challenged"].includes(
    String(defaultValueState)
  )
    ? String(defaultValueState)
    : "positive";

  const showRequestUserId = String(requestUserId ?? targetUser.id);

  // Import CallbackRequestApp dynamically
  const { CallbackRequestApp } = await import("../CallbackRequestApp.js");

  // Show callback dialog locally on the current client
  const app = new CallbackRequestApp({
    requestId,
    targetUserId: showRequestUserId,
    actorUuid: actor.uuid,
    title: t("sta-officers-log.callback.title"),
    bodyHtml,
    logs: filteredLogsPayload,
    hasLogs: filteredLogsPayload.length > 0,
    values: valuesPayload.values,
    directives: valuesPayload.directives,
    defaultValueId: dvi,
    defaultValueState: dvs,
    reason,
    messageId,
  });

  // Wait for user response via promise
  const response = await new Promise((resolve) => {
    // Store resolver in the app instance so it can be called when user clicks Yes/No
    app._resolveCallback = resolve;

    // Set timeout
    const timeoutId = setTimeout(() => {
      if (app._resolveCallback) {
        app._resolveCallback({
          module: MODULE_ID,
          type: "callback:response",
          requestId,
          action: "timeout",
        });
        app._resolveCallback = null;
        app.close();
      }
    }, 300_000);

    // Store timeout ID so we can clear it on manual close
    app._timeoutId = timeoutId;

    app.render(true);
  });

  if (!response || response.action !== "yes") {
    // Notify if player skipped, closed, or timed out on callback
    if (response?.action === "no") {
      ui.notifications.info(`${targetUser.name} skipped the callback.`);
    } else if (response?.action === "timeout") {
      ui.notifications.info(
        `${targetUser.name} did not respond to the callback prompt.`
      );
    }
    return;
  }

  // Process the callback response
  await processCallbackResponse({
    response,
    targetUser,
    suppressRewardErrors,
  });
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
  // Allow GM to prompt any player, or a player to prompt themselves
  const isGMPrompting = game.user.isGM && targetUser.id !== game.user.id;
  const isPlayerPromptingSelf =
    !game.user.isGM && targetUser.id === game.user.id;
  if (!isGMPrompting && !isPlayerPromptingSelf) return;

  // Safety: only prompt connected non-GM users
  if (!targetUser?.active || targetUser.isGM) return;

  const actor = targetUser.character;
  if (!actor) {
    ui.notifications.warn(
      `${targetUser.name} has no assigned character (User Configuration → Character).`
    );
    return;
  }

  // If GM is prompting a different player, use socket RPC to show dialog on player's client
  if (isGMPrompting) {
    console.debug(
      "[sta-officers-log] sendCallbackPromptToUser: GM is prompting a different player, using socket RPC"
    );
    const moduleSocket = getModuleSocket();
    console.debug("[sta-officers-log] moduleSocket:", {
      moduleSocket: !!moduleSocket,
    });

    try {
      await moduleSocket.executeAsUser(
        "showCallbackPromptToPlayer",
        targetUser.id,
        {
          targetUserId: targetUser.id,
          reason,
          messageId,
          defaultValueId,
          defaultValueState,
        }
      );
      console.debug("[sta-officers-log] socket call completed successfully");
    } catch (err) {
      console.error("[sta-officers-log] socket call failed:", err);
    }
    return;
  }

  // Player prompting themselves: show dialog locally
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

  // GM must choose a value before sending the prompt to the player
  const actor = target.character;
  if (!actor) {
    ui.notifications.warn(
      tf("sta-officers-log.warnings.userNoCharacter", {
        user: target.name,
      })
    );
    return;
  }

  const valueItems = getValueItems(actor);
  const valueOptions = valueItems
    .map((v, idx) => {
      const sel = idx === 0 ? " selected" : "";
      return `<option value="${v.id}"${sel}>${escapeHTML(v.name)}</option>`;
    })
    .join("");

  const pickedValue = await foundry.applications.api.DialogV2.wait({
    window: { title: t("sta-officers-log.dialog.pickValue.title") },
    content: `
      <div class="form-group">
        <label>${t("sta-officers-log.dialog.pickValue.valueLabel")}</label>
        <select name="valueId">
          ${valueOptions}
        </select>
        <p class="hint">${t("sta-officers-log.dialog.pickValue.hint")}</p>
      </div>
    `,
    buttons: [
      {
        action: "send",
        label: t("sta-officers-log.dialog.pickValue.send"),
        default: true,
        callback: (_event, button) => button.form.elements.valueId.value,
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.pickValue.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });

  if (!pickedValue || pickedValue === "cancel") return;

  await sendCallbackPromptToUser(target, {
    reason: "GM triggered",
    defaultValueId: pickedValue,
    defaultValueState: "positive",
  });
}
