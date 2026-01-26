/**
 * Ship Swap Handlers
 *
 * Handles ship system, department, and talent swap flows for normal milestones.
 */

import { t } from "../core/i18n.js";
import { escapeHTML } from "../data/values.js";
import {
  SHIP_SYSTEM_KEYS,
  SHIP_DEPARTMENT_KEYS,
  SHIP_SYSTEM_LABELS,
  SHIP_DEPARTMENT_LABELS,
  _promptTwoSelect,
} from "./dialogs.js";

import { localizeStaLabel } from "./benefitHandlers.js";
import { promptShipTalentSwapDialog } from "./shipTalentSwapDialog.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ship System Swap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle ship system swap (-1/+1) for normal milestone.
 * @param {Actor} ship - The ship actor
 * @returns {Promise<{applied: boolean, action?: string, shipId?: string, dec?: string, inc?: string}>}
 */
export async function handleShipSystemSwap(ship) {
  const sysObj = ship.system?.systems ?? {};
  const keys = Object.keys(sysObj);
  const systemKeys = keys.length ? keys : SHIP_SYSTEM_KEYS;

  const option = (k, selected) => {
    const label =
      localizeStaLabel(sysObj?.[k]?.label) || SHIP_SYSTEM_LABELS[k] || k;
    const sel = selected ? " selected" : "";
    return `<option value="${escapeHTML(k)}"${sel}>${escapeHTML(
      label,
    )}</option>`;
  };

  while (true) {
    const options1Html =
      '<option value="" selected></option>' +
      systemKeys.map((k) => option(k, false)).join("");
    const options2Html = options1Html;

    const res = await _promptTwoSelect({
      title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
      label1: "Decrease system (-1)",
      name1: "dec",
      options1Html,
      label2: "Increase system (+1)",
      name2: "inc",
      options2Html,
    });
    if (!res || res === "cancel") return { applied: false };

    const dec = String(res.dec ?? "");
    const inc = String(res.inc ?? "");
    if (!dec || !inc) continue;
    if (dec === inc) {
      ui.notifications?.warn?.("Pick two different systems.");
      continue;
    }

    const decPath = `system.systems.${dec}.value`;
    const incPath = `system.systems.${inc}.value`;
    const decCur = Number(foundry.utils.getProperty(ship, decPath) ?? 0);
    const incCur = Number(foundry.utils.getProperty(ship, incPath) ?? 0);

    const updates = {
      [decPath]: Math.max(0, (Number.isFinite(decCur) ? decCur : 0) - 1),
      [incPath]: Math.min(5, (Number.isFinite(incCur) ? incCur : 0) + 1),
    };

    try {
      await ship.update(updates);
    } catch (err) {
      console.error("sta-officers-log | ship system swap failed", err);
      ui.notifications?.error?.("Failed to update the Group Ship.");
      return { applied: false };
    }

    return {
      applied: true,
      action: "shipSystemSwap",
      shipId: ship.id,
      dec,
      inc,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ship Department Swap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle ship department swap (-1/+1) for normal milestone.
 * @param {Actor} ship - The ship actor
 * @returns {Promise<{applied: boolean, action?: string, shipId?: string, dec?: string, inc?: string}>}
 */
export async function handleShipDepartmentSwap(ship) {
  const depObj = ship.system?.departments ?? {};
  const keys = Object.keys(depObj);
  const deptKeys = keys.length ? keys : SHIP_DEPARTMENT_KEYS;

  const option = (k, selected) => {
    const label =
      localizeStaLabel(depObj?.[k]?.label) || SHIP_DEPARTMENT_LABELS[k] || k;
    const sel = selected ? " selected" : "";
    return `<option value="${escapeHTML(k)}"${sel}>${escapeHTML(
      label,
    )}</option>`;
  };

  while (true) {
    const options1Html =
      '<option value="" selected></option>' +
      deptKeys.map((k) => option(k, false)).join("");
    const options2Html = options1Html;

    const res = await _promptTwoSelect({
      title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
      label1: "Decrease department (-1)",
      name1: "dec",
      options1Html,
      label2: "Increase department (+1)",
      name2: "inc",
      options2Html,
    });
    if (!res || res === "cancel") return { applied: false };

    const dec = String(res.dec ?? "");
    const inc = String(res.inc ?? "");
    if (!dec || !inc) continue;
    if (dec === inc) {
      ui.notifications?.warn?.("Pick two different departments.");
      continue;
    }

    const decPath = `system.departments.${dec}.value`;
    const incPath = `system.departments.${inc}.value`;
    const decCur = Number(foundry.utils.getProperty(ship, decPath) ?? 0);
    const incCur = Number(foundry.utils.getProperty(ship, incPath) ?? 0);

    const updates = {
      [decPath]: Math.max(0, (Number.isFinite(decCur) ? decCur : 0) - 1),
      [incPath]: (Number.isFinite(incCur) ? incCur : 0) + 1,
    };

    try {
      await ship.update(updates);
    } catch (err) {
      console.error("sta-officers-log | ship department swap failed", err);
      ui.notifications?.error?.("Failed to update the Group Ship.");
      return { applied: false };
    }

    return {
      applied: true,
      action: "shipDepartmentSwap",
      shipId: ship.id,
      dec,
      inc,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ship Talent Swap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle ship talent swap (remove one, add one) for normal milestone.
 * @param {Actor} ship - The ship actor
 * @returns {Promise<{applied: boolean, back?: boolean, action?: string, shipId?: string, removed?: string, added?: string}>}
 */
export async function handleShipTalentSwap(ship) {
  const talents = (ship.items ?? []).filter(
    (i) => i?.type === "talent" || i?.type === "shipTalent",
  );

  if (!talents.length) {
    const again = await foundry.applications.api.DialogV2.wait({
      window: {
        title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
        classes: ["choose-benefit"],
      },
      content: `
        <div data-sta-callbacks-dialog="choose-benefit"></div>
        <p>Group Ship has no talents to replace.</p>
        <p>Choose a different refit option.</p>
      `,
      buttons: [
        {
          action: "back",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.back"),
          default: true,
        },
        {
          action: "cancel",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
        },
      ],
      rejectClose: false,
      modal: false,
    });

    if (!again || again === "cancel") return { applied: false };
    return { applied: false, back: true };
  }

  const swapResult = await promptShipTalentSwapDialog({ ship });
  if (swapResult === "back") {
    return { applied: false, back: true };
  }
  if (!swapResult) return { applied: false };

  const toRemove = ship.items?.get?.(swapResult.removeId);
  if (!toRemove) {
    ui.notifications?.warn?.("That talent no longer exists.");
    return { applied: false, back: true };
  }

  try {
    await ship.deleteEmbeddedDocuments("Item", [swapResult.removeId]);
    const type = toRemove.type ?? "talent";
    const sourceShipTalent = swapResult.newTalent?.item
      ? foundry.utils.deepClone(swapResult.newTalent.item)
      : {};
    delete sourceShipTalent._id;
    const shipTalentData = {
      ...sourceShipTalent,
      type,
      name: swapResult.newTalent?.name ?? sourceShipTalent.name ?? "New Talent",
      img:
        swapResult.newTalent?.img ??
        sourceShipTalent.img ??
        sourceShipTalent.image ??
        null,
    };
    const [created] = await ship.createEmbeddedDocuments("Item", [
      shipTalentData,
    ]);
    return {
      applied: true,
      action: "shipTalentSwap",
      shipId: ship.id,
      removed: toRemove.name ?? "",
      added: created?.name ?? shipTalentData.name ?? "",
    };
  } catch (err) {
    console.error("sta-officers-log | ship talent swap failed", err);
    ui.notifications?.error?.("Failed to update the Group Ship.");
    return { applied: false };
  }
}
