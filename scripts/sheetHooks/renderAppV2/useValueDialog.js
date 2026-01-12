import { MODULE_ID } from "../../constants.js";
import { t, tf } from "../../i18n.js";

const _UseValueBase = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

class UseValueApp extends _UseValueBase {
  constructor(
    {
      valueName = "",
      prompt = "",
      chooseLabel = "Choose",
      options = [],
      resolve = null,
    } = {},
    appOptions = {}
  ) {
    super(appOptions);
    this._valueName = valueName;
    this._prompt = prompt;
    this._chooseLabel = chooseLabel;
    this._options = Array.isArray(options) ? options : [];
    this._resolve = typeof resolve === "function" ? resolve : null;
    this._resolved = false;
  }

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-use-value`,
    window: { title: "Use Value" },
    classes: ["sta-officers-log", "use-value"],
    position: { width: 920, height: "auto" },
    resizable: false,
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/use-value.hbs`,
    },
  };

  get title() {
    const v = this._valueName ? String(this._valueName) : "";
    return v ? `Use Value: ${v}` : "Use Value";
  }

  async _prepareContext(_options) {
    return {
      prompt: this._prompt,
      chooseLabel: this._chooseLabel,
      options: this._options,
    };
  }

  _resolveOnce(value) {
    if (this._resolved) return;
    this._resolved = true;
    try {
      this._resolve?.(value);
    } catch (err) {
      console.error("sta-officers-log | UseValueApp resolve failed", err);
    }
  }

  async close(options = {}) {
    // If the window is closed via X, treat it as cancel.
    this._resolveOnce(null);
    return super.close(options);
  }

  _attachPartListeners(partId, htmlElement, _options) {
    if (partId !== "main") return;

    const root = htmlElement;
    if (!root) return;

    // Prevent duplicate bindings on the same DOM node
    if (root.dataset.staUseValueBound === "1") return;
    root.dataset.staUseValueBound = "1";

    root.addEventListener("click", async (ev) => {
      const btn = ev.target?.closest?.("button[data-action]");
      if (!(btn instanceof HTMLButtonElement)) return;
      if (btn.disabled) return;

      ev.preventDefault();
      ev.stopPropagation();

      const action = btn.getAttribute("data-action");
      this._resolveOnce(action);
      await super.close();
    });
  }
}

export async function promptUseValueChoice({
  valueName,
  canChoosePositive = true,
}) {
  return new Promise((resolve) => {
    const app = new UseValueApp({
      valueName,
      prompt: tf("sta-officers-log.dialog.useValue.prompt", {
        value: valueName ?? "",
      }),
      chooseLabel: t("sta-officers-log.dialog.useValue.choose"),
      options: [
        {
          action: "positive",
          title: t("sta-officers-log.dialog.useValue.positiveTitle"),
          description: t("sta-officers-log.dialog.useValue.positiveDesc"),
          disabled: !canChoosePositive,
          buttonLabel: canChoosePositive ? null : "No Determination!",
        },
        {
          action: "negative",
          title: t("sta-officers-log.dialog.useValue.negativeTitle"),
          description: t("sta-officers-log.dialog.useValue.negativeDesc"),
        },
        {
          action: "challenge",
          title: t("sta-officers-log.dialog.useValue.challengeTitle"),
          description: t("sta-officers-log.dialog.useValue.challengeDesc"),
        },
      ],
      resolve,
    });
    app.render(true);
  });
}
