import { MODULE_ID } from "../core/constants.js";
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_KEYS,
  DISCIPLINE_LABELS,
} from "../core/gameConstants.js";
import { escapeHTML } from "../core/utils.js";
import { t } from "../core/i18n.js";
import {
  _getFirstExistingNumeric,
  _promptSelect,
  _promptText,
  _promptTwoSelect,
} from "../milestones/dialogs.js";
import { promptFocusChoiceFromCompendium } from "../milestones/focusPickerDialog.js";
import {
  doesActorMeetTalentRequirements,
  promptTalentChoiceFromCompendium,
} from "../milestones/talentPickerDialog.js";
import { createStandaloneMilestoneItem } from "../milestones/newMilestoneArcDialog.js";
import {
  ADJUSTMENT_APPLIED,
  ADJUSTMENT_APPLYING,
  ADJUSTMENT_DECLINED,
  completeAdjustment,
  hasEligibleAdjustment,
  hasUpcomingAdjustment,
  releaseAdjustment,
  reserveAdjustment,
} from "./adjustments.js";
import { ensureInlineActionsContainer } from "../sheet/sheetUtils.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);
const openAdjustments = new Set();

function isSupportingActor(actor) {
  const sheetClass =
    actor?.getFlag?.("core", "sheetClass") ??
    foundry.utils.getProperty(actor, "flags.core.sheetClass") ??
    "";
  return (
    String(sheetClass) === "sta.STASupportingSheet2e" ||
    String(sheetClass) === "sta-utils.LcarsSupportingSheet2e"
  );
}

function canEditActor(actor) {
  try {
    if (game.user?.isGM) return true;
    if (typeof actor?.testUserPermission === "function") {
      return actor.testUserPermission(game.user, "OWNER");
    }
    return Boolean(actor?.isOwner);
  } catch (error) {
    console.error(`${MODULE_ID} | failed to check adjustment permissions`, error);
    return false;
  }
}

function getSupportingActors() {
  return Array.from(game.actors ?? [])
    .filter((actor) => isSupportingActor(actor) && canEditActor(actor))
    .sort((left, right) =>
      String(left.name ?? "").localeCompare(String(right.name ?? "")),
    );
}

function getStatInfo(actor, type) {
  const isAttribute = type === "attribute";
  const keys = isAttribute ? ATTRIBUTE_KEYS : DISCIPLINE_KEYS;
  const labels = isAttribute ? ATTRIBUTE_LABELS : DISCIPLINE_LABELS;
  return keys
    .map((key) => {
      const paths = isAttribute
        ? [`system.attribute.${key}.value`, `system.attributes.${key}.value`]
        : [`system.disciplines.${key}.value`];
      const { path, value } = _getFirstExistingNumeric(actor, paths);
      return path
        ? { key, label: labels[key] ?? key, path, value }
        : null;
    })
    .filter(Boolean);
}

function makeSelectOptions(stats, predicate, change) {
  return stats
    .filter(predicate)
    .map(
      ({ key, label, value }) =>
        `<option value="${escapeHTML(key)}">${escapeHTML(label)} (${value} → ${value + change})</option>`,
    )
    .join("");
}

