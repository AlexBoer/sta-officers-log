/**
 * Benefit Action Handlers
 *
 * Extracted handler functions for individual milestone benefit actions.
 * Used by both arc and non-arc milestone benefit flows.
 */

import { t } from "../core/i18n.js";
import { escapeHTML } from "../data/values.js";
import { getGroupShipActorId } from "../data/mission.js";
import { MODULE_ID } from "../core/constants.js";
import {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
  SHIP_SYSTEM_KEYS,
  SHIP_DEPARTMENT_KEYS,
  SHIP_SYSTEM_LABELS,
  SHIP_DEPARTMENT_LABELS,
  _getFirstExistingNumeric,
  _getStaSelectionFlag,
  _promptManualMilestoneInstructions,
  _promptSelect,
  _promptText,
  _promptTwoSelect,
  _setStaSelectionFlag,
} from "./dialogs.js";

import { promptFocusChoiceFromCompendium } from "./focusPickerDialog.js";
import {
  promptTalentChoiceFromCompendium,
  promptShipTalentChoiceFromCompendium,
} from "./talentPickerDialog.js";
import { promptShipTalentSwapDialog } from "./shipTalentSwapDialog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function createItem(actor, itemData) {
  const [created] = await actor.createEmbeddedDocuments("Item", [itemData]);
  return created ?? null;
}

export function localizeStaLabel(labelOrKey) {
  const raw = String(labelOrKey ?? "");
  if (!raw) return "";
  try {
    if (raw.startsWith("sta.")) return game.i18n?.localize?.(raw) ?? raw;
  } catch (_) {
    // ignore
  }
  return raw;
}

export function getGroupShipActor() {
  const id = getGroupShipActorId?.() ?? "";
  if (!id) return null;
  return game.actors?.get?.(id) ?? null;
}

export function isSupportingActor(actor) {
  const sheetClass =
    actor?.getFlag?.("core", "sheetClass") ??
    foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
    "";
  return String(sheetClass) === "sta.STASupportingSheet2e";
}

export function canEditShip(ship) {
  try {
    if (game.user?.isGM) return true;
    if (typeof ship.testUserPermission === "function")
      return ship.testUserPermission(game.user, "OWNER");
    return Boolean(ship.isOwner);
  } catch (_) {
    return Boolean(ship?.isOwner);
  }
}

/**
 * Shared helper for prompting attribute or discipline selection.
 * @param {Actor} actor - The actor to check stats for
 * @param {Object} options - Configuration options
 * @param {string} options.type - "attribute" or "discipline"
 * @param {number} options.maxValue - Maximum allowed value
 * @param {string} [options.flagPrefix] - If provided, track selection with this flag prefix
 * @param {string} options.actionName - Action name for the result
 * @returns {Promise<{applied: boolean, action?: string, key?: string}>}
 */
async function _promptStatSelection(
  actor,
  { type, maxValue, flagPrefix, actionName },
) {
  const isAttribute = type === "attribute";
  const keys = isAttribute ? ATTRIBUTE_KEYS : DISCIPLINE_KEYS;
  const labels = isAttribute ? ATTRIBUTE_LABELS : DISCIPLINE_LABELS;
  const promptLabel = isAttribute
    ? t("sta-officers-log.dialog.chooseMilestoneBenefit.pickAttribute")
    : t("sta-officers-log.dialog.chooseMilestoneBenefit.pickDiscipline");
  const fieldName = isAttribute ? "attributeKey" : "disciplineKey";

  const optionsHtml =
    '<option value="" selected></option>' +
    keys
      .map((k) => {
        const paths = isAttribute
          ? [`system.attribute.${k}.value`, `system.attributes.${k}.value`]
          : [`system.disciplines.${k}.value`];
        const cur = _getFirstExistingNumeric(actor, paths).value;
        const atMax = Number(cur ?? 0) >= maxValue;
        const improved = flagPrefix
          ? _getStaSelectionFlag(actor, `${flagPrefix}.${k}`)
          : false;
        const dis = atMax || improved ? " disabled" : "";
        const suffix = atMax
          ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.max")})`
          : improved
            ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.used")})`
            : "";
        const label = labels[k] ?? k;
        return `<option value="${k}"${dis}>${escapeHTML(label)}${escapeHTML(
          suffix,
        )}</option>`;
      })
      .join("");

  let picked;
  while (true) {
    picked = await _promptSelect({
      title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
      label: promptLabel,
      name: fieldName,
      optionsHtml,
    });
    if (picked === "cancel" || picked == null) return { applied: false };
    if (String(picked) === "") continue;
    break;
  }

  const key = String(picked);

  // Check if already improved (for non-arc milestones with tracking)
  if (flagPrefix && _getStaSelectionFlag(actor, `${flagPrefix}.${key}`)) {
    ui.notifications?.warn(
      t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"),
    );
    return { applied: false };
  }

  const paths = isAttribute
    ? [`system.attribute.${key}.value`, `system.attributes.${key}.value`]
    : [`system.disciplines.${key}.value`];
  const { path, value } = _getFirstExistingNumeric(actor, paths);

  if (!path) {
    ui.notifications?.error(
      t("sta-officers-log.dialog.chooseMilestoneBenefit.pathMissing"),
    );
    return { applied: false };
  }
  if (value >= maxValue) {
    ui.notifications?.warn(
      t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyMax"),
    );
    return { applied: false };
  }

  await actor.update({ [path]: Math.min(maxValue, value + 1) });

  // Set selection flag if tracking
  if (flagPrefix) {
    await _setStaSelectionFlag(actor, `${flagPrefix}.${key}`, true);
  }

  return { applied: true, action: actionName, key };
}

