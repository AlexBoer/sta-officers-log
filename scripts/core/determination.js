/**
 * Determination Helpers
 *
 * Universal gain/spend determination operations for character actors.
 * Used by milestones, callbacks, socket RPC handlers, and value/directive usage.
 */

/**
 * Increase a character actor's determination by 1 (max 3).
 * @param {Actor} char - A character-type actor.
 */
export async function gainDetermination(char) {
  if (char?.type !== "character") return;

  const prevDet = Number(char.system?.determination?.value ?? 0);
  const nextDet = Math.min(3, prevDet + 1);

  if (nextDet !== prevDet) {
    await char.update({ "system.determination.value": nextDet });
  }
}

/**
 * Decrease a character actor's determination by 1 (min 0).
 * @param {Actor} char - A character-type actor.
 */
export async function spendDetermination(char) {
  if (char?.type !== "character") return;

  const prevDet = Number(char.system?.determination?.value ?? 0);
  const nextDet = Math.max(0, prevDet - 1);

  if (nextDet !== prevDet) {
    await char.update({ "system.determination.value": nextDet });
  }
}
