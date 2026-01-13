import { MODULE_ID } from "./constants.js";
import { t, tf } from "./i18n.js";

export const GROUP_SHIP_ACTOR_SETTING = "groupShipActorId";

export function registerMissionSettings() {
  game.settings.register(MODULE_ID, "missionCallbackUsed", {
    name: "Mission Callback Used Map",
    hint: "Internal map of userId -> true for whether they've used a callback this mission.",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

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

  game.settings.register(MODULE_ID, "missionLogByUser", {
    name: "Mission Log By User",
    hint: "Internal map userId -> mission-start log itemId.",
    scope: "world",
    config: false,
    type: Object,
    default: {},
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
}

export function getGroupShipActorId() {
  try {
    return String(game.settings.get(MODULE_ID, GROUP_SHIP_ACTOR_SETTING) ?? "");
  } catch (_) {
    return "";
  }
}

export function getMissionLogByUser() {
  return game.settings.get(MODULE_ID, "missionLogByUser") ?? {};
}

export function getCurrentMissionLogIdForUser(userId) {
  return getMissionLogByUser()?.[userId] ?? null;
}

export async function setMissionLogForUser(userId, logId) {
  const map = foundry.utils.deepClone(getMissionLogByUser());
  map[userId] = logId;
  await game.settings.set(MODULE_ID, "missionLogByUser", map);
}

export function isLogUsed(item) {
  const sys = item.system ?? {};
  if (Object.prototype.hasOwnProperty.call(sys, "used"))
    return Boolean(sys.used);

  const flag = item.getFlag?.("world", "used");
  if (typeof flag !== "undefined") return Boolean(flag);

  // Allow the module to track "used" invisibly (so players can keep Log fields manual).
  const moduleFlag = item.getFlag?.(MODULE_ID, "logUsed");
  if (typeof moduleFlag !== "undefined") return Boolean(moduleFlag);

  return false;
}

function getMissionCallbackUsedMap() {
  return game.settings.get(MODULE_ID, "missionCallbackUsed") ?? {};
}

export function hasUsedCallbackThisMission(userId) {
  const map = getMissionCallbackUsedMap();
  return Boolean(map?.[userId]);
}

export async function setUsedCallbackThisMission(userId, used) {
  const map = foundry.utils.deepClone(getMissionCallbackUsedMap());
  if (used) map[userId] = true;
  else delete map[userId];
  await game.settings.set(MODULE_ID, "missionCallbackUsed", map);
}

export async function resetMissionCallbacks() {
  await game.settings.set(MODULE_ID, "missionCallbackUsed", {});
  // Preserve previous behavior by default.
  const notify = arguments?.length ? arguments[0]?.notify !== false : true;
  if (notify) {
    ui.notifications.info(t("sta-officers-log.notifications.callbacksReset"));
  }
}

export async function resetDetermination({ notify = true } = {}) {
  const updates = [];
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    updates.push(actor.update({ "system.determination.value": 1 }));
  }
  await Promise.allSettled(updates);
  if (notify) {
    ui.notifications.info(
      t("sta-officers-log.notifications.allDeterminationReset")
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
        })
      );
    } else {
      // Small craft: shields only (no reserve power).
      updates.push(actor.update({ "system.shields.value": resetTo }));
    }
  }

  await Promise.allSettled(updates);
  if (notify) {
    ui.notifications.info(
      t("sta-officers-log.notifications.allShipReadinessReset")
    );
  }
}