async function chooseStatTrade(actor, type) {
  const isAttribute = type === "attribute";
  const minimum = isAttribute ? 7 : 1;
  const maximum = isAttribute ? 11 : 4;
  const stats = getStatInfo(actor, type);
  const lowerable = stats.filter(({ value }) => value > minimum);
  const increasable = stats.filter(({ value }) => value < maximum);
  const pairsExist = lowerable.some((from) =>
    increasable.some((to) => to.key !== from.key),
  );
  if (!pairsExist) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.noValidTrade") ??
        "There is no valid adjustment available for this category.",
    );
    return null;
  }

  const result = await _promptTwoSelect({
    title: t("sta-officers-log.adjustments.title"),
    label1: t("sta-officers-log.adjustments.reduce"),
    name1: "reduceKey",
    options1Html: makeSelectOptions(
      stats,
      ({ value }) => value > minimum,
      -1,
    ),
    label2: t("sta-officers-log.adjustments.increase"),
    name2: "increaseKey",
    options2Html: makeSelectOptions(
      stats,
      ({ value }) => value < maximum,
      1,
    ),
  });
  if (!result || result === "cancel") return null;

  const reduced = stats.find((stat) => stat.key === result.reduceKey);
  const increased = stats.find((stat) => stat.key === result.increaseKey);
  if (!reduced || !increased || reduced.key === increased.key) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.chooseDifferentStats") ??
        "Choose two different attributes or departments.",
    );
    return null;
  }
  if (reduced.value <= minimum || increased.value >= maximum) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.tradeNoLongerValid") ??
        "Those values no longer allow this adjustment.",
    );
    return null;
  }

  const category = isAttribute
    ? t("sta-officers-log.adjustments.attribute")
    : t("sta-officers-log.adjustments.department");
  const description = `${category}: ${reduced.label} ${reduced.value} → ${reduced.value - 1}; ${increased.label} ${increased.value} → ${increased.value + 1}`;
  let statsUpdated = false;
  return {
    actor,
    name: `${t("sta-officers-log.adjustments.itemPrefix")}: ${reduced.label} −1, ${increased.label} +1`,
    description,
    mutation: {
      apply: async () => {
        const currentReduced = Number(
          foundry.utils.getProperty(actor, reduced.path),
        );
        const currentIncreased = Number(
          foundry.utils.getProperty(actor, increased.path),
        );
        if (
          currentReduced !== reduced.value ||
          currentIncreased !== increased.value
        ) {
          throw new Error(
            t("sta-officers-log.adjustments.tradeNoLongerValid") ??
              "Those values no longer allow this adjustment.",
          );
        }
        await actor.update({
          [reduced.path]: reduced.value - 1,
          [increased.path]: increased.value + 1,
        });
        statsUpdated = true;
      },
      rollback: async () => {
        if (!statsUpdated) return;
        await actor.update({
          [reduced.path]: reduced.value,
          [increased.path]: increased.value,
        });
        statsUpdated = false;
      },
    },
  };
}

function getOwnedItems(actor, type) {
  return Array.from(actor.items ?? [])
    .filter((item) => item.type === type)
    .sort((left, right) =>
      String(left.name ?? "").localeCompare(String(right.name ?? "")),
    );
}

async function chooseItemToReplace(actor, type) {
  const existingItems = getOwnedItems(actor, type);
  if (!existingItems.length) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.noItemsToReplace") ??
        "There is nothing of this type to replace.",
    );
    return null;
  }
  const optionsHtml = existingItems
    .map(
      (item, index) =>
        `<option value="${escapeHTML(item.id)}"${index === 0 ? " selected" : ""}>${escapeHTML(item.name)}</option>`,
    )
    .join("");
  const selectedId = await _promptSelect({
    title: t("sta-officers-log.adjustments.title"),
    label: t("sta-officers-log.adjustments.replace"),
    name: "replaceItemId",
    optionsHtml,
  });
  if (!selectedId || selectedId === "cancel") return null;
  const selectedItem = actor.items.get(String(selectedId));
  return selectedItem?.type === type ? selectedItem : null;
}

function makeItemReplacementMutation(actor, oldItem, replacementData) {
  const oldData = foundry.utils.deepClone(oldItem.toObject());
  delete oldData._id;
  let createdItem = null;
  return {
    apply: async () => {
      if (actor.items.get(oldItem.id) !== oldItem) {
        throw new Error("The item selected for replacement no longer exists.");
      }
      [createdItem] = await actor.createEmbeddedDocuments("Item", [
        replacementData,
      ]);
      if (!createdItem) {
        throw new Error("The replacement item could not be created.");
      }
      await oldItem.delete();
      if (actor.items.get(oldItem.id)) {
        throw new Error("The item selected for replacement was not removed.");
      }
    },
    rollback: async () => {
      if (!actor.items.get(oldItem.id)) {
        await actor.createEmbeddedDocuments("Item", [oldData]);
      }
      if (createdItem) {
        const itemToDelete = actor.items.get(createdItem.id);
        if (itemToDelete) await itemToDelete.delete();
        createdItem = null;
      }
    },
  };
}

