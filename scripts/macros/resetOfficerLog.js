/**
 * Macro: Reset Officer's Log
 * Deletes all log and milestone items from a chosen actor
 * and clears all sta-officers-log actor-level flags.
 */

const MODULE_ID = "sta-officers-log";

// --- Actor picker dialog ---
const actors = game.actors.filter((a) => a.type === "character");
if (!actors.length) {
  ui.notifications.warn("No character actors found.");
  return;
}

const actorOptions = actors
  .map((a) => `<option value="${a.id}">${a.name}</option>`)
  .join("");

new Dialog({
  title: "Reset Officer's Log",
  content: `
    <form>
      <div class="form-group">
        <label>Select Actor</label>
        <select name="actorId">${actorOptions}</select>
      </div>
      <p style="margin-top:8px; color:#b33;">
        <strong>Warning:</strong> This will permanently delete <em>all</em> mission logs
        and milestones from the selected actor and reset its Officer's Log state.
        This cannot be undone.
      </p>
    </form>`,
  buttons: {
    reset: {
      icon: '<i class="fas fa-trash"></i>',
      label: "Reset",
      callback: async (html) => {
        const actorId = html.find('[name="actorId"]').val();
        const actor = game.actors.get(actorId);
        if (!actor) return ui.notifications.error("Actor not found.");

        // Confirm
        const confirmed = await Dialog.confirm({
          title: "Are you sure?",
          content: `<p>Delete all logs & milestones from <strong>${actor.name}</strong> and clear Officer's Log flags?</p>`,
        });
        if (!confirmed) return;

        // 1. Collect log and milestone item IDs
        const itemIds = actor.items
          .filter((i) => i.type === "log" || i.type === "milestone")
          .map((i) => i.id);

        // 2. Delete items (in batches of 50 to avoid request-size issues)
        const batchSize = 50;
        for (let i = 0; i < itemIds.length; i += batchSize) {
          const batch = itemIds.slice(i, i + batchSize);
          await actor.deleteEmbeddedDocuments("Item", batch);
        }

        // 3. Clear all actor-level module flags
        const flagKeys = [
          "currentMissionLogId",
          "usedCallbackThisMission",
          "pendingShipBenefits",
          "missionLogSortMode",
          "challengedDirectives",
          "collapsedArcIds",
        ];
        for (const key of flagKeys) {
          try {
            await actor.unsetFlag(MODULE_ID, key);
          } catch {
            // flag may not exist on this actor — that's fine
          }
        }

        ui.notifications.info(
          `Officer's Log reset for ${actor.name}: removed ${itemIds.length} item(s) and cleared flags.`,
        );
      },
    },
    cancel: {
      icon: '<i class="fas fa-times"></i>',
      label: "Cancel",
    },
  },
  default: "cancel",
}).render(true);
