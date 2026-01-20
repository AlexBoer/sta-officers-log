import { MODULE_ID } from "../constants.js";
import { ATTRIBUTE_LABELS } from "../callbackFlow/dialogs.js";

const FATIGUED_TRAIT_NAME = "Fatigued (Choose an Attribute)";
const FATIGUED_TRAIT_FLAG_KEY = "fatiguedTraitUuid";
const IS_FATIGUE_FLAG_KEY = "isFatigue";
const FATIGUED_ATTRIBUTE_FLAG_KEY = "fatiguedAttribute";
const ATTRIBUTE_TO_FATIGUED_NAME = {
  control: "Disordered",
  daring: "Uncertain",
  fitness: "Exhausted",
  insight: "Confused",
  presence: "Doubtful",
  reason: "Insensible",
};
// Reverse mapping for finding which attribute corresponds to a fatigued name
const FATIGUED_NAME_TO_ATTRIBUTE = Object.entries(
  ATTRIBUTE_TO_FATIGUED_NAME,
).reduce((acc, [key, value]) => {
  acc[value] = key;
  return acc;
}, {});
const FATIGUED_TRAIT_DESCRIPTION =
  "Fatigued: +1 difficulty on all task rolls. Additionally, all tasks using the chosen attribute automatically fail.";

let _staStressMonitoringHookInstalled = false;

// Per-actor lock to prevent concurrent create/delete operations
const _fatigueOperationInProgress = new Set();

/**
 * Shows a dialog for selecting which attribute caused the fatigue.
 * Updates the fatigued trait name based on the selected attribute.
 * @param {Item} traitItem - The Fatigued trait item
 * @param {Actor} actor - The character actor
 * @returns {void}
 */