async function chooseFocusReplacement(actor) {
  const oldItem = await chooseItemToReplace(actor, "focus");
  if (!oldItem) return null;

  const chosen = await promptFocusChoiceFromCompendium();
  if (!chosen) return null;
  let name;
  if (chosen.custom) {
    const customName = await _promptText({
      title: t("sta-officers-log.adjustments.title"),
      label: t("sta-officers-log.adjustments.focusNameLabel"),
      name: "adjustmentFocusName",
    });
    if (!customName || customName === "cancel") return null;
    name = String(customName).trim();
  } else {
    name = String(chosen.name ?? "").trim();
  }
  const otherFocusNames = getOwnedItems(actor, "focus")
    .filter((item) => item.id !== oldItem.id)
    .map((item) => String(item.name ?? "").trim().toLowerCase());
  if (
    !name ||
    name.toLowerCase() === String(oldItem.name ?? "").trim().toLowerCase() ||
    otherFocusNames.includes(name.toLowerCase())
  ) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.focusMustBeDifferent") ??
        "Choose a different focus that this character does not already have.",
    );
    return null;
  }

  let focusData;
  if (chosen.custom) {
    focusData = { name, type: "focus" };
  } else {
    const sourceData = foundry.utils.deepClone(chosen.item ?? {});
    focusData = {
      ...sourceData,
      name,
      type: "focus",
      img: chosen.img ?? sourceData.img ?? sourceData.image ?? null,
    };
  }
  delete focusData._id;
  const description = `${t("sta-officers-log.adjustments.focus")}: ${oldItem.name} → ${name}`;
  return {
    actor,
    name: `${t("sta-officers-log.adjustments.itemPrefix")}: ${oldItem.name} → ${name}`,
    description,
    mutation: makeItemReplacementMutation(actor, oldItem, focusData),
  };
}

async function chooseTalentReplacement(actor) {
  const existingTalents = getOwnedItems(actor, "talent");
  if (!existingTalents.length) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.noItemsToReplace") ??
        "There is nothing of this type to replace.",
    );
    return null;
  }

  const chosen = await promptTalentChoiceFromCompendium({
    actor,
    allowCustom: false,
    selectionField: {
      label:
        t("sta-officers-log.adjustments.replaceTalent") ??
        "Choose the talent to replace",
      options: existingTalents.map((item) => ({
        value: item.id,
        label: item.name,
      })),
    },
  });
  if (!chosen || chosen.custom) return null;
  const oldItem = actor.items.get(String(chosen.replacementId ?? ""));
  if (!oldItem || oldItem.type !== "talent") {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.noItemsToReplace") ??
        "There is nothing of this type to replace.",
    );
    return null;
  }
  const name = String(chosen.name ?? "").trim();
  const existingNames = getOwnedItems(actor, "talent")
    .filter((item) => item.id !== oldItem.id)
    .map((item) => String(item.name ?? "").trim().toLowerCase());
  if (
    !name ||
    name.toLowerCase() === String(oldItem.name ?? "").trim().toLowerCase() ||
    existingNames.includes(name.toLowerCase())
  ) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.talentMustBeDifferent") ??
        "Choose a different talent that this character does not already have.",
    );
    return null;
  }

  const talentData = foundry.utils.deepClone(chosen.item ?? {});
  delete talentData._id;
  talentData.name = name;
  talentData.type = talentData.type ?? "talent";
  talentData.img = chosen.img ?? talentData.img ?? talentData.image ?? null;
  const talentEntry = {
    ...talentData,
    talenttype:
      chosen.talenttype ??
      talentData.talenttype ??
      talentData.system?.talenttype ??
      null,
  };
  if (!doesActorMeetTalentRequirements(actor, talentEntry)) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.talentPrerequisitesNotMet") ??
        "The character does not meet this talent's prerequisites.",
    );
    return null;
  }

  const description = `${t("sta-officers-log.adjustments.talent")}: ${oldItem.name} → ${name}`;
  return {
    actor,
    name: `${t("sta-officers-log.adjustments.itemPrefix")}: ${oldItem.name} → ${name}`,
    description,
    mutation: makeItemReplacementMutation(actor, oldItem, talentData),
  };
}

async function chooseSupportingActor() {
  const actors = getSupportingActors();
  if (!actors.length) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.noSupportingCharacters") ??
        "No editable supporting characters are available.",
    );
    return null;
  }
  const optionsHtml = actors
    .map(
      (actor, index) =>
        `<option value="${escapeHTML(actor.id)}"${index === 0 ? " selected" : ""}>${escapeHTML(actor.name ?? actor.id)}</option>`,
    )
    .join("");
  const actorId = await _promptSelect({
    title: t("sta-officers-log.adjustments.title"),
    label: t("sta-officers-log.adjustments.chooseSupportingCharacter"),
    name: "supportingActorId",
    optionsHtml,
  });
  return actorId ? (game.actors?.get?.(String(actorId)) ?? null) : null;
}

async function chooseSupportingAdjustmentActor() {
  const actor = await chooseSupportingActor();
  if (!actor) return null;
  if (!isSupportingActor(actor) || !canEditActor(actor)) {
    ui.notifications?.error(
      t("sta-officers-log.adjustments.supportingActorUnavailable") ??
        "That supporting character is no longer available for editing.",
    );
    return null;
  }
  return actor;
}

