import { MODULE_ID } from "../constants.js";
import { t } from "../i18n.js";
import {
  SHIP_TALENT_BASE_PACKS,
  prepareTalentPickerContext,
  bindTalentPickerInteractions,
  loadTalentPickerTalents,
} from "./talentPickerDialog.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

class ShipTalentSwapApp extends Base {
  constructor(
    { ship = null, talents = [], shipTalents = [], resolve = null } = {},
    options = {}
  ) {
    super(options);
    this._ship = ship;
    this._talents = Array.isArray(talents) ? talents : [];
    this._shipTalents = Array.isArray(shipTalents) ? shipTalents : [];
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
    this._selectedShipTalentId = null;
    this._selectedShipTalentName = "";
    this._selectedNewTalent = null;
    this._selectedNewTalentName = "";
    this._selectedExistingBtn = null;
    this._selectedNewBtn = null;
    this._selectedCustomBtn = null;
    this._summaryExistingEl = null;
    this._summaryNewEl = null;
    this._confirmBtn = null;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-ship-talent-swap`,
    window: {
      title:
        t("sta-officers-log.dialog.shipTalentSwap.title") ??
        "Replace a Ship Talent",
    },
    classes: ["sta-officers-log", "ship-talent-swap"],
    position: { width: 960, height: "auto" },
    resizable: true,
    tabs: [],
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/dialog-ship-talent-swap.hbs`,
    },
  };

  async _prepareContext(_options) {
    const pickerContext = prepareTalentPickerContext(
      this._talents,
      this._ship,
      {
        showCustomButton: false,
      }
    );
    const rawPickerMarkup =
      await foundry.applications.handlebars.renderTemplate(
        `modules/${MODULE_ID}/templates/talent-picker.hbs`,
        pickerContext
      );
    const talentPickerMarkup = String(rawPickerMarkup ?? "")
      .trim()
      .replace(/^<form\b([^>]*)>/i, "<div$1>")
      .replace(/<\/form>\s*$/i, "</div>");

    const shipName = this._ship?.name ?? "";
    const notChosen =
      t("sta-officers-log.dialog.shipTalentSwap.notChosen") ?? "Not chosen yet";

    const customLabel =
      t("sta-officers-log.dialog.shipTalentSwap.customLabel") ??
      "Custom Talent";
    const customPlaceholder =
      t("sta-officers-log.dialog.shipTalentSwap.customPlaceholder") ??
      "Describe the custom talent";
    const customButtonLabel =
      t("sta-officers-log.dialog.shipTalentSwap.customButton") ??
      "Choose Custom Talent";

    return {
      leftTitle:
        t("sta-officers-log.dialog.shipTalentSwap.leftTitle") ??
        "Current Ship Talents",
      rightTitle:
        t("sta-officers-log.dialog.shipTalentSwap.rightTitle") ?? "New Talent",
      removeHint:
        t("sta-officers-log.dialog.shipTalentSwap.removeHint") ??
        `Choose a talent from ${shipName || "the ship"} to remove.`,
      addHint:
        t("sta-officers-log.dialog.shipTalentSwap.addHint") ??
        "Pick a new talent to add.",
      customLabel,
      customPlaceholder,
      customButtonLabel,
      removeLabel:
        t("sta-officers-log.dialog.shipTalentSwap.removeLabel") ?? "Removing",
      addLabel:
        t("sta-officers-log.dialog.shipTalentSwap.addLabel") ?? "Adding",
      selectedExistingLabel: notChosen,
      selectedNewLabel: notChosen,
      confirmLabel:
        t("sta-officers-log.dialog.shipTalentSwap.confirm") ?? "Confirm Swap",
      backLabel: t("sta-officers-log.dialog.shipTalentSwap.back") ?? "Back",
      cancelLabel:
        t("sta-officers-log.dialog.shipTalentSwap.cancel") ?? "Cancel",
      shipTalents: this._shipTalents,
      talentPickerMarkup,
    };
  }

  _attachPartListeners(partId, htmlElement, _options) {
    super._attachPartListeners?.(partId, htmlElement, _options);
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;
    if (root.dataset.staShipTalentSwapBound === "1") return;
    root.dataset.staShipTalentSwapBound = "1";

    this._summaryExistingEl = root.querySelector("[data-selected-existing]");
    this._summaryNewEl = root.querySelector("[data-selected-new]");
    this._confirmBtn = root.querySelector('button[data-action="confirm"]');

    const existingButtons = Array.from(
      root.querySelectorAll("button[data-action=select-ship-talent]")
    );
    for (const btn of existingButtons) {
      btn.addEventListener("click", () => {
        const talentId = String(btn.dataset.shipTalentId ?? "");
        const talentName = String(btn.dataset.shipTalentName ?? "");
        if (!talentId) return;
        this._selectedShipTalentId = talentId;
        this._selectedShipTalentName = talentName;
        if (this._selectedExistingBtn) {
          this._selectedExistingBtn.classList.remove("is-active");
        }
        btn.classList.add("is-active");
        this._selectedExistingBtn = btn;
        if (this._summaryExistingEl) {
          this._summaryExistingEl.textContent =
            talentName || this._summaryExistingEl.textContent;
        }
        this._updateConfirmButton();
      });
    }

    const customInput = root.querySelector('input[name="customTalentName"]');
    const customBtn = root.querySelector('button[data-action="choose-custom"]');
    const warnNoCustom = () =>
      ui.notifications?.warn?.(
        t("sta-officers-log.dialog.shipTalentSwap.customNameRequired") ??
          "Enter a custom talent name before selecting it."
      );

    customBtn?.addEventListener("click", () => {
      const name = String(customInput?.value ?? "").trim();
      if (!name) {
        warnNoCustom();
        return;
      }

      if (this._selectedNewBtn) {
        this._selectedNewBtn.classList.remove("is-selected");
        this._selectedNewBtn = null;
      }
      if (this._selectedCustomBtn && this._selectedCustomBtn !== customBtn) {
        this._selectedCustomBtn.classList.remove("is-selected");
      }
      customBtn.classList.add("is-selected");
      this._selectedCustomBtn = customBtn;

      this._selectedNewTalent = { name, img: null, uuid: null };
      this._selectedNewTalentName = name;
      if (this._summaryNewEl) {
        this._summaryNewEl.textContent =
          this._selectedNewTalentName || this._summaryNewEl.textContent;
      }
      this._updateConfirmButton();
    });

    const pickerRoot = root.querySelector(".sta-focus-picker");
    const binding = bindTalentPickerInteractions(pickerRoot, this._talents, {
      onChoose: async (entry, btn) => {
        if (this._selectedCustomBtn) {
          this._selectedCustomBtn.classList.remove("is-selected");
          this._selectedCustomBtn = null;
        }

        this._selectedNewTalent = entry;
        this._selectedNewTalentName = String(entry?.name ?? "").trim();
        if (this._selectedNewBtn) {
          this._selectedNewBtn.classList.remove("is-selected");
        }
        if (btn) {
          btn.classList.add("is-selected");
          this._selectedNewBtn = btn;
        }
        if (this._summaryNewEl) {
          this._summaryNewEl.textContent =
            this._selectedNewTalentName || this._summaryNewEl.textContent;
        }
        this._updateConfirmButton();
      },
      onCancel: () => {
        return null;
      },
    });
    binding.applyFilter();

    const backBtn = root.querySelector('button[data-action="back"]');
    const cancelBtn = root.querySelector('button[data-action="cancel"]');

    this._confirmBtn?.addEventListener("click", async () => {
      if (!this._selectedShipTalentId || !this._selectedNewTalent) {
        ui.notifications?.warn?.(
          t("sta-officers-log.dialog.shipTalentSwap.needSelection") ??
            "Choose both a talent to remove and a new talent to add before confirming."
        );
        return;
      }
      this._resolveOnce({
        action: "confirm",
        removeId: this._selectedShipTalentId,
        newTalent: this._selectedNewTalent,
      });
      await this.close();
    });

    backBtn?.addEventListener("click", async () => {
      this._resolveOnce("back");
      await this.close();
    });

    cancelBtn?.addEventListener("click", async () => {
      this._resolveOnce(null);
      await this.close();
    });
  }

  _updateConfirmButton() {
    if (!this._confirmBtn) return;
    this._confirmBtn.disabled = !(
      this._selectedShipTalentId && this._selectedNewTalent
    );
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error(`${MODULE_ID} | ship talent swap resolve failed`, err);
    }
  }

  async close(options = {}) {
    this._resolveOnce(null);
    return super.close(options);
  }
}

