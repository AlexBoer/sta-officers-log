/**
 * Delete Confirmation
 *
 * Provides reusable confirmation dialogs for deleting items,
 * with special handling for logs (which can break arc chains).
 */

import { t } from "../../core/i18n.js";
import { escapeHTML } from "../../data/values.js";

// ─────────────────────────────────────────────────────────────────────────────
// Confirm Delete Dialog
// ─────────────────────────────────────────────────────────────────────────────

async function _confirmDelete({ title, contentHtml }) {
  // Prefer DialogV2 so we don't end up with mixed dialog versions.
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.wait) {
    try {
      const picked = await DialogV2.wait({
        window: { title },
        content: `
          <div class="sta-confirm-delete-dialog" data-sta-callbacks-dialog="confirm-delete">
            ${contentHtml}
          </div>
        `.trim(),
        buttons: [
          {
            action: "delete",
            label: t("sta-officers-log.confirmDelete.delete"),
            default: false,
            callback: () => "delete",
          },
          {
            action: "cancel",
            label: t("sta-officers-log.confirmDelete.cancel"),
            default: true,
            callback: () => "cancel",
          },
        ],
        rejectClose: false,
        modal: true,
      });
      return picked === "delete";
    } catch (_) {
      return false;
    }
  }

  // Last resort.
  // eslint-disable-next-line no-alert
  return globalThis.confirm?.(title) ?? false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic Confirm Delete Controls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace default sheet delete controls with a confirmation-wrapped delete.
 *
 * This is DOM-based and therefore works for any item list that uses a delete
 * control which triggers the sheet's normal delete handler.
 *
 * @param {HTMLElement} root
 * @param {object} options
 * @param {string} [options.entrySelector] CSS selector for item entry elements
 * @param {(entryEl: HTMLElement) => boolean} [options.shouldInstall] Filter entries
 * @param {string} [options.deleteSelector] CSS selector for the default delete link
 * @param {(entryEl: HTMLElement) => {title:string, contentHtml:string}} [options.getConfirmCopy]
 * @param {(entryEl: HTMLElement) => Promise<void>} [options.onDelete] Perform the delete without invoking the sheet's built-in delete handler
 */
export function installConfirmDeleteControls(root, options = {}) {
  const entrySelector = options.entrySelector ?? "li.row.entry";
  const deleteSelector =
    options.deleteSelector ?? 'a.delete[data-action="onItemDelete"], a.delete';

  const shouldInstall =
    options.shouldInstall ??
    ((entryEl) => {
      void entryEl;
      return true;
    });

  const getConfirmCopy =
    options.getConfirmCopy ??
    ((entryEl) => {
      const itemType = entryEl?.dataset?.itemType
        ? String(entryEl.dataset.itemType)
        : "item";
      return {
        title: `${t("sta-officers-log.confirmDelete.title")} ${itemType}?`,
        contentHtml: `${t("sta-officers-log.confirmDelete.body")}${escapeHTML(
          itemType,
        )}?`,
      };
    });

  const onDelete =
    typeof options.onDelete === "function" ? options.onDelete : null;

  const entries = root?.querySelectorAll?.(entrySelector);
  if (!entries?.length) return;

  for (const entryEl of Array.from(entries)) {
    if (!(entryEl instanceof HTMLElement)) continue;
    if (!shouldInstall(entryEl)) continue;

    if (entryEl.dataset?.staConfirmDeleteInstalled === "1") continue;

    const defaultDelete = entryEl.querySelector(deleteSelector);
    if (!(defaultDelete instanceof HTMLElement)) continue;

    // If another module already replaced it, don't fight.
    if (defaultDelete.classList.contains("sta-confirm-delete")) continue;

    const replacement = document.createElement("a");
    replacement.className = "delete sta-confirm-delete";
    replacement.title = defaultDelete.getAttribute("title") ?? "Delete";
    replacement.setAttribute("aria-label", replacement.title);

    // Keep existing icon markup (or fall back).
    replacement.innerHTML =
      defaultDelete.innerHTML?.trim?.() || '<i class="fas fa-trash"></i>';

    replacement.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      const { title, contentHtml } = getConfirmCopy(entryEl);
      const ok = await _confirmDelete({ title, contentHtml });
      if (!ok) return;

      if (onDelete) {
        try {
          await onDelete(entryEl);
        } catch (_) {
          // ignore
        }
        return;
      }

      // Fallback to the sheet's native delete handler (may show its own confirmation).
      try {
        defaultDelete.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      } catch (_) {
        // ignore
      }
    });

    // Hide the default delete link and replace it with our safe version.
    defaultDelete.style.display = "none";
    defaultDelete.setAttribute("aria-hidden", "true");

    defaultDelete.parentElement?.insertBefore(replacement, defaultDelete);
    entryEl.dataset.staConfirmDeleteInstalled = "1";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log Delete Confirmation (specialized)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Install confirmation controls for deleting logs on the character sheet.
 * Deleting logs can break chain/arc references because item IDs are not reusable.
 *
 * @param {HTMLElement} root - The root element of the character sheet.
 * @param {Actor} actor - The actor whose sheet is being rendered.
 */
export function installLogDeleteConfirmation(root, actor) {
  installConfirmDeleteControls(root, {
    entrySelector: 'div.section.milestones li.row.entry[data-item-type="log"]',
    shouldInstall: (entryEl) => entryEl?.dataset?.itemType === "log",
    deleteSelector: 'a.delete[data-action="onItemDelete"], a.delete',
    onDelete: async (entryEl) => {
      const itemId = entryEl?.dataset?.itemId
        ? String(entryEl.dataset.itemId)
        : "";
      if (!itemId) return;
      await actor.deleteEmbeddedDocuments("Item", [itemId]);
    },
    getConfirmCopy: (entryEl) => {
      const name =
        entryEl?.dataset?.itemValue ||
        entryEl?.querySelector?.("input.item-name")?.value ||
        "this log";
      return {
        title: "Delete Log?",
        contentHtml: `
          <p><strong>Deleting a log can break arc chains</strong></p>
          <p>You will need to recreate the chain manually by setting the correct callbacks.</p>
          <hr />
          <p>Delete <strong>${escapeHTML(String(name))}</strong> anyway?</p>
        `.trim(),
      };
    },
  });
}
