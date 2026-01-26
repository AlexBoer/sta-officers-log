/**
 * Callback Request Application
 *
 * ApplicationV2 dialog that prompts players to confirm a callback,
 * select a log entry, and specify value/directive state.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { isCallbackTargetCompatibleWithValue } from "../data/callbackEligibility.js";
import { escapeHTML } from "../data/values.js";

// Use the Handlebars mixin so the app is renderable (provides _renderHTML/_replaceHTML).
const Base = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
);

export class CallbackRequestApp extends Base {
  constructor(data, options = {}) {
    super(options);
    this.data = data ?? {};
  }

  /**
   * Override close to handle cleanup when dialog is closed without clicking Yes/No
   */
  async close(options) {
    // Clear timeout
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    // If promise resolver still exists, resolve with "no" action (user closed dialog)
    if (this._resolveCallback) {
      this._resolveCallback({
        module: MODULE_ID,
        type: "callback:response",
        requestId: this.data.requestId,
        action: "no",
        targetUserId: this.data.targetUserId,
        actorUuid: this.data.actorUuid,
      });
      this._resolveCallback = null;
    }

    return super.close(options);
  }

  static DEFAULT_OPTIONS = {
    id: "sta-callbacks-request",
    window: {
      title: t("sta-officers-log.callback.title") ?? "Making a callback",
    },
    classes: ["sta-callbacks", "sta-officers-log", "callback-request"],
    position: { width: 560 },
    resizable: true,
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/callback-request.hbs`,
    },
  };

  get title() {
    return (
      this.data?.title ??
      t("sta-officers-log.callback.title") ??
      "Making a callback"
    );
  }

  async _prepareContext(_options) {
    const dvs = this.data.defaultValueState ?? "positive";
    const dvi = this.data.defaultValueId
      ? String(this.data.defaultValueId)
      : "";

    // Find the display name for the selected value/directive
    let selectedValueName = "";
    if (dvi) {
      const values = this.data.values ?? [];
      const directives = this.data.directives ?? [];

      const valueItem = values.find((v) => String(v.id) === dvi);
      const directiveItem = directives.find((d) => String(d.id) === dvi);

      selectedValueName = valueItem?.name || directiveItem?.name || "";
    }

    const allLogs = this.data.logs ?? [];
    const logsForButtons = allLogs.slice(0, 3); // Show max 3 as buttons
    const hasMoreLogs = allLogs.length > 3;

    return {
      requestId: this.data.requestId,
      targetUserId: this.data.targetUserId,
      actorUuid: this.data.actorUuid,
      bodyHtml: this.data.bodyHtml,
      logs: allLogs,
      logsForButtons,
      hasMoreLogs,
      hasLogs: Boolean(this.data.hasLogs),
      selectedValueId: dvi,
      selectedValueName,
      selectedValueState: dvs,
    };
  }

  _renderInvokedValues(logId, rootEl) {
    const list = rootEl.querySelector('[data-hook="invokedList"]');
    if (!list) return;

    const log = (this.data.logs ?? []).find((l) => l.id === logId);
    const invoked = log?.invoked ?? [];

    if (!invoked.length) {
      const msg =
        t("sta-officers-log.callback.noInvokedValues") ??
        "No invoked values recorded in this log.";
      list.innerHTML = `<li><em>${escapeHTML(msg)}</em></li>`;
      return;
    }

    list.innerHTML = invoked
      .map(
        (v) =>
          `<li><strong>${escapeHTML(
            v.name,
          )}</strong> <span style="opacity:.8">(${escapeHTML(
            v.state,
          )})</span></li>`,
      )
      .join("");
  }

  _attachPartListeners(partId, htmlElement, _options) {
    if (partId !== "form") return;

    // htmlElement is the root of the "form" part for ApplicationV2
    const root = htmlElement;
    if (!root) return;

    // Prevent duplicate bindings on the same DOM node
    if (root.dataset.staCallbacksBound === "1") return;
    root.dataset.staCallbacksBound = "1";

    const form = root.querySelector("form") ?? root;
    const noBtn = root.querySelector('[data-action="no"]');
    const allLogsSelect = root.querySelector('[data-hook="allLogsSelect"]');

    // Get all logs data
    const logs = this.data.logs ?? [];
    let selectedLogId = logs.length > 0 ? String(logs[0].id) : "";

    // Auto-select and show invoked values for the first log
    if (selectedLogId) {
      this._renderInvokedValues(selectedLogId, root);
    }

    // Handle log button clicks - immediately submit the callback
    const logButtons = root.querySelectorAll('[data-action="select-log"]');
    logButtons.forEach((btn, index) => {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        const logId = btn.dataset.logId;

        // Auto-confirm and submit the callback for this log
        this._sendResponse({
          action: "yes",
          logId,
        });
      });
    });

    // Handle "show all logs" button - replace buttons with dropdown
    const showAllBtn = root.querySelector('[data-action="show-all-logs"]');
    if (showAllBtn) {
      showAllBtn.addEventListener("click", (ev) => {
        ev.preventDefault();

        // Hide buttons and link
        const buttonsDiv = root.querySelector(".sta-callback-logs-buttons");
        const moreLogsDiv = root.querySelector(".sta-callback-more-logs");
        const selectorDiv = root.querySelector(
          ".sta-callback-all-logs-selector",
        );

        if (buttonsDiv) buttonsDiv.style.display = "none";
        if (moreLogsDiv) moreLogsDiv.style.display = "none";
        if (selectorDiv) selectorDiv.style.display = "block";

        // Show the select and focus it
        if (allLogsSelect) {
          allLogsSelect.value = selectedLogId || "";
          allLogsSelect.focus();
        }
      });
    }

    // Handle selection from the all-logs dropdown - enable confirm button
    if (allLogsSelect) {
      allLogsSelect.addEventListener("change", (ev) => {
        selectedLogId = String(ev.target.value);

        // Update invoked values for reference
        if (selectedLogId) {
          this._renderInvokedValues(selectedLogId, root);
        }

        // Enable/disable confirm button based on selection
        const confirmBtn = root.querySelector('[data-action="confirm-log"]');
        if (confirmBtn) {
          confirmBtn.disabled = !selectedLogId;
        }
      });
    }

    // Handle confirm button click
    const confirmBtn = root.querySelector('[data-action="confirm-log"]');
    if (confirmBtn) {
      confirmBtn.addEventListener("click", (ev) => {
        ev.preventDefault();

        if (selectedLogId) {
          this._sendResponse({
            action: "yes",
            logId: selectedLogId,
          });
        }
      });
    }

    // Handle the NO button (skip)
    noBtn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._sendResponse({
        action: "no",
      });
    });
  }

  _sendResponse({ action, logId = null }) {
    // Clear timeout
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    const valueId = String(
      this.data.defaultValueId ? String(this.data.defaultValueId) : "",
    );
    const valueState = String(this.data.defaultValueState ?? "positive");

    if (action === "yes") {
      if (!valueId) {
        ui.notifications.warn("No value selected for callback.");
        return;
      }
      if (!logId) {
        ui.notifications.warn("No log selected for callback.");
        return;
      }

      if (this._resolveCallback) {
        this._resolveCallback({
          module: MODULE_ID,
          type: "callback:response",
          requestId: this.data.requestId,
          targetUserId: this.data.targetUserId,
          actorUuid: this.data.actorUuid,
          action: "yes",
          logId,
          valueId,
          valueState,
        });
        this._resolveCallback = null;
      }
    } else if (action === "no") {
      if (this._resolveCallback) {
        this._resolveCallback({
          module: MODULE_ID,
          type: "callback:response",
          requestId: this.data.requestId,
          action: "no",
          targetUserId: this.data.targetUserId,
          actorUuid: this.data.actorUuid,
        });
        this._resolveCallback = null;
      }
    }

    this.close();
  }
}
