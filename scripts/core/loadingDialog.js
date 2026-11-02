/**
 * Shows a temporary modal "Loading <thing> from compendiums..." window while
 * `task` runs, then closes it (also on failure).
 *
 * @param {string} thing  Plural noun shown in the message, e.g. "focuses".
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 * @template T
 */
export async function withCompendiumLoading(thing, task) {
  const label = String(thing ?? "").trim() || "items";
  const title = `Loading ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  const message = `Loading ${foundry.utils.escapeHTML(label)} from compendiums...`;

  let dialog = null;
  try {
    dialog = new foundry.applications.api.DialogV2({
      window: { title },
      classes: ["sta-officers-log", "talent-loading-dialog"],
      content: `<div class="sta-talent-loading-dialog"><div class="sta-talent-loading-spinner" aria-hidden="true"></div><div class="sta-talent-loading-message">${message}</div></div>`,
      buttons: [{ action: "loading", label: " ", callback: () => false }],
      default: "loading",
      closeOnSubmit: false,
      rejectClose: true,
      modal: true,
    });
    await dialog.render(true);
  } catch (_) {
    dialog = null;
  }

  try {
    return await task();
  } finally {
    try {
      await dialog?.close();
    } catch (_) {
      // ignore
    }
  }
}