async function _tryDecrementStaMomentum() {
  try {
    const world = game.settings.storage?.get?.("world");
    const doc =
      world?.find?.((s) => s?.key === "sta.momentum") ??
      world?.contents?.find?.((s) => s?.key === "sta.momentum") ??
      null;

    const cur = Number(doc?.value);
    if (!Number.isFinite(cur)) return false;
    const next = Math.max(0, cur - 1);

    const rerenderStaTracker = async () => {
      try {
        // Foundry v13+ tracker windows live in the ApplicationV2 registry.
        // In some environments, `instanceof STATracker` can fail (module realms/bundling),
        // so prefer matching by constructor name.
        const Tracker = globalThis?.STATracker;

        const inst = globalThis?.foundry?.applications?.instances;
        const apps = [];
        if (inst && typeof inst.values === "function") {
          for (const app of inst.values()) apps.push(app);
        } else if (inst && typeof inst === "object") {
          for (const app of Object.values(inst)) apps.push(app);
        }

        const uniq = Array.from(new Set(apps)).filter(Boolean);

        const forceRefreshApp = async (app) => {
          // Some tracker implementations cache derived state and need an explicit refresh.
          try {
            if (typeof app?.refresh === "function") {
              await app.refresh();
              return true;
            }
          } catch (_) {
            // ignore
          }

          // Foundry Application (legacy): render(force)
          // Foundry ApplicationV2: render({force: true})
          try {
            if (typeof app?.render === "function") {
              await app.render({ force: true });
              return true;
            }
          } catch (_) {
            // ignore
          }

          try {
            if (typeof app?.render === "function") {
              await app.render(true);
              return true;
            }
          } catch (_) {
            // ignore
          }

          try {
            if (typeof app?.render === "function") {
              await app.render();
              return true;
            }
          } catch (_) {
            // ignore
          }

          // Last resort: some apps still expose the legacy private render.
          try {
            if (typeof app?._render === "function") {
              await app._render(true);
              return true;
            }
          } catch (_) {
            // ignore
          }

          return false;
        };

        for (const app of uniq) {
          const ctorName = String(app?.constructor?.name ?? "");
          const isTracker =
            ctorName === "STATracker" || (Tracker && app instanceof Tracker);
          if (!isTracker) continue;

          await forceRefreshApp(app);
        }
      } catch (_) {
        // ignore
      }
    };

    // Prefer the system's normal settings API so any onChange handlers rerender the tracker.
    try {
      await game.settings.set("sta", "momentum", next);
      rerenderStaTracker();
      setTimeout(() => rerenderStaTracker(), 50);
      setTimeout(() => rerenderStaTracker(), 250);
      return true;
    } catch (_) {
      // Some system versions store this as a string; try again.
      try {
        await game.settings.set("sta", "momentum", String(next));
        rerenderStaTracker();
        setTimeout(() => rerenderStaTracker(), 50);
        setTimeout(() => rerenderStaTracker(), 250);
        return true;
      } catch (_) {
        // Fall back to updating the Setting document directly.
      }
    }

    if (!doc) return false;
    await doc.update({ value: String(next) });

    // If the system registered the setting, best-effort invoke its onChange handler.
    try {
      const cfg = game.settings.settings?.get?.("sta.momentum");
      cfg?.onChange?.(String(next));
    } catch (_) {
      // ignore
    }

    rerenderStaTracker();
    setTimeout(() => rerenderStaTracker(), 50);
    setTimeout(() => rerenderStaTracker(), 250);

    return true;
  } catch (_) {
    return false;
  }
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
    if (sheetClass !== "sta.STANPCSheet2e") continue;

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
    "try { game.staCallbacksHelper?.newScene?.(); } catch (err) { console.error('sta-officers-log | New Scene macro failed', err); ui.notifications?.error?.('New Scene failed; see console.'); }";

  const existing = (game.macros ?? []).find(
    (m) =>
      m?.name === name &&
      (m?.type ?? m?.command ? "script" : m?.type) !== "chat"
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

function _uniqueItemName(actor, baseName) {
  const existing = new Set(actor.items.map((i) => i.name));
  if (!existing.has(baseName)) return baseName;

  let n = 2;
  while (existing.has(`${baseName} (${n})`)) n++;
  return `${baseName} (${n})`;
}

async function addMissionLogToUser(user, missionTitle) {
  const actor = user?.character;
  if (!actor || actor.type !== "character") return null;

  const baseName = missionTitle?.trim() || "New Mission";
  const name = _uniqueItemName(actor, baseName);

  const maxSort = Math.max(
    0,
    ...actor.items
      .filter((i) => i.type === "log")
      .map((i) => Number(i.sort ?? 0))
  );

  const [created] = await actor.createEmbeddedDocuments("Item", [
    { name, type: "log", sort: maxSort + 1 },
  ]);

  return created?.id ?? null;
}

export async function addParticipantToCurrentMission(
  userId,
  { createLog = true } = {}
) {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const user = game.users.get(userId);
  if (!user || user.isGM)
    return ui.notifications.warn(
      t("sta-officers-log.notifications.invalidUser")
    );
  if (!user.character)
    return ui.notifications.warn(
      tf("sta-officers-log.notifications.userNoCharacter", {
        user: user.name,
      })
    );

  const title = (game.settings.get(MODULE_ID, "missionTitle") ?? "").trim();
  const missionTitle = title || "New Mission";

  // 1) Add to participants list
  const participants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? []
  );
  participants.add(userId);
  await game.settings.set(
    MODULE_ID,
    "missionParticipants",
    Array.from(participants)
  );

  // 2) Ensure they can still callback this mission
  await setUsedCallbackThisMission(userId, false);

  // 3) Optionally create a mission log and store mapping
  if (createLog) {
    const logId = await addMissionLogToUser(user, missionTitle);
    if (logId) await setMissionLogForUser(userId, logId);
  }

  ui.notifications.info(
    createLog
      ? tf("sta-officers-log.notifications.addedToMissionLogCreated", {
          user: user.name,
        })
      : tf("sta-officers-log.notifications.addedToMission", {
          user: user.name,
        })
  );
}

export async function promptAddParticipant() {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const participants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? []
  );
  const users = game.users.filter((u) => !u.isGM);

  const available = users.filter((u) => !participants.has(u.id));
  const already = users.filter((u) => participants.has(u.id));

  if (!available.length) {
    return ui.notifications.warn(
      t("sta-officers-log.notifications.allPlayersAlreadyInMission")
    );
  }

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/add-player.hbs`,
    {
      available: available.map((u, idx) => ({
        id: u.id,
        name: u.name ?? "",
        selected: idx === 0,
      })),
      already: already.map((u) => ({
        id: u.id,
        name: u.name ?? "",
      })),
    }
  );

  const result = await foundry.applications.api.DialogV2.input({
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

export async function promptNewMissionAndReset() {
  if (!game.user.isGM)
    return ui.notifications.warn(t("sta-officers-log.common.gmOnly"));

  const currentTitle = game.settings.get(MODULE_ID, "missionTitle") ?? "";
  const prevParticipants = new Set(
    game.settings.get(MODULE_ID, "missionParticipants") ?? []
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

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/new-mission.hbs`,
    {
      currentTitle,
      hasPlayers: playersForTemplate.length > 0,
      players: playersForTemplate,
    }
  );

  const result = await foundry.applications.api.DialogV2.input({
    window: { title: t("sta-officers-log.dialog.newMission.title") },
    modal: false,
    rejectClose: false,
    content,
    ok: { label: t("sta-officers-log.dialog.newMission.ok") },
    cancel: { label: t("sta-officers-log.dialog.newMission.cancel") },
  });

  // Abort (or closed)
  if (!result) return;

  const newTitle = (result.missionTitle ?? "").toString().trim();
  const doResetCallbacks = Boolean(result.resetCallbacks);
  const doResetDetermination = Boolean(result.resetDetermination);
  const doResetStress = Boolean(result.resetStress);
  const doResetShipStats = Boolean(result.resetShipStats);
  const createMissionLogs = Boolean(result.createMissionLogs);

  // Run selected resets silently; we'll emit consolidated notifications below.
  if (doResetCallbacks) await resetMissionCallbacks({ notify: false });
  if (doResetDetermination) await resetDetermination({ notify: false });
  if (doResetStress) await resetStress({ notify: false });
  if (doResetShipStats) await resetShipReadiness({ notify: false });

  // Determine selected participants
  const selectedUserIds = players
    .filter((u) => Boolean(result[`p_${u.id}`]))
    .map((u) => u.id);

  await game.settings.set(MODULE_ID, "missionTitle", newTitle);
  await game.settings.set(MODULE_ID, "missionParticipants", selectedUserIds);

  // Create a Log on each participating player's character
  if (createMissionLogs) {
    // New mission => new per-user mission log ids
    await game.settings.set(MODULE_ID, "missionLogByUser", {});

    let createdCount = 0;
    for (const userId of selectedUserIds) {
      const u = game.users.get(userId);
      const logId = await addMissionLogToUser(u, newTitle);
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

    if (parts.length) {
      ui.notifications.info(`${parts.join(", ")} reset.`);
    }
  } catch (_) {
    // ignore
  }
}
