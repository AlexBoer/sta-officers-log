import { t } from "../../i18n.js";

function _escapeHtml(s) {
  // Keep this file self-contained; prefer Foundry's canonical escaping.
  try {
    return foundry.utils.escapeHTML(String(s ?? ""));
  } catch (_) {
    return String(s ?? "");
  }
}

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

  // Fallback for older Foundry versions.
  if (globalThis.Dialog?.confirm) {
    return await new Promise((resolve) => {
      try {
        globalThis.Dialog.confirm({
          title,
          content: contentHtml,
          yes: () => resolve(true),
          no: () => resolve(false),
          defaultYes: false,
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  // Last resort.
  // eslint-disable-next-line no-alert
  return globalThis.confirm?.(title) ?? false;
}

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
        contentHtml: `${t("sta-officers-log.confirmDelete.body")}${_escapeHtml(
          itemType
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
          new MouseEvent("click", { bubbles: true, cancelable: true })
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
