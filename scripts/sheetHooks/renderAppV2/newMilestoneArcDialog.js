import { MODULE_ID } from "../../constants.js";
import { t } from "../../i18n.js";
import {
  applyArcMilestoneBenefit,
  applyNonArcMilestoneBenefit,
  formatChosenBenefitLabel,
} from "../../callbackFlow.js";

const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

class NewMilestoneArcApp extends Base {
  constructor(
    {
      actor,
      initialTab = null,
      lockOtherTab = false,
      onApplied = null,
      traumaValueId = null,
      traumaAllChallenged = false,
    } = {},
    options = {},
  ) {
    super(options);
    this._actor = actor ?? null;
    this._initialTab = initialTab ? String(initialTab) : null;
    this._lockOtherTab = lockOtherTab === true;
    this._onApplied = typeof onApplied === "function" ? onApplied : null;
    this._traumaValueId = traumaValueId ? String(traumaValueId) : null;
    this._traumaAllChallenged = traumaAllChallenged === true;

    // Also hint to Foundry's built-in tabs (when present).
    try {
      if (this._initialTab && this.options?.tabs?.[0]) {
        this.options.tabs[0].initial = this._initialTab;
      }
    } catch (_) {
      // ignore
    }
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-new-milestone-arc`,
    window: { title: "New Milestone / Arc" },
    classes: ["sta-officers-log", "choose-benefit"],
    position: { width: 520, height: "auto" },
    resizable: false,
    tabs: [
      {
        navSelector: ".tabs",
        contentSelector: ".content",
        initial: "milestone",
      },
    ],
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/new-milestone-arc.hbs`,
    },
  };

  async _prepareContext(_options) {
    return {
      milestoneTabTitle: "New Milestone",
      arcTabTitle: "New Arc",
      milestonePrompt:
        t("sta-officers-log.dialog.chooseMilestoneBenefit.chooseType") ??
        "Choose a milestone benefit.",
      arcPrompt:
        t("sta-officers-log.dialog.chooseMilestoneBenefit.arcChooseType") ??
        "Choose an arc benefit.",
      milestoneButtons: [
        {
          action: "attr",
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.increaseAttribute",
          ),
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
          action: "custom",
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.customMilestone",
          ),
        },
      ],
      arcButtons: [
        {
          action: "attr",
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseAttribute",
          ),
        },
        {
          action: "disc",
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.arcIncreaseDiscipline",
          ),
        },
        {
          action: "value",
          label: t(
            "sta-officers-log.dialog.chooseMilestoneBenefit.arcAddValue",
          ),
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
          action: "custom",
          label: t("sta-officers-log.dialog.chooseMilestoneBenefit.customArc"),
        },
        // Conditionally add Remove Trauma if this arc is a trauma arc
        ...(this._traumaValueId
          ? [
              {
                action: "removeTrauma",
                label: t(
                  "sta-officers-log.dialog.chooseMilestoneBenefit.arcRemoveTrauma",
                ),
                disabled: !this._traumaAllChallenged,
                tooltip: !this._traumaAllChallenged
                  ? t(
                      "sta-officers-log.dialog.chooseMilestoneBenefit.arcRemoveTraumaDisabledTooltip",
                    )
                  : null,
              },
            ]
          : []),
      ],
    };
  }

  async _createStandaloneMilestone({ name, applied, isArc }) {
    if (!this._actor) return null;
    const safeName = String(name ?? "").trim();
    if (!safeName) return null;

    const action = applied?.action ? String(applied.action) : "";
    const createdItemId = applied?.createdItemId
      ? String(applied.createdItemId)
      : "";

    const syncPolicy = action === "arcValue" ? "once" : "always";

    const milestoneBenefit = {
      action,
      syncPolicy,
      syncedOnce: false,
      ...(createdItemId ? { createdItemId } : {}),
    };

    const itemData = {
      name: safeName,
      type: "milestone",
      flags: {
        [MODULE_ID]: {
          milestoneBenefit,
        },
      },
      system: {
        description: "",
        ...(isArc
          ? {
              arc: {
                isArc: true,
                steps: Number(applied?.steps ?? 0),
              },
            }
          : {}),
      },
    };

    const [created] = await this._actor.createEmbeddedDocuments("Item", [
      itemData,
    ]);
    return created ?? null;
  }

  _attachPartListeners(partId, htmlElement, _options) {
    // Important: ApplicationV2/HandlebarsApplicationMixin attaches built-in listeners here
    // (including TabsV2). If we override without calling super, tabs won't activate.
    super._attachPartListeners?.(partId, htmlElement, _options);

    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    if (root.dataset.staNewMilestoneArcBound === "1") return;
    root.dataset.staNewMilestoneArcBound = "1";

    // Fallback tab binding:
    // Some Foundry versions/templates don't automatically activate tabs for ApplicationV2
    // unless the app wires them explicitly. Keep behavior minimal: just toggle "active".
    {
      const nav =
        root.querySelector('nav.tabs[data-group="primary"]') ??
        root.querySelector("nav.tabs") ??
        null;

      const tabButtons = Array.from(
        nav?.querySelectorAll?.(".item[data-tab]") ?? [],
      );
      const tabPanels = Array.from(
        root.querySelectorAll('.tab[data-group="primary"][data-tab]'),
      );

      const activateTab = (tabName) => {
        const tab = String(tabName ?? "");
        if (!tab) return;

        for (const el of tabButtons) {
          el.classList.toggle("active", el.dataset.tab === tab);
        }
        for (const el of tabPanels) {
          el.classList.toggle("active", el.dataset.tab === tab);
        }
      };

      // Choose initial tab from options if present, otherwise default to milestone.
      const initialTab =
        this._initialTab ??
        this.options?.tabs?.[0]?.initial ??
        nav?.querySelector(".item.active")?.dataset?.tab ??
        "milestone";
      activateTab(initialTab);

      if (this._lockOtherTab) {
        const allowed = String(initialTab ?? "milestone");
        const other = allowed === "arc" ? "milestone" : "arc";

        for (const el of tabButtons) {
          if (el?.dataset?.tab !== other) continue;
          el.classList.add("disabled");
          el.setAttribute("aria-disabled", "true");
          el.tabIndex = -1;
        }

        // Block switching even if Foundry's own tab handler is also attached.
        nav?.addEventListener(
          "click",
          (ev) => {
            const item = ev.target?.closest?.(".item[data-tab]");
            if (!(item instanceof HTMLElement)) return;
            if (item.getAttribute("aria-disabled") !== "true") return;
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation?.();
          },
          true,
        );
      }

      nav?.addEventListener("click", (ev) => {
        const item = ev.target?.closest?.(".item[data-tab]");
        if (!(item instanceof HTMLElement)) return;
        ev.preventDefault();
        activateTab(item.dataset.tab);
      });
    }

    root.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action]");
      if (!(btn instanceof HTMLButtonElement)) return;
      if (btn.disabled) return;

      ev.preventDefault();
      ev.stopPropagation();

      const group = String(btn.getAttribute("data-group") ?? "milestone");
      const action = String(btn.getAttribute("data-action") ?? "");
      if (!action) return;

      if (!this._actor) return;

      btn.disabled = true;
      try {
        // Handle custom milestone/arc creation
        if (action === "custom") {
          const isArc = group === "arc";
          const name = "New Milestone";

          if (this._onApplied) {
            await this._onApplied({
              applied: { action: isArc ? "arcCustom" : "custom" },
              label: name,
              isArc,
              group,
            });
          } else {
            await this._createStandaloneMilestone({
              name,
              applied: { action: isArc ? "arcCustom" : "custom" },
              isArc,
            });
          }

          await this.close();
          return;
        }

        const applied =
          group === "arc"
            ? await applyArcMilestoneBenefit(this._actor, {
                initialAction: action,
                traumaValueId: this._traumaValueId,
              })
            : await applyNonArcMilestoneBenefit(this._actor, {
                initialAction: action,
              });

        if (!applied?.applied) return;

        const label = formatChosenBenefitLabel(applied);
        const isArc = String(applied.action ?? "").startsWith("arc");

        if (this._onApplied) {
          await this._onApplied({ applied, label, isArc, group });
        } else {
          await this._createStandaloneMilestone({
            name: label,
            applied,
            isArc,
          });
        }

        await this.close();
      } catch (err) {
        console.error(`${MODULE_ID} | NewMilestoneArcApp failed`, err);
        ui.notifications?.error?.("Failed to create milestone.");
      } finally {
        btn.disabled = false;
      }
    });
  }
}

export function openNewMilestoneArcDialog(
  actor,
  {
    initialTab = null,
    lockOtherTab = false,
    onApplied = null,
    traumaValueId = null,
    traumaAllChallenged = false,
  } = {},
) {
  const app = new NewMilestoneArcApp({
    actor,
    initialTab,
    lockOtherTab,
    onApplied,
    traumaValueId,
    traumaAllChallenged,
  });
  app.render(true);
  return app;
}
