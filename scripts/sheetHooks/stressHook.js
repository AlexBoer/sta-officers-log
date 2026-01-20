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
 * First tries to find by stored UUID in flags, then falls back to flag-based lookup.
 * @param {Actor} actor - The character actor
 * @returns {Item|null} The Fatigued trait item, or null if not found
 */
function findFatiguedTrait(actor) {
  if (!actor?.items) return null;
  try {
    // First, try to find by UUID stored in flags
    const storedUuid = actor.getFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
    if (storedUuid) {
      const traitByUuid = Array.from(actor.items).find(
        (item) => item?.uuid === storedUuid && item?.type === "trait",
      );
      if (traitByUuid) return traitByUuid;
      // UUID didn't match; flag is stale, clear it
      void actor.unsetFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
    }

    // Fall back to flag-based lookup: find any trait with isFatigue flag set to true
    return (
      Array.from(actor.items).find(
        (item) =>
          item?.type === "trait" &&
          item.getFlag?.(MODULE_ID, IS_FATIGUE_FLAG_KEY) === true,
      ) ?? null
    );
  } catch (_) {
    return null;
  }
}

/**
 * Creates a new Fatigued trait on the actor and stores its UUID in flags.
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

    if (created?.uuid) {
      // Store the UUID in flags so we can find it even if renamed
      await actor.setFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY, created.uuid);
    }

    // Set the isFatigue flag on the trait itself
    if (created) {
      await created.setFlag?.(MODULE_ID, IS_FATIGUE_FLAG_KEY, true);
      // Show attribute selection dialog
      await showAttributeSelectionDialog(created, actor);
    }

    return created ?? null;
  } catch (_) {
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
  if (!actor?.deleteEmbeddedDocuments || !traitItem?.id) return;
  try {
    await actor.deleteEmbeddedDocuments("Item", [traitItem.id]);
    // Clear the stored UUID flag and fatigued attribute flag
    await actor.unsetFlag?.(MODULE_ID, FATIGUED_TRAIT_FLAG_KEY);
    await actor.unsetFlag?.(MODULE_ID, FATIGUED_ATTRIBUTE_FLAG_KEY);
  } catch (_) {
    // ignore
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

      // Only proceed if the user can write to the actor
      if (!canWriteActor(actor)) return;

      const currentStress = Number(actor.system?.stress?.value ?? 0);
      const maxStress = Number(actor.system?.stress?.max ?? 0);
      const isFatigued = currentStress >= maxStress;
      const existingFatiguedTrait = findFatiguedTrait(actor);

      // If fatigued but no trait exists, create it
      if (isFatigued && !existingFatiguedTrait) {
        void (async () => {
          try {
            await createFatiguedTrait(actor);
          } catch (_) {
            // ignore
          }
        })();
        return;
      }

      // If not fatigued but trait exists, delete it
      if (!isFatigued && existingFatiguedTrait) {
        void (async () => {
          try {
            await deleteFatiguedTrait(actor, existingFatiguedTrait);
          } catch (_) {
            // ignore
          }
        })();
        return;
      }
    } catch (_) {
      // ignore
    }
  });
}
