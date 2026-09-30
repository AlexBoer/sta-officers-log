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
 *
 * v4 cleanup:
 *   Unset stale showMilestoneArcButton flags on log items where the system
 *   field is false but the legacy flag was left behind by older clearing code.
 */

import { MODULE_ID } from "../core/constants.js";

const MIGRATION_SETTING = "dataModelMigrationVersion";
const CURRENT_VERSION = 8;

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
  let migrationFailures = 0;

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
        migrationFailures++;
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
        migrationFailures++;
      }
    }
  }

  if (traitMigrated || traitErrors) {
    console.log(
      `${MODULE_ID} | Trait migration complete — ${traitMigrated} traits updated, ${traitErrors} errors.`,
    );
  }

  if (currentVersion < 5) {
    const housesByName = new Map();
    for (const house of game.actors ?? []) {
      if (house.type !== "sta-officers-log.house") continue;
      const key = house.name.trim().toLowerCase();
      if (!key) continue;
      if (housesByName.has(key)) {
        housesByName.set(key, null);
      } else {
        housesByName.set(key, house);
      }
    }

    let houseLinks = 0;
    let houseLinkErrors = 0;
    for (const actor of game.actors ?? []) {
      if (actor.type !== "character") continue;
      if (actor.system?.houseActorUuid) continue;
      const legacyName = String(actor.system?.house ?? "")
        .trim()
        .toLowerCase();
      const house = legacyName ? housesByName.get(legacyName) : null;
      if (!house) continue;

      try {
        await actor.update(
          {
            "system.houseActorUuid": house.uuid,
            "system.house": house.name,
            "system.showklingon": true,
          },
          { render: false },
        );
        houseLinks++;
      } catch (err) {
        console.warn(
          `${MODULE_ID} | House link migration failed for "${actor.name}":`,
          err,
        );
        houseLinkErrors++;
        migrationFailures++;
      }
    }

    if (houseLinks || houseLinkErrors) {
      console.log(
        `${MODULE_ID} | House link migration — ${houseLinks} linked, ${houseLinkErrors} errors.`,
      );
    }
  }

  if (currentVersion < 6) {
    let normalizedHouses = 0;
    for (const house of game.actors ?? []) {
      if (house.type !== "sta-officers-log.house") continue;
      const updates = {};
      for (const key of ["influence", "might", "wealth"]) {
        if (Number(house.system?.[key] ?? 0) < 6) updates[`system.${key}`] = 6;
      }
      if (Number(house.system?.reputation ?? 0) < 1) {
        updates["system.reputation"] = 3;
      }
      if (!Object.keys(updates).length) continue;
      try {
        await house.update(updates, { render: false });
        normalizedHouses++;
      } catch (err) {
        console.warn(
          `${MODULE_ID} | House normalization failed for "${house.name}":`,
          err,
        );
        migrationFailures++;
      }
    }
    if (normalizedHouses) {
      console.log(
        `${MODULE_ID} | House normalization — ${normalizedHouses} Houses updated.`,
      );
    }
  }

  if (currentVersion < 7) {
    let convertedHouseItems = 0;
    for (const house of game.actors ?? []) {
      if (house.type !== "sta-officers-log.house") continue;

      const focusNames = house.system?.legacy?.suggestedFocuses ?? [];
      const talentNames = house.system?.legacy?.suggestedTalents ?? [];
      const existingFocuses = new Set(
        house.items
          .filter((item) => item.type === "focus")
          .map((item) => item.name.trim().toLowerCase()),
      );
      const existingTalents = new Set(
        house.items
          .filter((item) => item.type === "talent")
          .map((item) => item.name.trim().toLowerCase()),
      );
      const items = [];
      for (const name of focusNames) {
        const trimmed = String(name ?? "").trim();
        if (trimmed && !existingFocuses.has(trimmed.toLowerCase())) {
          items.push({ name: trimmed, type: "focus" });
          existingFocuses.add(trimmed.toLowerCase());
        }
      }
      for (const name of talentNames) {
        const trimmed = String(name ?? "").trim();
        if (trimmed && !existingTalents.has(trimmed.toLowerCase())) {
          items.push({ name: trimmed, type: "talent" });
          existingTalents.add(trimmed.toLowerCase());
        }
      }
      if (!items.length && !focusNames.length && !talentNames.length) continue;

      try {
        if (items.length) await house.createEmbeddedDocuments("Item", items);
        await house.update(
          {
            "system.legacy.suggestedFocuses": [],
            "system.legacy.suggestedTalents": [],
          },
          { render: false },
        );
        convertedHouseItems += items.length;
      } catch (err) {
        console.warn(
          `${MODULE_ID} | House item migration failed for "${house.name}":`,
          err,
        );
        migrationFailures++;
      }
    }
    if (convertedHouseItems) {
      console.log(
        `${MODULE_ID} | House item migration — ${convertedHouseItems} items created.`,
      );
    }
  }

  if (currentVersion < 8) {
    const attributeKeys = [
      "control",
      "daring",
      "fitness",
      "insight",
      "presence",
      "reason",
    ];
    const departmentKeys = [
      "command",
      "conn",
      "engineering",
      "medicine",
      "science",
      "security",
    ];
    let consolidatedHouses = 0;
    for (const house of game.actors ?? []) {
      if (house.type !== "sta-officers-log.house") continue;
      const attributeBonuses = Object.fromEntries(
        attributeKeys.map((key) => [
          key,
          ["status", "legacy", "temperament"].reduce(
            (total, choice) =>
              total +
              Number(house.system?.[choice]?.attributeBonuses?.[key] ?? 0),
            0,
          ),
        ]),
      );
      const departmentBonuses = Object.fromEntries(
        departmentKeys.map((key) => [
          key,
          ["status", "legacy", "temperament"].reduce(
            (total, choice) =>
              total +
              Number(house.system?.[choice]?.departmentBonuses?.[key] ?? 0),
            0,
          ),
        ]),
      );
      try {
        await house.update(
          {
            "system.attributeBonuses": attributeBonuses,
            "system.departmentBonuses": departmentBonuses,
          },
          { render: false },
        );
        consolidatedHouses++;
      } catch (err) {
        console.warn(
          `${MODULE_ID} | House bonus consolidation failed for "${house.name}":`,
          err,
        );
        migrationFailures++;
      }
    }
    if (consolidatedHouses) {
      console.log(
        `${MODULE_ID} | House bonus consolidation — ${consolidatedHouses} Houses updated.`,
      );
    }
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
      migrationFailures++;
    }
  }

  if (actorMigrated || actorErrors) {
    console.log(
      `${MODULE_ID} | Actor migration complete — ${actorMigrated} actors updated, ${actorErrors} errors.`,
    );
  }

  // v4: Unset stale showMilestoneArcButton flags on log items where the system
  // field is already false (benefit was chosen) but the legacy flag was never
  // cleared by older code, causing the "Choose Milestone" button to persist.
  if (currentVersion < 4) {
    let flagFixCount = 0;
    let flagFixErrors = 0;
    for (const actor of game.actors ?? []) {
      if (actor.type !== "character") continue;
      for (const item of actor.items ?? []) {
        if (item.type !== "log") continue;
        const flagVal = item.getFlag?.(MODULE_ID, "showMilestoneArcButton");
        if (flagVal !== true) continue;
        // Only unset the flag if the system field is already false (was cleared
        // after a benefit was chosen, leaving a stale flag behind).
        if (item.system?.showMilestoneArcButton === true) continue;
        try {
          await item.unsetFlag(MODULE_ID, "showMilestoneArcButton");
          flagFixCount++;
        } catch (err) {
          console.warn(
            `${MODULE_ID} | v4 flag cleanup failed for log "${item.name}" on "${actor.name}":`,
            err,
          );
          flagFixErrors++;
          migrationFailures++;
        }
      }
    }
    if (flagFixCount || flagFixErrors) {
      console.log(
        `${MODULE_ID} | v4 flag cleanup — ${flagFixCount} stale showMilestoneArcButton flags removed, ${flagFixErrors} errors.`,
      );
    }
  }

  if (migrationFailures > 0) {
    throw new Error(
      `${migrationFailures} document migration operation(s) failed; the migration will retry on the next startup.`,
    );
  }

  await game.settings.set(MODULE_ID, MIGRATION_SETTING, CURRENT_VERSION);
}