// ─────────────────────────────────────────────────────────────────────────────
// Arc Milestone Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle arc milestone: Remove Trauma (rename value and clear trauma flag).
 */
export async function handleArcRemoveTrauma(actor, traumaValueId) {
  if (!traumaValueId) {
    ui.notifications?.error("No trauma value specified.");
    return { applied: false };
  }

  const traumaItem = actor.items.get(traumaValueId);
  if (!traumaItem || traumaItem.type !== "value") {
    ui.notifications?.error("Trauma value not found.");
    return { applied: false };
  }

  const newName = await _promptText({
    title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
    label: t(
      "sta-officers-log.dialog.chooseMilestoneBenefit.arcRemoveTraumaRenameLabel",
    ),
    name: "traumaNewName",
    placeholder:
      t(
        "sta-officers-log.dialog.chooseMilestoneBenefit.arcRemoveTraumaRenamePlaceholder",
      ) ?? traumaItem.name,
  });
  if (!newName) return { applied: false };

  await traumaItem.update({ name: newName });
  await traumaItem.setFlag(MODULE_ID, "isTrauma", false);

  return {
    applied: true,
    action: "arcRemoveTrauma",
    traumaValueId,
    oldName: traumaItem.name,
    newName,
  };
}

/**
 * Handle arc milestone: Increase Attribute (+1, max 12).
 */
export async function handleArcAttribute(actor) {
  return _promptStatSelection(actor, {
    type: "attribute",
    maxValue: 12,
    flagPrefix: null,
    actionName: "arcAttr",
  });
}

/**
 * Handle arc milestone: Increase Discipline (+1, max 5).
 */
export async function handleArcDiscipline(actor) {
  return _promptStatSelection(actor, {
    type: "discipline",
    maxValue: 5,
    flagPrefix: null,
    actionName: "arcDisc",
  });
}

/**
 * Handle arc milestone: Add new Value.
 */
export async function handleArcValue(actor) {
  const created = await createItem(actor, {
    name: "New Value",
    type: "value",
  });
  return {
    applied: true,
    action: "arcValue",
    name: created?.name ?? "",
    createdItemId: created?.id ?? "",
  };
}

/**
 * Handle arc milestone: Increase Ship System (+1).
 * Returns { back: true } if user chose to go back.
 */
