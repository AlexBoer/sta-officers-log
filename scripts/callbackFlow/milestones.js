import { MODULE_ID } from "../constants.js";

/**
 *
 * @param {*} actor         a character actor using the 2e version of the character sheet (unverified if it will work on the 1e version)
 * @param {*} chosenLogId   the item ID of the log which the user chose when asked if they would make a callback. It is the previous log item being called back to.
 * @param {*} currentLogId  the item ID of the log representing the current mission, set up by the GM at the mission's start.
 * @param {*} valueImg      the image URL for the milestone item to be created.
 * @param {*} valueId       the callback value ID being used for this callback.
 * @param {*} arc           an object representing the arc info, with properties isArc (boolean) and chainLogIds (array of log item IDs in the arc chain)
 * @param {*} benefitLabel  optional label to use as the milestone item name instead of the default.
 * @returns a Promise resolving to the created milestone item, or null on failure.
 */
export async function createMilestoneItem(
  actor,
  { chosenLogId, currentLogId, valueImg, valueId, arc, benefitLabel, benefit }
) {
  if (!actor || !chosenLogId || !currentLogId || !valueId) return null;

  const chosenLog = actor.items.get(chosenLogId);
  const currentLog = actor.items.get(currentLogId);
  if (!chosenLog || !currentLog) return null;

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const childUpdates = {};
  const arcChain = arc?.isArc ? arc?.chainLogIds ?? [] : [];

  // Arc: Set the value of the associate logs to the logIds listed in arcChain.
  if (arcChain.length) {
    const max = Math.min(arcChain.length, letters.length);
    for (let i = 0; i < max; i += 1) {
      childUpdates[`child${letters[i]}`] = arcChain[i];
    }
  } else {
    // Non-arc: just link the called-back log and the current mission log.
    childUpdates.childA = chosenLog.id;
    childUpdates.childB = currentLog.id;
  }

  // Create the milestone item on the actor and populate its data.
  const benefitCreatedItemId = benefit?.createdItemId
    ? String(benefit.createdItemId)
    : "";
  const benefitAction = benefit?.action ? String(benefit.action) : "";
  const benefitSyncPolicy = benefit?.syncPolicy
    ? String(benefit.syncPolicy)
    : "always";
  const benefitSyncedOnce = Boolean(benefit?.syncedOnce);

  const [milestone] = await actor.createEmbeddedDocuments("Item", [
    {
      name:
        benefitLabel && String(benefitLabel).trim()
          ? `${String(benefitLabel).trim()}`
          : `Callback: ${currentLog.name} + ${chosenLog.name}`,
      img: valueImg ?? null,
      type: "milestone",
      flags: {
        [MODULE_ID]: {
          callbackValueId: valueId,
          ...(benefitCreatedItemId
            ? {
                milestoneBenefit: {
                  createdItemId: benefitCreatedItemId,
                  action: benefitAction,
                  syncPolicy: benefitSyncPolicy,
                  syncedOnce: benefitSyncedOnce,
                },
              }
            : {}),
        },
      },
      system: {
        ...childUpdates,
        ...(arc?.isArc
          ? {
              arc: {
                isArc: true,
                steps: Number(arc.steps ?? arcChain.length ?? 0),
              },
            }
          : {}),
        description: "",
      },
    },
  ]);

  return milestone ?? null;
}

// takes a character actor and increases its determination by 1, up to a max of 3
export async function gainDetermination(char) {
  if (char?.type !== "character") return;

  const prevDet = Number(char.system?.determination?.value ?? 0);
  const nextDet = Math.min(3, prevDet + 1);

  if (nextDet !== prevDet) {
    await char.update({ "system.determination.value": nextDet });
  }
}

// takes a character actor and decreases its determination by 1, down to a min of 0
export async function spendDetermination(char) {
  if (char?.type !== "character") return;

  const prevDet = Number(char.system?.determination?.value ?? 0);
  const nextDet = Math.max(0, prevDet - 1);

  if (nextDet !== prevDet) {
    await char.update({ "system.determination.value": nextDet });
  }
}
