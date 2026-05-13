/**
 * Data model migration — flags → system fields.
 *
 * Copies sta-officers-log flag data from log and trait items into the
 * corresponding system.* fields introduced by OfficersLogData / OfficersTraitData.
 * Runs once on the GM client at world ready; subsequent loads are skipped via
 * a world-scope setting.
 *
 * v1 fields migrated (log items):
 *   callbackLink, arcInfo, primaryValueId, callbackLinkDisabled, createdWithTrauma
 *
 * v2 fields migrated (log items):
 *   customDate, showMilestoneArcButton, flowchartPosition,
 *   directiveLabels, primaryDirectiveKey, pendingMilestoneBenefit
 *
 * v2 fields migrated (trait items):
 *   isScar, isScarUsed
 *
 * v3 fields migrated (character actors):
 *   currentMissionLogId, usedCallbackThisMission, pendingShipBenefits
 */

import { MODULE_ID } from "../core/constants.js";

const MIGRATION_SETTING = "dataModelMigrationVersion";
const CURRENT_VERSION = 3;

/** Keys to copy from flags → system on each log item. */
const LOG_MIGRATED_KEYS = [
  "callbackLink",
  "arcInfo",
  "primaryValueId",
  "callbackLinkDisabled",
  "createdWithTrauma",
  "customDate",
  "customIrlDate",
  "showMilestoneArcButton",
  "flowchartPosition",
  "directiveLabels",
  "primaryDirectiveKey",
  "pendingMilestoneBenefit",
];

/** Keys to copy from flags → system on each trait item. */
const TRAIT_MIGRATED_KEYS = ["isScar", "isScarUsed"];

/** Keys to copy from flags → system on each character actor. */
const CHARACTER_MIGRATED_KEYS = [
  "currentMissionLogId",
  "usedCallbackThisMission",
  "pendingShipBenefits",
];

export function registerMigrationSetting() {
  game.settings.register(MODULE_ID, MIGRATION_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });
}

export async function runLogFlagMigration() {
  if (!game.user?.isGM) return;

  let currentVersion = 0;
  try {
    currentVersion = game.settings.get(MODULE_ID, MIGRATION_SETTING) ?? 0;
  } catch (_) {
    // Setting not yet registered on older versions — treat as 0.
  }

  if (currentVersion >= CURRENT_VERSION) return;

  console.log(
    `${MODULE_ID} | Running data migration to v${CURRENT_VERSION} (flags → system)…`,
  );

  let migrated = 0;
  let errors = 0;

  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    for (const item of actor.items ?? []) {
      if (item.type !== "log") continue;

      const updates = {};

      for (const key of LOG_MIGRATED_KEYS) {
        const flagVal = item.getFlag?.(MODULE_ID, key);
        if (flagVal === undefined || flagVal === null) continue;
        // Skip falsy primitives that match the schema initial values.
        if (flagVal === false || flagVal === "" || flagVal === 0) continue;
        updates[`system.${key}`] = flagVal;
      }

      if (!Object.keys(updates).length) continue;

      try {
        await item.update(updates, { render: false });
        migrated++;
      } catch (err) {
        console.warn(
          `${MODULE_ID} | Migration failed for log "${item.name}" on "${actor.name}":`,
          err,
        );
        errors++;
      }
    }
  }

  console.log(
    `${MODULE_ID} | Migration complete — ${migrated} logs updated, ${errors} errors.`,
  );

  // Migrate trait items (isScar, isScarUsed)
  let traitMigrated = 0;
  let traitErrors = 0;

  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;
    for (const item of actor.items ?? []) {
      if (item.type !== "trait") continue;

      const updates = {};

      for (const key of TRAIT_MIGRATED_KEYS) {
        const flagVal = item.getFlag?.(MODULE_ID, key);
        if (flagVal === undefined || flagVal === null) continue;
        if (flagVal === false || flagVal === "" || flagVal === 0) continue;
        updates[`system.${key}`] = flagVal;
      }

      if (!Object.keys(updates).length) continue;

      try {
        await item.update(updates, { render: false });
        traitMigrated++;
      } catch (err) {
        console.warn(
          `${MODULE_ID} | Migration failed for trait "${item.name}" on "${actor.name}":`,
          err,
        );
        traitErrors++;
      }
    }
  }

  if (traitMigrated || traitErrors) {
    console.log(
      `${MODULE_ID} | Trait migration complete — ${traitMigrated} traits updated, ${traitErrors} errors.`,
    );
  }

  // Migrate character actor fields (currentMissionLogId, usedCallbackThisMission, pendingShipBenefits)
  let actorMigrated = 0;
  let actorErrors = 0;

  for (const actor of game.actors ?? []) {
    if (actor.type !== "character") continue;

    const updates = {};

    for (const key of CHARACTER_MIGRATED_KEYS) {
      const flagVal = actor.getFlag?.(MODULE_ID, key);
      if (flagVal === undefined || flagVal === null) continue;
      // Skip falsy primitives matching schema initials.
      if (flagVal === false || flagVal === "" || flagVal === 0) continue;
      // Skip empty arrays (pendingShipBenefits default)
      if (Array.isArray(flagVal) && flagVal.length === 0) continue;
      updates[`system.${key}`] = flagVal;
    }

    if (!Object.keys(updates).length) continue;

    try {
      await actor.update(updates, { render: false });
      actorMigrated++;
    } catch (err) {
      console.warn(
        `${MODULE_ID} | Migration failed for actor "${actor.name}":`,
        err,
      );
      actorErrors++;
    }
  }

  if (actorMigrated || actorErrors) {
    console.log(
      `${MODULE_ID} | Actor migration complete — ${actorMigrated} actors updated, ${actorErrors} errors.`,
    );
  }

  try {
    await game.settings.set(MODULE_ID, MIGRATION_SETTING, CURRENT_VERSION);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not save migration version:`, err);
  }
}
