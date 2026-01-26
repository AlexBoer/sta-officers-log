import { t } from "../core/i18n.js";
import { escapeHTML } from "../data/values.js";

// Re-export game constants from core for backward compatibility
export {
  ATTRIBUTE_KEYS,
  DISCIPLINE_KEYS,
  ATTRIBUTE_LABELS,
  DISCIPLINE_LABELS,
  SHIP_SYSTEM_KEYS,
  SHIP_DEPARTMENT_KEYS,
  SHIP_SYSTEM_LABELS,
  SHIP_DEPARTMENT_LABELS,
} from "../core/gameConstants.js";

export function _getStaSelectionFlag(actor, selectionPath) {
  // These correspond to checkboxes like:
  // flags.sta.selections.attributes.control
  // flags.sta.selections.discipline.conn
  const key = `selections.${selectionPath}`;
  const v1 = actor?.getFlag?.("sta", key);
  if (v1 === true) return true;
  if (v1 === false) return false;
  return (
    foundry.utils.getProperty(actor, `flags.sta.${key}`) === true ||
    foundry.utils.getProperty(
      actor,
      `flags.sta.selections.${selectionPath}`,
    ) === true
  );
}

export async function _setStaSelectionFlag(actor, selectionPath, value) {
  const key = `selections.${selectionPath}`;
  return actor?.setFlag?.("sta", key, Boolean(value));
}

export function _getFirstExistingNumeric(actor, paths) {
  for (const path of paths) {
    const v = foundry.utils.getProperty(actor, path);
    if (v === 0 || v) {
      const n = Number(v);
      if (!Number.isNaN(n)) return { path, value: n };
    }
  }
  return { path: null, value: null };
}

export async function _promptSelect({ title, label, name, optionsHtml }) {
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `
      <div class="form-group">
        <label>${escapeHTML(label)}</label>
        <div class="form-fields">
          <select name="${escapeHTML(name)}">
            ${optionsHtml}
          </select>
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
        default: true,
        callback: (_event, button) => button.form?.elements?.[name]?.value,
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}

export async function _promptText({ title, label, name, placeholder = "" }) {
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `
      <div class="form-group">
        <label>${escapeHTML(label)}</label>
        <div class="form-fields">
          <input type="text" name="${escapeHTML(
            name,
          )}" placeholder="${escapeHTML(placeholder)}" />
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
        default: true,
        callback: (_event, button) => button.form?.elements?.[name]?.value,
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}

export async function _promptTwoSelect({
  title,
  label1,
  name1,
  options1Html,
  label2,
  name2,
  options2Html,
}) {
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `
      <div class="form-group">
        <label>${escapeHTML(label1)}</label>
        <div class="form-fields">
          <select name="${escapeHTML(name1)}">
            ${options1Html}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>${escapeHTML(label2)}</label>
        <div class="form-fields">
          <select name="${escapeHTML(name2)}">
            ${options2Html}
          </select>
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
        default: true,
        callback: (_event, button) => ({
          [name1]: button.form?.elements?.[name1]?.value,
          [name2]: button.form?.elements?.[name2]?.value,
        }),
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}

export async function _promptSelectAndText({
  title,
  selectLabel,
  selectName,
  selectOptionsHtml,
  textLabel,
  textName,
  textPlaceholder = "",
}) {
  return foundry.applications.api.DialogV2.wait({
    window: { title },
    content: `
      <div class="form-group">
        <label>${escapeHTML(selectLabel)}</label>
        <div class="form-fields">
          <select name="${escapeHTML(selectName)}">
            ${selectOptionsHtml}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>${escapeHTML(textLabel)}</label>
        <div class="form-fields">
          <input type="text" name="${escapeHTML(
            textName,
          )}" placeholder="${escapeHTML(textPlaceholder)}" />
        </div>
      </div>
    `,
    buttons: [
      {
        action: "ok",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.ok"),
        default: true,
        callback: (_event, button) => ({
          [selectName]: button.form?.elements?.[selectName]?.value,
          [textName]: button.form?.elements?.[textName]?.value,
        }),
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}

export async function _promptBenefitType() {
  return foundry.applications.api.DialogV2.wait({
    window: {
      title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
      classes: ["choose-benefit"],
    },
    content: `
      <div data-sta-callbacks-dialog="choose-benefit"></div>
      <p>${t("sta-officers-log.dialog.chooseMilestoneBenefit.chooseType")}</p>
    `,
    buttons: [
      {
        action: "attr",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.increaseAttribute",
        ),
        default: true,
      },
      {
        action: "disc",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.increaseDiscipline",
        ),
      },
      {
        action: "focus",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.addFocus"),
      },
      {
        action: "talent",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.addTalent"),
      },
      {
        action: "supporting",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.giveToSupportingCharacter",
        ),
      },
      {
        action: "ship",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.changeShipStats",
        ),
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}

export async function _promptManualMilestoneInstructions({ title, html }) {
  return foundry.applications.api.DialogV2.wait({
    window: { title, classes: ["choose-benefit"] },
    content: `<div data-sta-callbacks-dialog="choose-benefit"></div>${html}`,
    buttons: [
      {
        action: "confirm",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.confirm"),
        default: true,
      },
      {
        action: "back",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.back"),
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}

export async function _promptArcBenefitType() {
  return foundry.applications.api.DialogV2.wait({
    window: {
      title: t("sta-officers-log.dialog.chooseMilestoneBenefit.title"),
      classes: ["choose-benefit"],
    },
    content: `
      <div data-sta-callbacks-dialog="choose-benefit"></div>
      <p>${t(
        "sta-officers-log.dialog.chooseMilestoneBenefit.arcChooseType",
      )}</p>
    `,
    buttons: [
      {
        action: "attr",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseAttribute",
        ),
        default: true,
      },
      {
        action: "disc",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseDiscipline",
        ),
      },
      {
        action: "value",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.arcAddValue"),
      },
      {
        action: "shipSystem",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseShipSystem",
        ),
      },
      {
        action: "shipDepartment",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseShipDepartment",
        ),
      },
      {
        action: "shipTalent",
        label: t(
          "sta-officers-log.dialog.chooseMilestoneBenefit.arcAddShipTalent",
        ),
      },
      {
        action: "cancel",
        label: t("sta-officers-log.dialog.chooseMilestoneBenefit.cancel"),
      },
    ],
    rejectClose: false,
    modal: false,
  });
}
