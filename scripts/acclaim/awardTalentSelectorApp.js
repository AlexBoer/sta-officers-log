/**
 * Award Talent Selector
 *
 * GM-only settings dialog for choosing which Award-type talents (found in
 * the configured talent compendiums) are offered as Award options in the
 * Spend Acclaim dialog.
 *
 * @module acclaim/awardTalentSelectorApp
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import {
  getEnabledAwardTalentUuids,
  loadAwardTalentEntries,
  setEnabledAwardTalentUuids,
} from "./awardTalents.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function _stripHtml(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _truncateText(value, maxLength = 160) {
  const text = _stripHtml(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function _formatCost(entry) {
  return entry.costMin === entry.costMax
    ? String(entry.costMin)
    : `${entry.costMin}–${entry.costMax}`;
}

export class AwardTalentSelectorApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  constructor(options = {}) {
    super(options);
    this._entries = [];
    this._enabled = new Set();
    this._search = "";
    this._loaded = false;
    this._loadError = false;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-award-talent-selector`,
    tag: "div",
    window: {
      title: "sta-officers-log.settings.awardTalentSelector.title",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: {
      width: 780,
      height: 640,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/award-talent-selector.hbs`,
      scrollable: [".sta-award-talent-list"],
    },
  };

  async _ensureLoaded() {
    if (this._loaded) return;
    this._enabled = new Set(getEnabledAwardTalentUuids());
    try {
      this._entries = await loadAwardTalentEntries();
      this._loadError = false;
    } catch (err) {
      console.error(`${MODULE_ID} | failed to load award talents`, err);
      this._entries = [];
      this._loadError = true;
    }
    this._loaded = true;
  }

  async _prepareContext(_options) {
    await this._ensureLoaded();

    const q = this._search.trim().toLowerCase();
    const visible = q
      ? this._entries.filter((entry) =>
          `${entry.name} ${_stripHtml(entry.description)} ${entry.condition}`
            .toLowerCase()
            .includes(q),
        )
      : this._entries;

    return {
      title:
        t("sta-officers-log.settings.awardTalentSelector.title") ||
        "Select Award Talents",
      hint:
        t("sta-officers-log.settings.awardTalentSelector.hint") ||
        'Choose which Award-type talents appear as options in the Spend Acclaim dialog. Set a talent\'s Type to "Award" on its item sheet to make it eligible.',
      searchPlaceholder:
        t("sta-officers-log.settings.awardTalentSelector.searchPlaceholder") ||
        "Search award talents...",
      conditionLabel:
        t("sta-officers-log.settings.awardTalentSelector.conditionLabel") ||
        "Condition",
      costLabel:
        t("sta-officers-log.settings.awardTalentSelector.costLabel") || "Cost",
      closeLabel:
        t("sta-officers-log.settings.awardTalentSelector.close") || "Close",
      search: this._search,
      loadError: this._loadError,
      noneFoundLabel:
        t("sta-officers-log.settings.awardTalentSelector.noneFound") ||
        "No Award-type talents were found in the configured compendiums.",
      loadErrorLabel:
        t("sta-officers-log.settings.awardTalentSelector.loadFailed") ||
        "Failed to load award talents from compendiums.",
      hasEntries: visible.length > 0,
      countText: `${visible.length} / ${this._entries.length}`,
      entries: visible.map((entry) => ({
        uuid: entry.uuid,
        name: entry.name,
        img: entry.img || "icons/svg/item-bag.svg",
        descriptionPreview: _truncateText(entry.description, 200),
        condition:
          entry.condition ||
          t("sta-officers-log.settings.awardTalentSelector.conditionNone") ||
          "None",
        costLabel: _formatCost(entry),
        checked: this._enabled.has(entry.uuid),
      })),
    };
  }

  async _preRender(context, options) {
    const search = this.element?.querySelector?.('[data-role="search"]');
    this._pendingFocus =
      search &&
      this.element.contains(document.activeElement) &&
      document.activeElement === search
        ? { start: search.selectionStart, end: search.selectionEnd }
        : null;
    await super._preRender(context, options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;
    if (!html) return;

    const search = html.querySelector('[data-role="search"]');
    if (search && this._pendingFocus) {
      search.focus({ preventScroll: true });
      try {
        search.setSelectionRange(
          this._pendingFocus.start,
          this._pendingFocus.end,
        );
      } catch (_) {
        // ignore
      }
    }
    this._pendingFocus = null;

    search?.addEventListener("input", (event) => {
      this._search = event.currentTarget.value ?? "";
      this.render(true);
    });

    for (const checkbox of html.querySelectorAll(
      '.sta-award-talent-card input[type="checkbox"]',
    )) {
      checkbox.addEventListener("change", async (event) => {
        const uuid = event.currentTarget.dataset.uuid;
        if (!uuid) return;
        if (event.currentTarget.checked) this._enabled.add(uuid);
        else this._enabled.delete(uuid);
        await setEnabledAwardTalentUuids(Array.from(this._enabled));
      });
    }

    html
      .querySelector('[data-action="close-award-talent-selector"]')
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        this.close();
      });
  }
}

export function openAwardTalentSelector() {
  return new AwardTalentSelectorApp().render(true);
}