export async function handleArcShipSystem(actor, isSingleAction) {
  const ship = getGroupShipActor();
  if (!ship) {
    ui.notifications?.warn?.(
      "No Group Ship selected. Configure it in Module Settings.",
    );
    return { applied: false };
  }

  const optionsHtml = SHIP_SYSTEM_KEYS.map((k, idx) => {
    const improved = _getStaSelectionFlag(actor, `system.${k}`);
    const sel = idx === 0 ? " selected" : "";
    const dis = improved ? " disabled" : "";
    const suffix = improved
      ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.used")})`
      : "";
    const label = SHIP_SYSTEM_LABELS[k] ?? k;
    return `<option value="${k}"${sel}${dis}>${escapeHTML(label)}${escapeHTML(
      suffix,
    )}</option>`;
  }).join("");

  const picked = await _promptSelect({
    title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
    label: t(
      "sta-officers-log.dialog.chooseMilestoneBenefit.arcPickShipSystem",
    ),
    name: "shipSystemKey",
    optionsHtml,
  });
  if (!picked || picked === "cancel") return { applied: false };

  const key = String(picked);
  if (_getStaSelectionFlag(actor, `system.${key}`)) {
    ui.notifications?.warn(
      t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"),
    );
    return { applied: false };
  }

  if (!canEditShip(ship)) {
    const label =
      localizeStaLabel(ship.system?.systems?.[key]?.label) ||
      SHIP_SYSTEM_LABELS[key] ||
      key;
    const manualOutcome = await handleShipPermissionFallback({
      actor,
      ship,
      descriptionKey:
        "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseShipSystem",
      instruction: "Ask the GM to increase this ship system by 1:",
      label,
      flagPath: `system.${key}`,
      manualAction: "arcShipSystemManual",
      extraPayload: { key },
    });

    if (manualOutcome.status === "back") {
      return isSingleAction ? { applied: false, back: true } : { back: true };
    }
    if (manualOutcome.status === "cancel") return { applied: false };
    if (manualOutcome.status === "confirm") {
      return manualOutcome.result;
    }
    return { applied: false };
  }

  const path = `system.systems.${key}.value`;
  const cur = Number(foundry.utils.getProperty(ship, path) ?? 0);
  const next = (Number.isFinite(cur) ? cur : 0) + 1;

  try {
    await ship.update({ [path]: next });
  } catch (err) {
    console.error("sta-officers-log | arc ship system update failed", err);
    ui.notifications?.error?.("Failed to update the Group Ship.");
    return { applied: false };
  }

  await _setStaSelectionFlag(actor, `system.${key}`, true);
  return { applied: true, action: "arcShipSystem", key, shipId: ship.id };
}

/**
 * Handle arc milestone: Increase Ship Department (+1).
 * Returns { back: true } if user chose to go back.
 */
export async function handleArcShipDepartment(actor, isSingleAction) {
  const ship = getGroupShipActor();
  if (!ship) {
    ui.notifications?.warn?.(
      "No Group Ship selected. Configure it in Module Settings.",
    );
    return { applied: false };
  }

  const optionsHtml = SHIP_DEPARTMENT_KEYS.map((k, idx) => {
    const improved = _getStaSelectionFlag(actor, `department.${k}`);
    const sel = idx === 0 ? " selected" : "";
    const dis = improved ? " disabled" : "";
    const suffix = improved
      ? ` (${t("sta-officers-log.dialog.chooseMilestoneBenefit.used")})`
      : "";
    const label = SHIP_DEPARTMENT_LABELS[k] ?? k;
    return `<option value="${k}"${sel}${dis}>${escapeHTML(label)}${escapeHTML(
      suffix,
    )}</option>`;
  }).join("");

  const picked = await _promptSelect({
    title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
    label: t(
      "sta-officers-log.dialog.chooseMilestoneBenefit.arcPickShipDepartment",
    ),
    name: "shipDepartmentKey",
    optionsHtml,
  });
  if (!picked || picked === "cancel") return { applied: false };

  const key = String(picked);
  if (_getStaSelectionFlag(actor, `department.${key}`)) {
    ui.notifications?.warn(
      t("sta-officers-log.dialog.chooseMilestoneBenefit.alreadyImproved"),
    );
    return { applied: false };
  }

  if (!canEditShip(ship)) {
    const label =
      localizeStaLabel(ship.system?.departments?.[key]?.label) ||
      SHIP_DEPARTMENT_LABELS[key] ||
      key;
    const manualOutcome = await handleShipPermissionFallback({
      actor,
      ship,
      descriptionKey:
        "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseShipDepartment",
      instruction: "Ask the GM to increase this ship department by 1:",
      label,
      flagPath: `department.${key}`,
      manualAction: "arcShipDepartmentManual",
      extraPayload: { key },
    });

    if (manualOutcome.status === "back") {
      return isSingleAction ? { applied: false, back: true } : { back: true };
    }
    if (manualOutcome.status === "cancel") return { applied: false };
    if (manualOutcome.status === "confirm") {
      return manualOutcome.result;
    }
    return { applied: false };
  }

  const path = `system.departments.${key}.value`;
  const cur = Number(foundry.utils.getProperty(ship, path) ?? 0);
  const next = Math.min(5, (Number.isFinite(cur) ? cur : 0) + 1);

  try {
    await ship.update({ [path]: next });
  } catch (err) {
    console.error("sta-officers-log | arc ship department update failed", err);
    ui.notifications?.error?.("Failed to update the Group Ship.");
    return { applied: false };
  }

  await _setStaSelectionFlag(actor, `department.${key}`, true);
  return {
    applied: true,
    action: "arcShipDepartment",
    key,
    shipId: ship.id,
  };
}