export async function promptShipTalentSwapDialog({ ship = null } = {}) {
  if (!ship) return null;

  const { talents, errors } = await loadTalentPickerTalents({
    basePackKeys: SHIP_TALENT_BASE_PACKS,
    priorityEntries: SHIP_TALENT_BASE_PACKS.map((key, idx) => [key, idx + 1]),
    folderKind: "starship",
  });

  for (const msg of errors ?? []) {
    ui.notifications?.warn?.(msg);
  }

  if (!talents.length) {
    ui.notifications?.warn?.("No talents found in the available compendiums.");
    return null;
  }

  return new Promise((resolve) => {
    const shipTalents = (ship.items ?? [])
      .filter((item) => item?.type === "talent" || item?.type === "shipTalent")
      .map((item) => {
        const itemType = String(item?.type ?? "talent").toLowerCase();
        return {
          id: item.id ?? "",
          name: item.name ?? item.id ?? "",
          img: item.img ?? item.system?.image ?? null,
          type: itemType,
          typeLabel:
            itemType === "shiptalent"
              ? t("sta-officers-log.dialog.shipTalentSwap.shipTalentLabel") ??
                "Ship Talent"
              : t("sta-officers-log.dialog.shipTalentSwap.talentLabel") ??
                "Talent",
        };
      })
      .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

    const app = new ShipTalentSwapApp({
      ship,
      talents,
      shipTalents,
      resolve,
    });
    app.render(true);
  });
}
