import { MODULE_ID } from "../core/constants.js";
import { t, tf } from "../core/i18n.js";
import { getModuleSocket } from "../core/socket.js";
import { escapeHTML, isPlainObject } from "../core/utils.js";
import {
  getMissionDirectives,
  rerenderStaTracker,
  sanitizeDirectiveText,
  setMissionDirectives,
} from "../directives/directives.js";
import { resetAllTraumaPositiveUseCounts } from "../values/trauma/trauma.js";

/**
 * Checks if any player-assigned characters have unlinked prototype tokens.
 * @returns {Array<{userId: string, userName: string, actorId: string, actorName: string}>}
 */
export function getPlayerCharactersWithUnlinkedPrototypeTokens() {
  const results = [];
  try {
    for (const u of game.users) {
      if (u.isGM) continue;
      const char = u.character;
      if (!char || char.type !== "character") continue;
      const prototypeToken = char.prototypeToken ?? null;
      if (prototypeToken && prototypeToken.actorLink === false) {
        results.push({
          userId: u.id,
          userName: u.name ?? u.id,
          actorId: char.id,
          actorName: char.name ?? char.id,
        });
      }
    }
  } catch (_) {
    // user iteration may fail in early init
  }
  return results;
}

export const GROUP_SHIP_ACTOR_SETTING = "groupShipActorId";
export const AUTO_CALLBACK_ON_DETERMINATION_ROLL_SETTING =
  "autoCallbackOnDeterminationRoll";

