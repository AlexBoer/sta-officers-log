import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING,
  TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING,
  TALENT_PICKER_INCLUDE_BUILTIN_SETTING,
  parseCompendiumPackKeys,
} from "./pickerSettings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CompendiumPickerSettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-compendium-picker-settings`,
    tag: "form",
    window: {
      title: "sta-officers-log.settings.compendiumPicker.menuTitle",
      contentClasses: ["standard-form"],
    },
    position: { width: 540, height: "auto" },
    form: {
      closeOnSubmit: true,
      handler: CompendiumPickerSettingsApp.#onSubmit,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/compendium-picker-settings.hbs`,
    },
  };

  async _prepareContext(_options) {
    const availablePacks = Array.from(game.packs.values())
      .filter((p) => p.metadata.type === "Item")
      .map((p) => ({
        packId: p.metadata.id,
        label: `${p.metadata.label} (${p.metadata.id})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const _packLabel = (key) => {
      const pack = game.packs.get(key);
      return pack ? `${pack.metadata.label} (${key})` : key;
    };

    const focusKeys = parseCompendiumPackKeys(
      game.settings.get(MODULE_ID, FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        "",
    );
    const talentKeys = parseCompendiumPackKeys(
      game.settings.get(MODULE_ID, TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING) ??
        "",
    );
    const talentIncludeBuiltin = Boolean(
      game.settings.get(MODULE_ID, TALENT_PICKER_INCLUDE_BUILTIN_SETTING),
    );

    return {
      availablePacks,
      focusPacks: focusKeys.map((k) => ({ key: k, label: _packLabel(k) })),
      talentPacks: talentKeys.map((k) => ({ key: k, label: _packLabel(k) })),
      focusKeysValue: focusKeys.join(","),
      talentKeysValue: talentKeys.join(","),
      talentIncludeBuiltin,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    // Wire up all "Add" buttons
    for (const btn of html.querySelectorAll(".pack-add-btn")) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const target = btn.dataset.target;
        const select = html.querySelector(
          `.pack-select[data-target="${target}"]`,
        );
        if (!select?.value) return;
        this._addPackBadge(target, select.value);
        select.value = "";
      });
    }

    // Wire up existing remove buttons (rendered from template on initial render)
    for (const btn of html.querySelectorAll(".pack-badge-remove")) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this._removePackBadge(btn.dataset.target, btn.dataset.key);
      });
    }
  }

  /**
   * Adds a compendium badge to the given target group.
   * Also updates the corresponding hidden input.
   *
   * @param {"focusKeys"|"talentKeys"} target
   * @param {string} key - compendium pack id
   */
  _addPackBadge(target, key) {
    const hidden = this.element.querySelector(`input[name="${target}"]`);
    const badgesEl = this.element.querySelector(
      `.pack-badges[data-target="${target}"]`,
    );
    if (!hidden || !badgesEl) return;

    const keys = parseCompendiumPackKeys(hidden.value);
    if (keys.includes(key)) return; // already present
    keys.push(key);
    hidden.value = keys.join(",");

    // Remove empty-state placeholder if present
    badgesEl.querySelector(".pack-badges-empty")?.remove();

    const pack = game.packs.get(key);
    const label = pack ? `${pack.metadata.label} (${key})` : key;

    const badge = document.createElement("span");
    badge.className = "pack-badge";
    badge.dataset.key = key;

    const labelSpan = document.createElement("span");
    labelSpan.className = "pack-badge-label";
    labelSpan.textContent = label;
    badge.appendChild(labelSpan);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "pack-badge-remove";
    removeBtn.dataset.key = key;
    removeBtn.dataset.target = target;
    removeBtn.title =
      t("sta-officers-log.settings.compendiumPicker.removePack") || "Remove";
    removeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
    removeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this._removePackBadge(target, key);
    });
    badge.appendChild(removeBtn);

    badgesEl.appendChild(badge);
  }

  /**
   * Removes a compendium badge from the given target group.
   * Also updates the corresponding hidden input and restores empty-state if needed.
   *
   * @param {"focusKeys"|"talentKeys"} target
   * @param {string} key - compendium pack id
   */
  _removePackBadge(target, key) {
    const hidden = this.element.querySelector(`input[name="${target}"]`);
    const badgesEl = this.element.querySelector(
      `.pack-badges[data-target="${target}"]`,
    );
    if (!hidden || !badgesEl) return;

    const keys = parseCompendiumPackKeys(hidden.value).filter((k) => k !== key);
    hidden.value = keys.join(",");

    const badge = badgesEl.querySelector(
      `.pack-badge[data-key="${CSS.escape(key)}"]`,
    );
    badge?.remove();

    // Restore empty-state if no badges remain
    if (!badgesEl.querySelector(".pack-badge")) {
      const emptySpan = document.createElement("span");
      emptySpan.className = "pack-badges-empty";
      emptySpan.textContent =
        t("sta-officers-log.settings.compendiumPicker.noneSelected") ||
        "No compendiums added.";
      badgesEl.appendChild(emptySpan);
    }
  }

  static async #onSubmit(_event, _form, formData) {
    const obj = formData.object ?? {};

    await game.settings.set(
      MODULE_ID,
      FOCUS_PICKER_CUSTOM_COMPENDIUM_SETTING,
      obj.focusKeys ?? "",
    );
    await game.settings.set(
      MODULE_ID,
      TALENT_PICKER_CUSTOM_COMPENDIUM_SETTING,
      obj.talentKeys ?? "",
    );
    await game.settings.set(
      MODULE_ID,
      TALENT_PICKER_INCLUDE_BUILTIN_SETTING,
      Boolean(obj.talentIncludeBuiltin),
    );

    ui.notifications?.info?.(
      t("sta-officers-log.settings.compendiumPicker.saved") ||
        "Compendium picker settings saved.",
    );
  }
}