async function buildAdjustment(action, actor) {
  switch (action) {
    case "attributes":
      return chooseStatTrade(actor, "attribute");
    case "departments":
      return chooseStatTrade(actor, "department");
    case "focuses":
      return chooseFocusReplacement(actor);
    case "talents":
      return chooseTalentReplacement(actor);
    default:
      return null;
  }
}

async function applyAdjustment(logItem, plan) {
  if (!plan?.actor || !plan?.mutation) return false;
  if (!canEditActor(plan.actor)) {
    throw new Error(
      t("sta-officers-log.adjustments.actorPermissionLost") ??
        "You no longer have permission to change this character.",
    );
  }

  await reserveAdjustment(logItem);
  let milestone = null;
  let mutationStarted = false;
  try {
    milestone = await createStandaloneMilestoneItem(plan.actor, {
      name: plan.name,
      applied: { action: "customMilestone" },
      isArc: false,
    });
    if (!milestone) {
      throw new Error("The adjustment milestone could not be created.");
    }
    await milestone.update({
      "system.description": `<p>${escapeHTML(plan.description)}</p>`,
    });

    mutationStarted = true;
    await plan.mutation.apply();
    if (
      logItem.system?.adjustmentStatus !== ADJUSTMENT_APPLYING
    ) {
      throw new Error(
        t("sta-officers-log.adjustments.offerUnavailable") ??
          "This adjustment offer is no longer available.",
      );
    }
    await logItem.update({
      "system.showAdjustmentButton": false,
      "system.adjustmentStatus": ADJUSTMENT_APPLIED,
    });
    return true;
  } catch (error) {
    const rollbackErrors = [];
    if (mutationStarted) {
      try {
        await plan.mutation.rollback();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (milestone) {
      try {
        await milestone.delete();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await releaseAdjustment(logItem);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    for (const rollbackError of rollbackErrors) {
      console.error(
        `${MODULE_ID} | failed to roll back adjustment`,
        rollbackError,
      );
    }
    if (rollbackErrors.length) {
      ui.notifications?.error(
        t("sta-officers-log.adjustments.rollbackFailed") ??
          "Adjustment rollback was incomplete. Check the console and character items for partial changes.",
      );
    }
    throw error;
  }
}

class AdjustmentPickerApp extends Base {
  constructor({ actor, logItem, sheetApp } = {}, options = {}) {
    super(options);
    this._actor = actor;
    this._targetActor = actor;
    this._isSupportingCharacterAdjustment = false;
    this._logItem = logItem;
    this._sheetApp = sheetApp;
    this._onClose = null;
    this._resolvedClose = false;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-adjustment-picker`,
    window: {},
    classes: ["sta-officers-log", "choose-benefit"],
    position: { width: 520, height: "auto" },
    resizable: false,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/adjustments/adjustment-picker.hbs`,
    },
  };

  get title() {
    return t("sta-officers-log.adjustments.title") ?? "Adjustment";
  }

  async _prepareContext(_options) {
    return {
      supportingHeading: t("sta-officers-log.adjustments.supportingHeading"),
      prompt: t(
        this._isSupportingCharacterAdjustment
          ? "sta-officers-log.adjustments.supportingPrompt"
          : "sta-officers-log.adjustments.prompt",
      ),
      supportingCharacter: this._isSupportingCharacterAdjustment
        ? {
            name: this._targetActor?.name ?? "",
            img:
              this._targetActor?.img ??
              this._targetActor?.prototypeToken?.texture?.src ??
              "icons/svg/mystery-man.svg",
          }
        : null,
      options: [
        {
          action: "attributes",
          label: t("sta-officers-log.adjustments.attributes"),
        },
        {
          action: "departments",
          label: t("sta-officers-log.adjustments.departments"),
        },
        {
          action: "focuses",
          label: t("sta-officers-log.adjustments.focuses"),
        },
        {
          action: "talents",
          label: t("sta-officers-log.adjustments.talents"),
        },
        ...(!this._isSupportingCharacterAdjustment
          ? [
              {
                action: "supporting",
                label: t("sta-officers-log.adjustments.supportingCharacter"),
              },
            ]
          : []),
        {
          action: "none",
          label: t("sta-officers-log.adjustments.noAdjustment"),
        },
      ],
    };
  }

  _resolveClose() {
    if (this._resolvedClose) return;
    this._resolvedClose = true;
    this._onClose?.();
  }

  async close(options = {}) {
    this._resolveClose();
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners?.(partId, htmlElement, options);
    if (partId !== "main" || !htmlElement) return;
    if (htmlElement.dataset.staAdjustmentPickerBound === "1") return;
    htmlElement.dataset.staAdjustmentPickerBound = "1";

    htmlElement.addEventListener("click", async (event) => {
      const button = event.target?.closest?.("button[data-action]");
      if (!(button instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();

      const action = String(button.dataset.action ?? "");
      if (button.dataset.busy === "1") return;
      button.dataset.busy = "1";
      button.disabled = true;
      try {
        if (action === "none") {
          await completeAdjustment(this._logItem, ADJUSTMENT_DECLINED);
          await this.close();
          this._sheetApp?.render?.(true);
          return;
        }

        if (
          action === "supporting" &&
          !this._isSupportingCharacterAdjustment
        ) {
          const supportingActor = await chooseSupportingAdjustmentActor();
          if (!supportingActor) {
            button.dataset.busy = "0";
            button.disabled = false;
            return;
          }
          this._targetActor = supportingActor;
          this._isSupportingCharacterAdjustment = true;
          await this.render(true);
          return;
        }

        const plan = await buildAdjustment(action, this._targetActor);
        if (!plan) {
          button.dataset.busy = "0";
          button.disabled = false;
          return;
        }
        if (await applyAdjustment(this._logItem, plan)) {
          await this.close();
          this._sheetApp?.render?.(true);
        } else {
          button.dataset.busy = "0";
          button.disabled = false;
        }
      } catch (error) {
        console.error(`${MODULE_ID} | failed to apply adjustment`, error);
        ui.notifications?.error(
          t("sta-officers-log.adjustments.applyFailed") ??
            "The adjustment could not be applied. The offer remains available if it could be restored.",
        );
        button.dataset.busy = "0";
        button.disabled = false;
      }
    });
  }
}

export async function openAdjustmentPicker(actor, logItem, sheetApp) {
  if (!hasEligibleAdjustment(logItem)) {
    ui.notifications?.warn(
      t("sta-officers-log.adjustments.offerUnavailable") ??
        "This adjustment offer is no longer available.",
    );
    return;
  }

  const key = `${actor?.id ?? ""}:${logItem?.id ?? ""}`;
  if (openAdjustments.size > 0) return;
  openAdjustments.add(key);
  try {
    const app = new AdjustmentPickerApp({ actor, logItem, sheetApp });
    await new Promise((resolve) => {
      app._onClose = resolve;
      app.render(true);
    });
  } catch (error) {
    console.error(`${MODULE_ID} | failed to open Adjustment picker`, error);
    ui.notifications?.error(
      t("sta-officers-log.adjustments.openFailed") ??
        "The Adjustment picker could not be opened.",
    );
  } finally {
    openAdjustments.delete(key);
  }
}

export function installAdjustmentButtons(root, actor, app) {
  const entries = root.querySelectorAll(
    'div.section.milestones li.row.entry[data-item-type="log"], div.section.character-log li.row.entry[data-item-type="log"]',
  );
  for (const entry of entries) {
    if (entry.querySelector(".sta-adjustment-btn")) continue;
    const logId = String(entry.dataset.itemId ?? "");
    const logItem = logId ? actor.items.get(logId) : null;
    const isCurrent = entry.classList.contains("sta-current-mission-log");
    if (isCurrent ? !hasUpcomingAdjustment(logItem) : !hasEligibleAdjustment(logItem)) continue;

    const toggle = entry.querySelector("a.value-used.control.toggle");
    if (!toggle) continue;
    const inlineActions = ensureInlineActionsContainer(entry, toggle);
    if (!inlineActions) continue;

    const button = document.createElement("span");
    button.className = "sta-adjustment-btn sta-inline-sheet-btn";
    button.textContent = t("sta-officers-log.adjustments.button");
    button.title = t("sta-officers-log.adjustments.buttonTooltip");
    button.setAttribute(
      "aria-label",
      t("sta-officers-log.adjustments.button"),
    );
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    if (isCurrent) {
      button.classList.add("sta-choose-btn-disabled");
      button.setAttribute("aria-disabled", "true");
      button.tabIndex = -1;
      button.title = t("sta-officers-log.adjustments.disabledTooltip");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        ui.notifications.warn(
          t("sta-officers-log.adjustments.disabledNotification"),
        );
      });
      inlineActions.appendChild(button);
      continue;
    }
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await openAdjustmentPicker(actor, logItem, app);
    });
    button.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      await openAdjustmentPicker(actor, logItem, app);
    });
    inlineActions.appendChild(button);
  }
}