export function registerMissionSettings() {
  game.settings.register(MODULE_ID, "missionTitle", {
    name: "Current Mission Title",
    hint: "Name of the current mission (set when the GM starts a new mission).",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "missionParticipants", {
    name: "Current Mission Participants",
    hint: "Internal list of userIds participating in the current mission.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  game.settings.register(MODULE_ID, "missionStartDate", {
    name: "Current Mission Start Date",
    hint: "ISO date (YYYY-MM-DD) of the current mission's in-game start date. Set automatically when a new mission begins if sta-utils is active.",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "lastEndedMission", {
    name: "Last Ended Mission (Undo Data)",
    hint: "Temporary snapshot of the most recently ended mission, used to support the Undo action. Cleared when reactivated or when a new mission begins.",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "missionHistory", {
    name: "Mission History",
    hint: "Archive of ended missions shown in the Manage Missions dialog. Stores up to 20 entries.",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  // GM-configurable world setting: select a starship actor to represent the party's "Group Ship".
  game.settings.register(MODULE_ID, GROUP_SHIP_ACTOR_SETTING, {
    name: t("sta-officers-log.settings.groupShip.name"),
    hint: t("sta-officers-log.settings.groupShip.hint"),
    scope: "world",
    config: true,
    type: String,
    default: "",
    // Use a function so the Settings UI evaluates choices after the world loads.
    // (At init-time, game.actors may not be populated yet.)
    choices: () => {
      const out = { "": t("sta-officers-log.settings.groupShip.none") };

      const actors = game.actors
        ? Array.from(game.actors.values?.() ?? game.actors)
        : [];

      for (const a of actors) {
        // STA system actor types vary across versions; accept anything ship-like.
        const type = String(a?.type ?? "");
        const hasShields =
          typeof a?.system?.shields?.max !== "undefined" ||
          typeof a?.system?.shields?.value !== "undefined";

        const shipLike =
          type === "starship" ||
          type === "ship" ||
          type === "smallCraft" ||
          type === "smallcraft" ||
          (type && type !== "character" && hasShields);

        if (!shipLike) continue;

        out[a.id] = a.name ?? a.id;
      }

      return out;
    },
  });

  // GM-configurable world setting: enable/disable automatic callback prompts
  // triggered by detecting "Determination" usage in chat.
  game.settings.register(
    MODULE_ID,
    AUTO_CALLBACK_ON_DETERMINATION_ROLL_SETTING,
    {
      name: t("sta-officers-log.settings.autoCallbackOnDeterminationRoll.name"),
      hint: t("sta-officers-log.settings.autoCallbackOnDeterminationRoll.hint"),
      scope: "world",
      config: true,
      type: Boolean,
      // Default OFF: this behavior can be noisy and is system/chat-template dependent.
      default: false,
    },
  );
}

export function getGroupShipActorId() {
  try {
    return String(game.settings.get(MODULE_ID, GROUP_SHIP_ACTOR_SETTING) ?? "");
  } catch (_) {
    return "";
  }
}

export function getGroupShipActor() {
  const id = getGroupShipActorId?.() ?? "";
  if (!id) return null;
  return game.actors?.get?.(id) ?? null;
}

function _getAssignedCharacterActorForUserId(userId) {
  try {
    const uId = userId ? String(userId) : "";
    if (!uId) return null;

    const u = game.users?.get?.(uId) ?? null;
    const a = u?.character ?? null;
    if (a && a.type === "character") return a;

    // Some Foundry builds may expose character as an id.
    const charId = a ? String(a) : "";
    if (charId) {
      const byId = game.actors?.get?.(charId) ?? null;
      if (byId && byId.type === "character") return byId;
    }

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Get the current mission log ID for a user.
 * Stores the log ID in the user's character actor flags for offline support.
 */
export function getCurrentMissionLogIdForUser(userId) {
  // Prefer the user's explicitly assigned character actor.
  // This avoids selecting an arbitrary owned actor when a user owns multiple characters.
  const assignedActor = _getAssignedCharacterActorForUserId(userId);
  if (assignedActor) {
    const flagValue =
      assignedActor.system?.currentMissionLogId ??
      assignedActor.getFlag?.(MODULE_ID, "currentMissionLogId") ??
      null;
    if (flagValue) return String(flagValue);
  }

  // Fallback: first character actor the user owns.
  const ownedActor = game.actors?.find(
    (a) =>
      a.type === "character" &&
      a.getUserLevel?.(userId) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
  );

  if (ownedActor) {
    const flagValue =
      ownedActor.system?.currentMissionLogId ??
      ownedActor.getFlag?.(MODULE_ID, "currentMissionLogId") ??
      null;
    if (flagValue) return String(flagValue);
  }

  return null;
}

/**
 * Set the current mission log for a user.
 * Stores the log ID in the user's character actor flags for offline support.
 */
export async function setMissionLogForUser(userId, logId) {
  // Update actor flag (new method)
  // Prefer writing to the user's assigned character.
  const actor =
    _getAssignedCharacterActorForUserId(userId) ??
    game.actors?.find(
      (a) =>
        a.type === "character" &&
        a.getUserLevel?.(userId) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    ) ??
    null;

  if (actor && actor.type === "character") {
    try {
      await actor.update({
        "system.currentMissionLogId": logId ? String(logId) : null,
      });
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Failed to set currentMissionLogId on actor:`,
        err,
      );
    }
  }
}

/**
 * Set the current mission log directly on an actor.
 * This is useful when you have the actor but not necessarily a userId.
 */
export async function setCurrentMissionLogForActor(actor, logId) {
  if (!actor || actor.type !== "character") {
    console.warn(`${MODULE_ID} | setCurrentMissionLogForActor: invalid actor`);
    return;
  }

  try {
    await actor.update({
      "system.currentMissionLogId": logId ? String(logId) : null,
    });
  } catch (err) {
    console.warn(
      `${MODULE_ID} | Failed to set currentMissionLogId on actor:`,
      err,
    );
  }
}

/**
 * Get the current mission log ID directly from an actor.
 * This is useful when you have the actor but not necessarily a userId.
 */
export function getCurrentMissionLogForActor(actor) {
  if (!actor || actor.type !== "character") return null;
  const value =
    actor.system?.currentMissionLogId ??
    actor.getFlag?.(MODULE_ID, "currentMissionLogId") ??
    null;
  return value ? String(value) : null;
}

export function isLogUsed(item) {
  const sys = item.system ?? {};
  if ("used" in sys) return Boolean(sys.used);

  const flag = item.getFlag?.("world", "used");
  if (typeof flag !== "undefined") return Boolean(flag);

  // Allow the module to track "used" invisibly (so players can keep Log fields manual).
  const moduleFlag = item.getFlag?.(MODULE_ID, "logUsed");
  if (typeof moduleFlag !== "undefined") return Boolean(moduleFlag);

  return false;
}

/**
 * Check if there is currently an active mission.
 * A mission is considered active when the world missionTitle setting is non-empty.
 *
 * @returns {boolean}
 */
export function hasActiveMission() {
  try {
    return Boolean((game.settings.get(MODULE_ID, "missionTitle") ?? "").trim());
  } catch (_) {
    return false;
  }
}

/**
 * Check if a user has used their callback this mission.
 * Checks the user's character actor flag.
 */
export function hasUsedCallbackThisMission(userId) {
  const actor =
    _getAssignedCharacterActorForUserId(userId) ??
    game.actors?.find(
      (a) =>
        a.type === "character" &&
        a.getUserLevel?.(userId) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    ) ??
    null;

  if (actor) {
    return (
      actor.system?.usedCallbackThisMission === true ||
      actor.getFlag?.(MODULE_ID, "usedCallbackThisMission") === true
    );
  }

  return false;
}

/**
 * Set whether a user has used their callback this mission.
 * Updates the user's character actor flag.
 */
export async function setUsedCallbackThisMission(userId, used) {
  const actor =
    _getAssignedCharacterActorForUserId(userId) ??
    game.actors?.find(
      (a) =>
        a.type === "character" &&
        a.getUserLevel?.(userId) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    ) ??
    null;

  if (actor) {
    try {
      await actor.update({ "system.usedCallbackThisMission": Boolean(used) });
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Failed to set usedCallbackThisMission on actor:`,
        err,
      );
    }
  }
}

export async function resetMissionCallbacks({ notify = true } = {}) {
  // Reset actor flags (new method)
  const flagUpdates = [];
  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    try {
      flagUpdates.push(
        actor.update({ "system.usedCallbackThisMission": false }),
      );
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Failed to reset usedCallbackThisMission on actor:`,
        err,
      );
    }
  }
  await Promise.allSettled(flagUpdates);

  // Reset trauma positive use counts for cumulative stress tracking
  await resetAllTraumaPositiveUseCounts();

  if (notify) {
    ui.notifications.info(t("sta-officers-log.notifications.callbacksReset"));
  }
}

const SUPPORTING_CHARACTER_SHEET_CLASSES = new Set([
  "sta.STASupportingSheet2e",
  "sta-utils.LcarsSupportingSheet2e",
]);

export async function resetDetermination({ notify = true } = {}) {
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    // Supporting characters do not reset Determination at the start of a mission.
    const sheetClass = actor.flags?.core?.sheetClass ?? "";
    if (SUPPORTING_CHARACTER_SHEET_CLASSES.has(sheetClass)) continue;
    updates.push(actor.update({ "system.determination.value": 1 }));
  }
  await Promise.allSettled(updates);
  if (notify) {
    ui.notifications.info(
      t("sta-officers-log.notifications.allDeterminationReset"),
    );
  }
}

export async function resetStress({ notify = true } = {}) {
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    updates.push(actor.update({ "system.stress.value": 0 }));
  }
  await Promise.allSettled(updates);
  if (notify) {
    ui.notifications.info(t("sta-officers-log.notifications.allStressReset"));
  }
}

export async function resetShipReadiness({ notify = true } = {}) {
  const updates = [];

  for (const actor of game.actors) {
    const type = actor?.type;
    if (type !== "starship" && type !== "smallCraft" && type !== "smallcraft")
      continue;

    const shieldsMaxRaw = actor.system?.shields?.max;
    const shieldsValueRaw = actor.system?.shields?.value;

    const shieldsMax = Number(shieldsMaxRaw);
    const shieldsValue = Number(shieldsValueRaw);
    const resetTo = Number.isFinite(shieldsMax)
      ? shieldsMax
      : Number.isFinite(shieldsValue)
        ? shieldsValue
        : 0;

    if (type === "starship") {
      updates.push(
        actor.update({
          "system.reservepower": true,
          "system.shields.value": resetTo,
          "system.shaken": false,
        }),
      );
    } else {
      // Small craft: shields only (no reserve power).
      updates.push(actor.update({ "system.shields.value": resetTo }));
    }
  }

  await Promise.allSettled(updates);
  if (notify) {
    ui.notifications.info(
      t("sta-officers-log.notifications.allShipReadinessReset"),
    );
  }
}

export async function resetScarUsed({ notify = true } = {}) {
  const flagUpdates = [];
  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    const items = actor.items ?? [];
    for (const item of items) {
      if (item.type !== "trait") continue;
      const isScar =
        item.system?.isScar === true ||
        item.getFlag?.(MODULE_ID, "isScar") === true;
      if (!isScar) continue;
      try {
        flagUpdates.push(item.update({ "system.isScarUsed": false }));
      } catch (err) {
        console.warn(
          `${MODULE_ID} | Failed to reset isScarUsed flag on trait item:`,
          err,
        );
      }
    }
  }
  await Promise.allSettled(flagUpdates);

  if (notify) {
    ui.notifications.info(t("sta-officers-log.notifications.scarsReset"));
  }
}

/**
 * Set a STA tracker value (momentum or threat) using the system's settings API.
 * Prefers STATracker.DoUpdateResource() (v2.5.0+) which handles settings,
 * socket messaging to all clients, and chat messages automatically.
 * Falls back to direct setting/document update for older versions.
 * @param {"momentum"|"threat"} key - The tracker key to set
 * @param {number} value - The value to set
 * @returns {Promise<boolean>} - Whether the operation succeeded
 */
async function _setStaTrackerValue(key, value) {
  try {
    const numValue = Math.max(0, Math.floor(value));

    // v2.5.0+: Use the system's DoUpdateResource which handles settings,
    // socket broadcast to all clients, and accumulated chat messages.
    const TrackerClass = game.STATracker?.constructor;
    if (typeof TrackerClass?.DoUpdateResource === "function") {
      await TrackerClass.DoUpdateResource(key, numValue);
      return true;
    }

    // Fallback for older STA versions: set directly and rerender locally.
    const settingKey = `sta.${key}`;
    const world = game.settings.storage?.get?.("world");
    const doc =
      world?.find?.((s) => s?.key === settingKey) ??
      world?.contents?.find?.((s) => s?.key === settingKey) ??
      null;

    try {
      await game.settings.set("sta", key, numValue);
      await rerenderStaTracker();
      return true;
    } catch (_) {
      try {
        await game.settings.set("sta", key, String(numValue));
        await rerenderStaTracker();
        return true;
      } catch (_) {
        // Fall back to updating the Setting document directly.
      }
    }

    if (!doc) return false;
    await doc.update({ value: String(numValue) });

    try {
      const cfg = game.settings.settings?.get?.(settingKey);
      cfg?.onChange?.(String(numValue));
    } catch (_) {
      // ignore
    }

    await rerenderStaTracker();

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Set Momentum to a specific value.
 * @param {number} value - The momentum value to set
 * @returns {Promise<boolean>} - Whether the operation succeeded
 */
async function _setMomentum(value) {
  return _setStaTrackerValue("momentum", value);
}

/**
 * Set Threat to a specific value.
 * @param {number} value - The threat value to set
 * @returns {Promise<boolean>} - Whether the operation succeeded
 */
async function _setThreat(value) {
  return _setStaTrackerValue("threat", value);
}

/**
 * Get the current momentum value from the STA system settings.
 * @returns {number|null} - The current momentum value, or null if not found
 */
function _getCurrentMomentum() {
  try {
    const world = game.settings.storage?.get?.("world");
    const doc =
      world?.find?.((s) => s?.key === "sta.momentum") ??
      world?.contents?.find?.((s) => s?.key === "sta.momentum") ??
      null;

    const cur = Number(doc?.value);
    return Number.isFinite(cur) ? cur : null;
  } catch (_) {
    return null;
  }
}

async function _tryDecrementStaMomentum() {
  const cur = _getCurrentMomentum();
  if (cur === null) return false;

  const next = Math.max(0, cur - 1);
  return _setMomentum(next);
}

async function _decreaseMomentumByOne() {
  // STA 1.3.x stores Momentum as a world Setting document with key "sta.momentum" and a string value.
  return _tryDecrementStaMomentum();
}

export async function newScene() {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const momentumOk = await _decreaseMomentumByOne();

  const updates = [];
  for (const actor of game.actors ?? []) {
    const sheetClass = actor?.flags?.core?.sheetClass;
    if (
      sheetClass !== "sta.STANPCSheet2e" &&
      sheetClass !== "sta-utils.LcarsNPCSheet2e"
    )
      continue;

    const npcType = actor?.system?.npcType ?? actor?.system?.npctype;
    if (npcType !== "notable" && npcType !== "major") continue;

    const max = Number(actor?.system?.stress?.max);
    if (!Number.isFinite(max)) continue;

    updates.push(actor.update({ "system.stress.value": max }));
  }

  await Promise.allSettled(updates);

  if (!momentumOk) {
    ui.notifications.warn(t("sta-officers-log.notifications.momentumNotFound"));
  }
  ui.notifications.info(t("sta-officers-log.notifications.newSceneDone"));
}

export async function ensureNewSceneMacro() {
  if (!game.user.isGM) return null;

  const name = "New Scene";
  const command =
    "try { game.staofficerslog?.newScene?.(); } catch (err) { console.error('sta-officers-log | New Scene macro failed', err); ui.notifications?.error?.('New Scene failed; see console.'); }";

  const existing = (game.macros ?? []).find(
    (m) =>
      m?.name === name &&
      ((m?.type ?? m?.command) ? "script" : m?.type) !== "chat",
  );

  try {
    if (!existing) {
      return await Macro.create({
        name,
        type: "script",
        command,
      });
    }

    if (String(existing.command ?? "") !== command) {
      await existing.update({ command, type: "script" });
    }

    return existing;
  } catch (err) {
    console.error(`${MODULE_ID} | ensureNewSceneMacro failed`, err);
    return null;
  }
}

/**
 * Opens the Group Ship actor sheet (as configured in world settings).
 * Displays a warning if no Group Ship is set.
 */
export function openGroupShip() {
  const id = getGroupShipActorId();
  if (!id) {
    ui.notifications.warn(t("sta-officers-log.notifications.noGroupShipSet"));
    return;
  }

  const actor = game.actors?.get?.(id);
  if (!actor) {
    ui.notifications.warn(
      t("sta-officers-log.notifications.groupShipNotFound"),
    );
    return;
  }

  actor.sheet?.render?.(true);
}

/**
 * Creates or updates the "Open Group Ship" macro.
 * Only runs for GM users.
 */
export async function ensureOpenGroupShipMacro() {
  if (!game.user.isGM) return null;

  const name = t("sta-officers-log.tools.openGroupShip");
  const command =
    "try { game.staofficerslog?.openGroupShip?.(); } catch (err) { console.error('sta-officers-log | Open Group Ship macro failed', err); ui.notifications?.error?.('Open Group Ship failed; see console.'); }";

  const existing = (game.macros ?? []).find(
    (m) =>
      m?.name === name &&
      ((m?.type ?? m?.command) ? "script" : m?.type) !== "chat",
  );

  try {
    if (!existing) {
      return await Macro.create({
        name,
        type: "script",
        command,
      });
    }

    if (String(existing.command ?? "") !== command) {
      await existing.update({ command, type: "script" });
    }

    return existing;
  } catch (err) {
    console.error(`${MODULE_ID} | ensureOpenGroupShipMacro failed`, err);
    return null;
  }
}

/**
 * Compute the ISO date (YYYY-MM-DD) for a new mission start.
 * Uses today's real-world month and day, but substitutes the in-game year
 * from Foundry's worldTime so the year stays consistent with the campaign era.
 * Only runs if sta-utils is active (provides calendarDateToStardateTng).
 * Returns null if sta-utils is not installed or worldTime is unavailable.
 * @returns {string|null} ISO date string, e.g. "2385-05-12"
 */
async function _computeMissionStartIsoDate() {
  try {
    if (!game.modules.get("sta-utils")?.active) return null;

    // Determine the in-game year from worldTime
    const worldTimeSec = game.time?.worldTime ?? null;
    if (worldTimeSec == null) return null;
    const worldDate = new Date(worldTimeSec * 1000);
    const inGameYear = worldDate.getFullYear();
    if (!Number.isFinite(inGameYear) || inGameYear < 2100) return null;

    // Combine in-game year with today's real-world month and day
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const isoDate = `${inGameYear}-${month}-${day}`;

    // Advance worldTime to noon on the new date so the stardate display updates
    const targetMs = new Date(`${isoDate}T12:00:00`).getTime();
    const targetSec = Math.floor(targetMs / 1000);
    const delta = targetSec - Math.floor(game.time.worldTime);
    if (delta !== 0) {
      await game.time.advance(delta);
    }

    return isoDate;
  } catch (err) {
    console.warn(`${MODULE_ID} | _computeMissionStartIsoDate failed:`, err);
    return null;
  }
}

function _uniqueItemName(actor, baseName) {
  const existing = new Set(actor.items.map((i) => i.name));
  if (!existing.has(baseName)) return baseName;

  let n = 2;
  while (existing.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

async function addMissionLogToUser(
  user,
  missionTitle,
  { customDate = null } = {},
) {
  const actor = user?.character;
  if (!actor || actor.type !== "character") return null;

  const baseName = missionTitle?.trim() || "New Mission";
  const name = _uniqueItemName(actor, baseName);

  const maxSort = Math.max(
    0,
    ...actor.items
      .filter((i) => i.type === "log")
      .map((i) => Number(i.sort ?? 0)),
  );

  const directivesSnapshot = getMissionDirectives();

  const itemData = {
    name,
    type: "log",
    sort: maxSort + 1,
    flags: {
      [MODULE_ID]: {
        directivesSnapshot,
      },
    },
  };

  if (customDate) {
    itemData.system = { customDate };
  }

  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);

  return created?.id ?? null;
}

export async function addParticipantToCurrentMission(
  userId,
  { createLog = true } = {},
) {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const user = game.users.get(userId);
  if (!user || user.isGM)
    return ui.notifications.warn(
      t("sta-officers-log.notifications.invalidUser"),
    );
  if (!user.character)
    return ui.notifications.warn(
      tf("sta-officers-log.notifications.userNoCharacter", {
        user: user.name,
      }),
    );

  const title = (game.settings.get(MODULE_ID, "missionTitle") ?? "").trim();
  const missionTitle = title || "New Mission";

  // 1) Add to participants list
  const participants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? [],
  );
  participants.add(userId);
  await game.settings.set(
    MODULE_ID,
    "missionParticipants",
    Array.from(participants),
  );

  // 2) Ensure they can still callback this mission
  await setUsedCallbackThisMission(userId, false);

  // 3) Optionally create a mission log and store mapping
  if (createLog) {
    const customDate = await _computeMissionStartIsoDate();
    const logId = await addMissionLogToUser(user, missionTitle, { customDate });
    if (logId) await setMissionLogForUser(userId, logId);
  }

  ui.notifications.info(
    createLog
      ? tf("sta-officers-log.notifications.addedToMissionLogCreated", {
          user: user.name,
        })
      : tf("sta-officers-log.notifications.addedToMission", {
          user: user.name,
        }),
  );
}

// This function is exposed to the api so a macro can be used to add players to a mission after it's already started.
export async function promptAddParticipant() {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const participants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? [],
  );
  const users = game.users.filter((u) => !u.isGM);

  const available = users.filter((u) => !participants.has(u.id));
  const already = users.filter((u) => participants.has(u.id));

  if (!available.length) {
    return ui.notifications.warn(
      t("sta-officers-log.notifications.allPlayersAlreadyInMission"),
    );
  }

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/add-player.hbs`,
    {
      available: available.map((u, idx) => ({
        id: u.id,
        name: u.name ?? "",
        isSelected: idx === 0,
      })),
      already: already.map((u) => ({
        id: u.id,
        name: u.name ?? "",
      })),
    },
  );

  const result = await foundry.applications.api.DialogV2.input({
    classes: ["sta-officers-log"],
    window: { title: t("sta-officers-log.dialog.addPlayer.title") },
    modal: false,
    rejectClose: false,
    content,
    ok: { label: t("sta-officers-log.dialog.addPlayer.ok") },
    cancel: { label: t("sta-officers-log.dialog.addPlayer.cancel") },
  });

  if (!result) return;

  await addParticipantToCurrentMission(result.userId, {
    createLog: Boolean(result.createLog),
  });
}

// Guard against stacking multiple concurrent "unadded players" dialogs.
let _unaddedPlayersDialogOpen = false;

/**
 * Check if any currently-active players are missing from the current mission,
 * and if so, prompt the GM to add them.
 *
 * Called automatically on ready (GM login) and when a user connects.
 * GM-only. Silent no-op when no mission is active or all players are included.
 */
export async function promptUnaddedActivePlayers() {
  if (!game.user?.isGM) return;
  if (!hasActiveMission()) return;
  if (_unaddedPlayersDialogOpen) return;

  const participants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? [],
  );

  const unaddedActive = (game.users ?? []).filter(
    (u) => !u.isGM && u.active && !participants.has(u.id),
  );

  if (!unaddedActive.length) return;

  const missionTitle = (
    game.settings.get(MODULE_ID, "missionTitle") ?? ""
  ).trim();

  const players = unaddedActive.map((u) => ({
    id: u.id,
    name: u.name ?? u.id,
    characterName: u.character?.name ?? null,
    hasChar: Boolean(u.character && u.character.type === "character"),
    checked: Boolean(u.character && u.character.type === "character"),
  }));

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/unadded-players.hbs`,
    { players, missionTitle },
  );

  _unaddedPlayersDialogOpen = true;
  try {
    const result = await foundry.applications.api.DialogV2.input({
      classes: ["sta-officers-log"],
      window: { title: t("sta-officers-log.dialog.unaddedPlayers.title") },
      modal: false,
      rejectClose: false,
      content,
      ok: { label: t("sta-officers-log.dialog.unaddedPlayers.add") },
      cancel: { label: t("sta-officers-log.dialog.unaddedPlayers.ignore") },
    });

    if (result) {
      const createLog = Boolean(result.createLog);
      for (const player of players) {
        if (!result[`p_${player.id}`]) continue;
        await addParticipantToCurrentMission(player.id, { createLog });
      }
    }
  } finally {
    _unaddedPlayersDialogOpen = false;
  }
}

/**
 * End the currently active mission.
 * Shows a summary dialog listing each participant's callback and milestone/arc status,
 * then clears all current-mission-log indicators and mission state.
 *
 * GM-only.
 */
export async function endCurrentMission() {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  if (!hasActiveMission()) {
    return ui.notifications.warn(
      t("sta-officers-log.warnings.noActiveMission"),
    );
  }

  const missionTitle =
    (game.settings.get(MODULE_ID, "missionTitle") ?? "").trim() || "(untitled)";
  const participantIds =
    game.settings.get(MODULE_ID, "missionParticipants") ?? [];

  // Gather per-character summary
  const summaryRows = [];
  for (const userId of participantIds) {
    const user = game.users?.get?.(userId);
    if (!user) continue;

    const actor = user.character ?? null;
    if (!actor || actor.type !== "character") continue;

    // Callback status
    const usedCallback = hasUsedCallbackThisMission(userId);

    // Milestone/Arc earned: check the current mission log for pendingMilestoneBenefit
    const currentLogId = getCurrentMissionLogForActor(actor);
    const currentLog = currentLogId
      ? actor.items.get(String(currentLogId))
      : null;
    let milestoneLabel = "";
    if (currentLog) {
      const pending =
        currentLog.system?.pendingMilestoneBenefit ??
        currentLog.getFlag?.(MODULE_ID, "pendingMilestoneBenefit") ??
        null;
      if (isPlainObject(pending)) {
        const arc = pending.arc ?? null;
        if (arc?.isArc === true) {
          milestoneLabel = t("sta-officers-log.dialog.endMission.arcEarned");
        } else {
          milestoneLabel = t(
            "sta-officers-log.dialog.endMission.milestoneEarned",
          );
        }
      }
    }
    if (!milestoneLabel) {
      milestoneLabel = t("sta-officers-log.dialog.endMission.noMilestone");
    }

    summaryRows.push({
      name: actor.name ?? user.name ?? userId,
      usedCallback,
      milestoneLabel,
    });
  }

  // Build summary HTML
  const callbackYes = t("sta-officers-log.dialog.endMission.callbackYes");
  const callbackNo = t("sta-officers-log.dialog.endMission.callbackNo");

  // Build markdown for clipboard
  let markdown = `## ${missionTitle}\n`;
  if (summaryRows.length) {
    for (const row of summaryRows) {
      const cb = row.usedCallback
        ? `\u2713 ${callbackYes}`
        : `\u2014 ${callbackNo}`;
      markdown += `- **${row.name}** — ${cb} | ${row.milestoneLabel}\n`;
    }
  } else {
    markdown += "_No participants._\n";
  }

  // Build summary HTML
  let summaryHtml = `<p><strong>${escapeHTML(missionTitle)}</strong></p>`;
  if (summaryRows.length) {
    summaryHtml +=
      '<table style="width:100%; border-collapse:collapse; margin-top:0.5rem;">';
    for (const row of summaryRows) {
      const cbBadge = row.usedCallback
        ? `<span style="color:#4caf50;">&#10003; ${escapeHTML(callbackYes)}</span>`
        : `<span style="opacity:0.5;">&mdash; ${escapeHTML(callbackNo)}</span>`;
      summaryHtml += `<tr>
        <td style="padding:0.25rem 0.5rem; white-space:nowrap;"><strong>${escapeHTML(row.name)}</strong></td>
        <td style="padding:0.25rem 0.5rem;">${cbBadge}</td>
        <td style="padding:0.25rem 0.5rem;">${escapeHTML(row.milestoneLabel)}</td>
      </tr>`;
    }
    summaryHtml += "</table>";
  } else {
    summaryHtml += "<p><em>No participants.</em></p>";
  }

  // Warn about directives being cleared if any are active
  const currentDirectives = getMissionDirectives();
  if (currentDirectives.length) {
    summaryHtml += `<p style="margin-top:0.5rem; color:#e65100;"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHTML(t("sta-officers-log.dialog.endMission.directivesWarning"))}</p>`;
  }

  // Add a "Copy as Markdown" button
  const copyLabel = t("sta-officers-log.dialog.endMission.copyMarkdown");
  summaryHtml += `<div style="margin-top:0.5rem; text-align:right;">
    <button type="button" class="sta-copy-markdown-btn" style="cursor:pointer;">
      <i class="fa-solid fa-clipboard"></i> ${escapeHTML(copyLabel)}
    </button>
  </div>`;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    classes: ["sta-officers-log"],
    window: { title: t("sta-officers-log.dialog.endMission.title") },
    content: summaryHtml,
    yes: { label: t("sta-officers-log.dialog.endMission.confirm") },
    no: { label: t("sta-officers-log.dialog.endMission.cancel") },
    rejectClose: false,
    modal: false,
    render: (_event, dialog) => {
      try {
        const html = dialog?.element;
        if (!(html instanceof HTMLElement)) return;
        const copyBtn = html.querySelector(".sta-copy-markdown-btn");
        if (copyBtn) {
          copyBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            try {
              await navigator.clipboard.writeText(markdown);
              ui.notifications.info(
                t("sta-officers-log.dialog.endMission.copied"),
              );
            } catch (err) {
              console.error(`${MODULE_ID} | Failed to copy markdown`, err);
            }
          });
        }
      } catch (_) {
        // ignore
      }
    },
  });

  if (!confirmed) return;

  // Snapshot current state so the GM can undo this action.
  const _undoSnapshot = {
    title: missionTitle,
    participantIds: [...participantIds],
    startDate: (game.settings.get(MODULE_ID, "missionStartDate") ?? "").trim(),
    directives: getMissionDirectives(),
    actorLogMap: {},
  };
  for (const _userId of participantIds) {
    const _u = game.users?.get?.(_userId);
    const _a = _u?.character ?? null;
    if (_a && _a.type === "character") {
      const _lid = _a.system?.currentMissionLogId ?? null;
      if (_lid) _undoSnapshot.actorLogMap[_a.id] = String(_lid);
    }
  }
  try {
    await game.settings.set(MODULE_ID, "lastEndedMission", _undoSnapshot);
  } catch (_err) {
    console.warn(`${MODULE_ID} | Failed to save undo snapshot:`, _err);
  }

  // Push to persistent mission history (newest first, max 20 entries).
  try {
    const _history = getMissionHistory();
    _history.unshift({ ..._undoSnapshot, endedAt: Date.now() });
    if (_history.length > 20) _history.length = 20;
    await game.settings.set(MODULE_ID, "missionHistory", _history);
  } catch (_histErr) {
    console.warn(`${MODULE_ID} | Failed to update mission history:`, _histErr);
  }

  // Clear currentMissionLogId on all participating character actors
  const clearOps = [];
  for (const userId of participantIds) {
    const user = game.users?.get?.(userId);
    const actor = user?.character ?? null;
    if (actor && actor.type === "character") {
      clearOps.push(
        actor.update({ "system.currentMissionLogId": null }).catch((err) => {
          console.warn(
            `${MODULE_ID} | Failed to clear currentMissionLogId on ${actor.name}:`,
            err,
          );
        }),
      );
    }
  }
  await Promise.allSettled(clearOps);

  // Clear mission state
  await game.settings.set(MODULE_ID, "missionTitle", "");
  await game.settings.set(MODULE_ID, "missionParticipants", []);
  await game.settings.set(MODULE_ID, "missionStartDate", "");
  await setMissionDirectives([]);

  // Show mission-ended notification.
  ui.notifications.info(t("sta-officers-log.notifications.missionEnded"));

  // Re-render STA Tracker and broadcast refresh
  await rerenderStaTracker();
  try {
    const sock = getModuleSocket();
    if (sock) await sock.executeForOthers("refreshTracker");
  } catch (_) {
    // ignore
  }
}

/**
 * Show a non-blocking "Mission ended — Undo?" dialog after ending a mission.
 * If the GM clicks Undo, reactivates the last ended mission immediately.
 * @param {string} missionTitle
 */
// ---------------------------------------------------------------------------
// Mission history helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current mission history array (newest first).
 * @returns {Array<object>}
 */
export function getMissionHistory() {
  try {
    return game.settings.get(MODULE_ID, "missionHistory") ?? [];
  } catch (_) {
    return [];
  }
}

/**
 * Removes a single entry from the mission history by index.
 * @param {number} index
 * @returns {Promise<boolean>}
 */
export async function removeMissionFromHistory(index) {
  if (!game.user.isGM) {
    ui.notifications.warn(t("sta-officers-log.common.gmOnly"));
    return false;
  }
  try {
    const history = getMissionHistory();
    if (index < 0 || index >= history.length) return false;
    history.splice(index, 1);
    await game.settings.set(MODULE_ID, "missionHistory", history);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | removeMissionFromHistory:`, err);
    return false;
  }
}

/**
 * Shared restore logic: applies a snapshot object back to world settings and
 * actor fields, then re-renders the tracker.
 *
 * @param {object} snapshot
 * @param {{ notify?: boolean }} [options]
 */
async function _restoreFromSnapshot(snapshot, { notify = true } = {}) {
  const { title, participantIds, startDate, directives, actorLogMap } =
    snapshot;

  await game.settings.set(MODULE_ID, "missionTitle", title);
  await game.settings.set(
    MODULE_ID,
    "missionParticipants",
    Array.isArray(participantIds) ? participantIds : [],
  );
  if (startDate) {
    await game.settings.set(MODULE_ID, "missionStartDate", startDate);
  }
  if (Array.isArray(directives) && directives.length) {
    try {
      await setMissionDirectives(directives);
    } catch (_) {}
  }

  if (actorLogMap && typeof actorLogMap === "object") {
    const ops = Object.entries(actorLogMap).map(([actorId, logId]) => {
      const actor = game.actors?.get?.(actorId);
      if (!actor) return Promise.resolve();
      return actor
        .update({ "system.currentMissionLogId": logId })
        .catch((err) =>
          console.warn(
            `${MODULE_ID} | _restoreFromSnapshot: failed on ${actor.name}:`,
            err,
          ),
        );
    });
    await Promise.allSettled(ops);
  }

  if (notify) {
    ui.notifications.info(
      tf("sta-officers-log.notifications.missionReactivated", { title }) ??
        `Mission "${title}" reactivated.`,
    );
  }

  await rerenderStaTracker();
  try {
    const sock = getModuleSocket();
    if (sock) await sock.executeForOthers("refreshTracker");
  } catch (_) {}
}

/**
 * Reactivates a mission from the history array at the given index, removing
 * it from the history. Also clears the lastEndedMission snapshot if it
 * matches. GM-only.
 *
 * @param {number} index  Index into the missionHistory array (0 = most recent).
 * @returns {Promise<boolean>}
 */
export async function reactivateMissionFromHistory(index) {
  if (!game.user.isGM) {
    ui.notifications.warn(t("sta-officers-log.common.gmOnly"));
    return false;
  }

  const history = getMissionHistory();
  const snapshot = history[index];
  if (!snapshot?.title) {
    ui.notifications.warn(
      t("sta-officers-log.warnings.noUndoData") ?? "No ended mission to undo.",
    );
    return false;
  }

  // Remove from history
  history.splice(index, 1);
  try {
    await game.settings.set(MODULE_ID, "missionHistory", history);
  } catch (_) {}

  // If it matches lastEndedMission, clear that too
  try {
    const last = game.settings.get(MODULE_ID, "lastEndedMission") ?? {};
    if (last.title === snapshot.title) {
      await game.settings.set(MODULE_ID, "lastEndedMission", {});
    }
  } catch (_) {}

  await _restoreFromSnapshot(snapshot, { notify: true });
  return true;
}

/**
 * Reactivate the most recently ended mission by restoring the undo snapshot.
 * Restores missionTitle, missionParticipants, missionStartDate, directives,
 * and each actor's currentMissionLogId. GM-only.
 *
 * @param {{ notify?: boolean }} [options]
 * @returns {Promise<boolean>} true if reactivation succeeded.
 */
export async function reactivateLastEndedMission({ notify = true } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(t("sta-officers-log.common.gmOnly"));
    return false;
  }

  let snapshot = {};
  try {
    snapshot = game.settings.get(MODULE_ID, "lastEndedMission") ?? {};
  } catch (_) {}

  const { title } = snapshot;

  if (!title) {
    ui.notifications.warn(
      t("sta-officers-log.warnings.noUndoData") ?? "No ended mission to undo.",
    );
    return false;
  }

  // Clear the snapshot so it cannot be applied a second time
  try {
    await game.settings.set(MODULE_ID, "lastEndedMission", {});
  } catch (_) {}

  // Also remove from history if it appears as the most recent entry
  try {
    const history = getMissionHistory();
    if (history.length && history[0].title === title) {
      history.shift();
      await game.settings.set(MODULE_ID, "missionHistory", history);
    }
  } catch (_) {}

  await _restoreFromSnapshot(snapshot, { notify });
  return true;
}

// Used by a new button in the STATracker to start a new mission.
// Resets callback state (PCs can make 1 per mission) and adds mission logs.
// Resets stress, determination, and ship stats as selected.
export async function promptNewMissionAndReset() {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  // If a mission is currently active, end it first instead of starting a new one.
  if (hasActiveMission()) {
    return endCurrentMission();
  }

  const existingDirectives = getMissionDirectives();

  const currentTitle = game.settings.get(MODULE_ID, "missionTitle") ?? "";
  const prevParticipants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? [],
  );

  const players = game.users.filter((u) => !u.isGM);

  const playersForTemplate = players.map((u) => {
    const hasChar = Boolean(u.character && u.character.type === "character");
    return {
      id: u.id,
      name: u.name ?? "",
      hasChar,
      checked: hasChar && (prevParticipants.has(u.id) || u.active),
    };
  });

  // Check for player characters with unlinked prototype tokens
  const unlinkedTokenWarnings =
    getPlayerCharactersWithUnlinkedPrototypeTokens();

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/new-mission.hbs`,
    {
      currentTitle,
      directivesText: existingDirectives.join("\n"),
      hasPlayers: playersForTemplate.length > 0,
      players: playersForTemplate,
      hasUnlinkedTokenWarning: unlinkedTokenWarnings.length > 0,
      unlinkedTokenWarnings,
    },
  );

  const result = await foundry.applications.api.DialogV2.input({
    classes: ["sta-officers-log"],
    window: {
      title: t("sta-officers-log.dialog.newMission.title"),
      contentClasses: ["sta-new-mission-dialog"],
    },
    position: { width: 600 },
    modal: false,
    rejectClose: false,
    content,
    ok: { label: t("sta-officers-log.dialog.newMission.ok") },
    cancel: { label: t("sta-officers-log.dialog.newMission.cancel") },
    render: (_event, dialog) => {
      try {
        const html = dialog?.element;
        if (!(html instanceof HTMLElement)) return;
        const titleInput = html.querySelector('input[name="missionTitle"]');
        const okBtn = html.querySelector('button[data-action="ok"]');
        if (!titleInput || !okBtn) return;

        const updateOkState = () => {
          const hasTitle = titleInput.value.trim().length > 0;
          okBtn.disabled = !hasTitle;
        };

        titleInput.addEventListener("input", updateOkState);
        updateOkState();
      } catch (_) {
        // ignore
      }
    },
  });

  // Abort (or closed)
  if (!result) return;

  const newTitle = (result.missionTitle ?? "").toString().trim();
  const doResetCallbacks = Boolean(result.resetCallbacks);
  const doResetDetermination = Boolean(result.resetDetermination);
  const doResetStress = Boolean(result.resetStress);
  const doResetShipStats = Boolean(result.resetShipStats);
  const doResetScars = Boolean(result.resetScars);
  const doResetMomentum = Boolean(result.resetMomentum);
  const doSetThreat = Boolean(result.setThreat);
  const createMissionLogs = Boolean(result.createMissionLogs);

  // Update mission directives (persist until GM edits again)
  try {
    const rawDirectives = String(result.missionDirectivesText ?? "");
    const directives = rawDirectives
      .split(/\r?\n/g)
      .map((s) => sanitizeDirectiveText(s))
      .filter(Boolean);
    await setMissionDirectives(directives);
  } catch (_) {
    // ignore
  }

  // Run selected resets silently; we'll emit consolidated notifications below.
  if (doResetCallbacks) await resetMissionCallbacks({ notify: false });
  if (doResetDetermination) await resetDetermination({ notify: false });
  if (doResetStress) await resetStress({ notify: false });
  if (doResetShipStats) await resetShipReadiness({ notify: false });
  if (doResetScars) await resetScarUsed({ notify: false });

  // Determine selected participants
  const selectedUserIds = players
    .filter((u) => Boolean(result[`p_${u.id}`]))
    .map((u) => u.id);

  // Reset talent uses for all participating characters (sta-utils integration).
  if (
    game.modules.get("sta-utils")?.active &&
    typeof game.staUtils?.resetTalentUses === "function"
  ) {
    for (const userId of selectedUserIds) {
      const u = game.users.get(userId);
      if (u?.character) {
        await game.staUtils.resetTalentUses(u.character);
      }
    }
  }

  // Reset Momentum and/or set Threat based on selected options
  if (doResetMomentum) await _setMomentum(0);
  if (doSetThreat) await _setThreat(selectedUserIds.length * 2);

  await game.settings.set(MODULE_ID, "missionTitle", newTitle);
  await game.settings.set(MODULE_ID, "missionParticipants", selectedUserIds);
  // Clear any pending undo snapshot — the new mission supersedes the old one.
  try {
    await game.settings.set(MODULE_ID, "lastEndedMission", {});
  } catch (_) {}

  // Create a Log on each participating player's character
  if (createMissionLogs) {
    const customDate = await _computeMissionStartIsoDate();
    if (customDate) {
      await game.settings.set(MODULE_ID, "missionStartDate", customDate);
    }
    let createdCount = 0;
    for (const userId of selectedUserIds) {
      const u = game.users.get(userId);
      const logId = await addMissionLogToUser(u, newTitle, { customDate });
      if (logId) {
        await setMissionLogForUser(u.id, logId);
        createdCount++;
      }
    }

    // Consolidated notification (1/2)
    {
      const titlePart = `Mission set: ${newTitle || "(untitled)"}.`;
      const logsPart = ` Logs created for ${createdCount} character(s).`;
      const callbacksPart = doResetCallbacks ? " Callbacks reset." : "";
      ui.notifications.info(`${titlePart}${logsPart}${callbacksPart}`);
    }
  } else {
    // Consolidated notification (1/2)
    {
      const titlePart = `Mission set: ${newTitle || "(untitled)"}.`;
      const logsPart = " No new mission logs created.";
      const callbacksPart = doResetCallbacks ? " Callbacks reset." : "";
      ui.notifications.info(`${titlePart}${logsPart}${callbacksPart}`);
    }
  }

  // Consolidated notification (2/2)
  try {
    const parts = [];
    if (doResetStress) parts.push("Stress");
    if (doResetDetermination) parts.push("Determination");
    if (doResetShipStats) parts.push("Shields & Reserve Power");
    if (doResetMomentum) parts.push("Momentum → 0");
    if (doSetThreat) parts.push(`Threat → ${selectedUserIds.length * 2}`);

    if (parts.length) {
      ui.notifications.info(`${parts.join(", ")} reset.`);
    }
  } catch (_) {
    // ignore
  }

  // Re-render STA Tracker so the directives section updates
  await rerenderStaTracker();

  // Broadcast tracker refresh to other clients so directives sync
  try {
    const sock = getModuleSocket();
    if (sock) await sock.executeForOthers("refreshTracker");
  } catch (_) {
    // ignore – socket may not be registered yet
  }
}