/**
 * Handle arc milestone: Add Ship Talent.
 * Returns { back: true } if user chose to go back.
 */
export async function handleArcShipTalent(actor, isSingleAction) {
  const ship = getGroupShipActor();
  if (!ship) {
    ui.notifications?.warn?.(
      "No Group Ship selected. Configure it in Module Settings.",
    );
    return { applied: false };
  }

  const chosen = await promptShipTalentChoiceFromCompendium({
    actor: ship,
  });
  if (!chosen) return { applied: false };

  if (!canEditShip(ship)) {
    const res = await _promptManualMilestoneInstructions({
      title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
      html: `
        <p><strong>${t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcAddShipTalent",
        )}</strong></p>
        <p><strong>Group Ship:</strong> ${escapeHTML(ship.name ?? "")}</p>
        <p>You don't have permission to update the Group Ship.</p>
        <p>Ask the GM to add this ship talent:</p>
        <p><strong>${escapeHTML(chosen.name)}</strong></p>
        <p><em>${escapeHTML(
          t("sta-officers-log.dialog.chooseMilestoneBenefit.manualConfirmHint"),
        )}</em></p>
      `,
    });
    if (res === "back") {
      return isSingleAction ? { applied: false, back: true } : { back: true };
    }
    if (!res || res === "cancel") return { applied: false };
    if (res === "confirm") {
      return {
        applied: true,
        action: "arcShipTalentManual",
        name: chosen.name,
        shipId: ship.id,
      };
    }
    return { applied: false };
  }

  const type = (ship.items ?? []).some((i) => i?.type === "shipTalent")
    ? "shipTalent"
    : "talent";

  try {
    const sourceShipTalent = chosen.item
      ? foundry.utils.deepClone(chosen.item)
      : {};
    delete sourceShipTalent._id;
    const shipTalentData = {
      ...sourceShipTalent,
      type,
      name: chosen.name ?? sourceShipTalent.name ?? "",
      img: chosen.img ?? sourceShipTalent.img ?? sourceShipTalent.image ?? null,
    };
    const created = await createItem(ship, shipTalentData);
    return {
      applied: true,
      action: "arcShipTalent",
      name: created?.name ?? chosen.name,
      createdItemId: created?.id ?? "",
      sourceUuid: chosen.uuid ?? "",
      shipId: ship.id,
    };
  } catch (err) {
    console.error("sta-officers-log | arc ship talent add failed", err);
    ui.notifications?.error?.("Failed to update the Group Ship.");
    return { applied: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normal/Spotlight Milestone Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle normal milestone: Increase Attribute (+1, max 11, track used).
 */
export async function handleAttribute(actor) {
  return _promptStatSelection(actor, {
    type: "attribute",
    maxValue: 11,
    flagPrefix: "attributes",
    actionName: "attr",
  });
}

/**
 * Handle normal milestone: Increase Discipline (+1, max 4, track used).
 */
export async function handleDiscipline(actor) {
  return _promptStatSelection(actor, {
    type: "discipline",
    maxValue: 4,
    flagPrefix: "discipline",
    actionName: "disc",
  });
}

/**
 * Handle normal milestone: Add Focus.
 */
export async function handleFocus(actor) {
  if (isSupportingActor(actor)) {
    const focusCount = (actor.items ?? []).filter(
      (i) => i?.type === "focus",
    ).length;
    if (focusCount >= 6) {
      ui.notifications?.warn?.(
        "Supporting Characters cannot have more than six focuses.",
      );
      return { applied: false };
    }
  }

  const chosen = await promptFocusChoiceFromCompendium();
  if (!chosen) return { applied: false };

  // Custom focus: preserve the previous behavior (blank focus item).
  if (chosen?.custom === true) {
    const created = await createItem(actor, {
      name: "New Focus",
      type: "focus",
    });
    if (created?.sheet?.render) {
      created.sheet.render(true);
    }
    return {
      applied: true,
      action: "focus",
      name: created?.name ?? "New Focus",
      createdItemId: created?.id ?? "",
      sourceUuid: "",
    };
  }

  const sourceFocusData = chosen.item
    ? foundry.utils.deepClone(chosen.item)
    : {};
  delete sourceFocusData._id;
  const focusData = {
    ...sourceFocusData,
    type: sourceFocusData.type ?? "focus",
    name: chosen.name ?? sourceFocusData.name ?? "New Focus",
    img: chosen.img ?? sourceFocusData.img ?? sourceFocusData.image ?? null,
  };
  const created = await createItem(actor, focusData);
  return {
    applied: true,
    action: "focus",
    name: created?.name ?? chosen.name,
    createdItemId: created?.id ?? "",
    sourceUuid: chosen.uuid ?? "",
  };
}

/**
 * Handle normal milestone: Add Talent.
 */
export async function handleTalent(actor) {
  if (isSupportingActor(actor)) {
    const talentCount = (actor.items ?? []).filter(
      (i) => i?.type === "talent" || i?.type === "shipTalent",
    ).length;
    if (talentCount >= 4) {
      ui.notifications?.warn?.(
        "Supporting Characters cannot have more than four talents.",
      );
      return { applied: false };
    }
  }

  const chosen = await promptTalentChoiceFromCompendium({ actor });
  if (!chosen) return { applied: false };

  if (chosen?.custom === true) {
    const created = await createItem(actor, {
      name: "New Talent",
      type: "talent",
    });
    try {
      created?.sheet?.render?.(true);
    } catch (_) {
      // ignore
    }
    return {
      applied: true,
      action: "talent",
      name: created?.name ?? "New Talent",
      createdItemId: created?.id ?? "",
      sourceUuid: "",
    };
  }

  const sourceTalentData = chosen.item
    ? foundry.utils.deepClone(chosen.item)
    : {};
  delete sourceTalentData._id;
  const talentData = {
    ...sourceTalentData,
    type: sourceTalentData.type ?? "talent",
    name: chosen.name ?? sourceTalentData.name ?? "New Talent",
    img: chosen.img ?? sourceTalentData.img ?? sourceTalentData.image ?? null,
  };
  const created = await createItem(actor, talentData);
  return {
    applied: true,
    action: "talent",
    name: created?.name ?? chosen.name,
    createdItemId: created?.id ?? "",
    sourceUuid: chosen.uuid ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ship Permission Fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle ship permission fallback when user cannot edit ship.
 * Shows manual instructions and returns outcome.
 */
export async function handleShipPermissionFallback({
  actor,
  ship,
  descriptionKey,
  instruction,
  label,
  flagPath,
  manualAction,
  extraPayload = {},
}) {
  // Queue the pending ship benefit for GM to apply later
  try {
    const pending = actor.getFlag?.(MODULE_ID, "pendingShipBenefits") ?? [];
    const id = (() => {
      try {
        if (typeof foundry?.utils?.randomID === "function")
          return foundry.utils.randomID();
      } catch (_) {
        // ignore
      }
      return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    })();
    const newBenefit = {
      id,
      timestamp: Date.now(),
      shipId: ship.id,
      shipName: ship.name,
      action: manualAction,
      label,
      instruction,
      flagPath,
      ...extraPayload,
    };

    await actor.setFlag(MODULE_ID, "pendingShipBenefits", [
      ...pending,
      newBenefit,
    ]);

    ui.notifications.info(
      `Ship benefit queued for GM to apply: ${label}. The GM will be notified when they log in.`,
    );

    return {
      status: "queued",
      result: {
        applied: false,
        action: manualAction,
        shipId: ship.id,
        queued: true,
        ...extraPayload,
      },
    };
  } catch (err) {
    console.error(`${MODULE_ID} | Failed to queue ship benefit:`, err);
  }

  // Fall back to manual instructions dialog if queuing fails
  const res = await _promptManualMilestoneInstructions({
    title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
    html: `
      <p><strong>${t(descriptionKey)}</strong></p>
      <p><strong>Group Ship:</strong> ${escapeHTML(ship.name ?? "")}</p>
      <p>You don't have permission to update the Group Ship.</p>
      <p>${escapeHTML(instruction)}</p>
      <p><strong>${escapeHTML(label)}</strong></p>
      <p><em>${escapeHTML(
        t("sta-officers-log.dialog.chooseMilestoneBenefit.manualConfirmHint"),
      )}</em></p>
    `,
  });
  if (res === "back") return { status: "back" };
  if (!res || res === "cancel") return { status: "cancel" };
  if (res === "confirm") {
    await _setStaSelectionFlag(actor, flagPath, true);
    return {
      status: "confirm",
      result: {
        applied: true,
        action: manualAction,
        shipId: ship.id,
        ...extraPayload,
      },
    };
  }
  return { status: "cancel" };
}