async function showAttributeSelectionDialog(traitItem, actor) {
  if (!traitItem || traitItem.type !== "trait") return;

  const buttons = [];

  // Create button for each attribute
  Object.entries(ATTRIBUTE_LABELS).forEach(([key, label]) => {
    buttons.push({
      action: key,
      label: label,
    });
  });

  const result = await foundry.applications.api.DialogV2.wait({
    window: {
      title: "Fatigued: Choose Attribute",
      icon: "fas fa-tired",
    },
    content: "<p>Choose which attribute your character is fatigued in:</p>",
    buttons: buttons,
    default: "control",
  });

  // If a valid attribute was selected, update the trait
  if (result && ATTRIBUTE_TO_FATIGUED_NAME[result]) {
    try {
      const newName = ATTRIBUTE_TO_FATIGUED_NAME[result];
      await traitItem.update({ name: newName });
      // Store which attribute is fatigued in the actor flags
      if (actor) {
        await actor.setFlag?.(MODULE_ID, FATIGUED_ATTRIBUTE_FLAG_KEY, result);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to update fatigued trait name`, err);
    }
  }
}

/**
 * Finds an existing Fatigued trait on the actor.
 * First tries to find by stored ID in flags, then falls back to flag-based lookup.
 * @param {Actor} actor - The character actor
 * @returns {Item|null} The Fatigued trait item, or null if not found
 */
export function findFatiguedTrait(actor) {
  if (!actor?.items) return null;
  try {
    // First, try to find by ID stored in actor flags
    const storedId = actor.getFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
    if (storedId) {
      const traitById = actor.items.get(storedId);
      if (traitById && traitById.type === "trait") return traitById;
      // ID didn't match; flag is stale, clear it asynchronously
      void actor.unsetFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
    }

    // Fall back to flag-based lookup: find any trait with isFatigue flag set to true
    const byFlag = Array.from(actor.items).find(
      (item) =>
        item?.type === "trait" &&
        item.getFlag?.(MODULE_ID, IS_FATIGUE_FLAG_KEY) === true,
    );
    if (byFlag) return byFlag;

    // Final fallback: check for any trait whose name matches known fatigue names
    const knownNames = new Set([
      FATIGUED_TRAIT_NAME,
      ...Object.values(ATTRIBUTE_TO_FATIGUED_NAME),
    ]);
    return (
      Array.from(actor.items).find(
        (item) => item?.type === "trait" && knownNames.has(item.name),
      ) ?? null
    );
  } catch (_) {
    return null;
  }
}

/**
 * Gets the user who should handle fatigue for an actor.
 * Prefers the owning player if they're online, otherwise the first active GM.
 * @param {Actor} actor - The character actor
 * @returns {User|null} The user who should handle, or null if none
 */
function getUserToHandleFatigue(actor) {
  // Find the player who owns this character
  const owningPlayer = game.users?.find(
    (u) => !u.isGM && u.active && u.character?.id === actor.id,
  );
  if (owningPlayer) {
    console.log(
      `${MODULE_ID} | Fatigue handler: owning player ${owningPlayer.name}`,
    );
    return owningPlayer;
  }

  // Check if any player has ownership of this actor
  const playerOwners = game.users?.filter(
    (u) => !u.isGM && u.active && actor.testUserPermission?.(u, "OWNER"),
  );
  if (playerOwners?.length > 0) {
    const handler = playerOwners.sort((a, b) => a.id.localeCompare(b.id))[0];
    console.log(`${MODULE_ID} | Fatigue handler: player owner ${handler.name}`);
    return handler;
  }

  // Fall back to first active GM
  const activeGMs = game.users?.filter((u) => u.isGM && u.active) ?? [];
  const gmHandler =
    activeGMs.sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
  console.log(
    `${MODULE_ID} | Fatigue handler: GM fallback ${gmHandler?.name ?? "none"}`,
  );
  return gmHandler;
}

/**
 * Checks if the current user should handle fatigue for the given actor.
 * @param {Actor} actor - The character actor
 * @returns {boolean}
 */
function shouldCurrentUserHandleFatigue(actor) {
  const handler = getUserToHandleFatigue(actor);
  return handler?.id === game.user?.id;
}

/**
 * Creates a new Fatigued trait on the actor and stores its ID in flags.
 * Shows an attribute selection dialog after creation.
 * @param {Actor} actor - The character actor
 * @returns {Promise<Item|null>} The newly created trait, or null if creation fails
 */
async function createFatiguedTrait(actor) {
  if (!actor?.createEmbeddedDocuments) return null;
  try {
    const [created] = await actor.createEmbeddedDocuments("Item", [
      {
        type: "trait",
        name: FATIGUED_TRAIT_NAME,
        system: {
          description: FATIGUED_TRAIT_DESCRIPTION,
        },
      },
    ]);

    if (!created) return null;

    // Store the ID in actor flags so we can find it even if renamed
    if (created.id) {
      await actor.setFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY, created.id);
    }

    // Set the isFatigue flag on the trait itself (must be done after creation)
    await created.setFlag?.(MODULE_ID, IS_FATIGUE_FLAG_KEY, true);

    // Refresh the embedded Item reference from the actor to ensure updates
    await new Promise((r) => setTimeout(r, 100));
    const refreshed = actor.items.get(created.id) || created;
    // Show attribute selection dialog using the refreshed item reference
    await showAttributeSelectionDialog(refreshed, actor);

    return created;
  } catch (err) {
    console.error(`${MODULE_ID} | createFatiguedTrait failed`, err);
    return null;
  }
}

/**
 * Deletes the Fatigued trait from the actor and clears the UUID flag.
 * @param {Actor} actor - The character actor
 * @param {Item} traitItem - The Fatigued trait item to delete
 * @returns {Promise<void>}
 */
async function deleteFatiguedTrait(actor, traitItem) {
  if (!actor?.deleteEmbeddedDocuments) return;
  try {
    // Resolve the current embedded Item id on the actor. The passed traitItem
    // may be stale or come from a different document instance, so prefer the
    // actor's live collection.
    let idToDelete = null;

    if (traitItem?.id && actor.items.get(traitItem.id)) {
      idToDelete = traitItem.id;
    } else if (traitItem?.uuid) {
      const byUuid = actor.items.find((i) => i?.uuid === traitItem.uuid);
      if (byUuid) idToDelete = byUuid.id;
    }

    // As a final fallback, find any trait on the actor marked with the
    // IS_FATIGUE_FLAG_KEY flag.
    if (!idToDelete) {
      const flagged = Array.from(actor.items).find(
        (i) =>
          i?.type === "trait" &&
          i.getFlag?.(MODULE_ID, IS_FATIGUE_FLAG_KEY) === true,
      );
      if (flagged) idToDelete = flagged.id;
    }

    // If nothing found, clear flags and return gracefully.
    if (!idToDelete) {
      await actor.unsetFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
      await actor.unsetFlag?.(MODULE_ID, FATIGUED_ATTRIBUTE_FLAG_KEY);
      return;
    }

    await actor.deleteEmbeddedDocuments("Item", [idToDelete]);
    // Clear the stored UUID flag and fatigued attribute flag
    await actor.unsetFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
    await actor.unsetFlag?.(MODULE_ID, FATIGUED_ATTRIBUTE_FLAG_KEY);
  } catch (err) {
    console.warn(`${MODULE_ID} | deleteFatiguedTrait failed`, err);
  }
}

/**
 * Checks if the current user can modify the actor (for stress trait management).
 * @param {Actor} actor - The character actor
 * @returns {boolean} True if the user can write to the actor
 */
function canWriteActor(actor) {
  try {
    return (
      game.user?.isGM === true ||
      actor?.isOwner === true ||
      (typeof actor?.testUserPermission === "function" &&
        actor.testUserPermission(game.user, "OWNER"))
    );
  } catch (_) {
    return false;
  }
}

/**
 * Installs the stress monitoring hook. When a character's stress reaches or exceeds
 * their maximum stress, a "Fatigued" trait is automatically added. When stress drops
 * below maximum, the trait is removed.
 */
export function installStressMonitoringHook() {
  if (_staStressMonitoringHookInstalled) return;
  _staStressMonitoringHookInstalled = true;

  Hooks.on("updateActor", (actor, changes) => {
    try {
      // Only monitor character actors
      if (actor?.type !== "character") return;

      // Check if stress value changed
      const stressValueChanged =
        foundry.utils.getProperty(changes, "system.stress.value") !== undefined;
      if (!stressValueChanged) return;

      // Use player-first responsibility: owning player handles if online, otherwise GM
      const shouldHandle = shouldCurrentUserHandleFatigue(actor);
      console.log(
        `${MODULE_ID} | Stress changed for ${actor.name}, shouldHandle=${shouldHandle}, currentUser=${game.user?.name}`,
      );
      if (!shouldHandle) return;

      // Prevent concurrent operations on the same actor
      const actorId = actor.id;
      if (_fatigueOperationInProgress.has(actorId)) return;

      const currentStress = Number(actor.system?.stress?.value ?? 0);
      const maxStress = Number(actor.system?.stress?.max ?? 0);
      const isFatigued = currentStress >= maxStress;
      const existingFatiguedTrait = findFatiguedTrait(actor);

      // If fatigued but no trait exists, create it
      if (isFatigued && !existingFatiguedTrait) {
        _fatigueOperationInProgress.add(actorId);
        void (async () => {
          try {
            // Double-check no trait was created by another client in the meantime
            await new Promise((r) => setTimeout(r, 50));
            const recheck = findFatiguedTrait(actor);
            if (recheck) {
              console.log(
                `${MODULE_ID} | Fatigue trait already exists (race avoided)`,
              );
              return;
            }
            await createFatiguedTrait(actor);
          } catch (_) {
            // ignore
          } finally {
            _fatigueOperationInProgress.delete(actorId);
          }
        })();
        return;
      }

      // If not fatigued but trait exists, delete it
      if (!isFatigued && existingFatiguedTrait) {
        _fatigueOperationInProgress.add(actorId);
        void (async () => {
          try {
            await deleteFatiguedTrait(actor, existingFatiguedTrait);
          } catch (_) {
            // ignore
          } finally {
            _fatigueOperationInProgress.delete(actorId);
          }
        })();
        return;
      }
    } catch (_) {
      // ignore
    }
  });
}
