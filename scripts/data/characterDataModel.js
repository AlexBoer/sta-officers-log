/**
 * OfficersCharacterData — Extended TypeDataModel for the "character" actor type.
 *
 * The STA system already defines CharacterData (extends TypeDataModel) and registers
 * it at CONFIG.Actor.dataModels.character. This module sub-classes that definition to
 * add sta-officers-log's per-character mission state fields, so they live in
 * `actor.system` rather than `actor.flags["sta-officers-log"]`.
 *
 * Fields migrated from flags:
 *  - currentMissionLogId    StringField (nullable) — ID of the actor's current mission log
 *  - usedCallbackThisMission BooleanField — whether the actor has used their callback this mission
 *  - pendingShipBenefits    ArrayField  — queued ship action benefits awaiting GM approval
 */

export function registerOfficersCharacterDataModel() {
  const BaseCharacterData = CONFIG.Actor.dataModels?.character;
  if (!BaseCharacterData) {
    console.warn(
      "sta-officers-log | STA system CharacterData not found at CONFIG.Actor.dataModels.character; skipping character TypeDataModel registration.",
    );
    return;
  }

  const { fields } = foundry.data;

  class OfficersCharacterData extends BaseCharacterData {
    static defineSchema() {
      return {
        ...super.defineSchema(),

        // ── Mission state fields (migrated from flags) ───────────────────────
        currentMissionLogId: new fields.StringField({
          nullable: true,
          initial: null,
        }),
        usedCallbackThisMission: new fields.BooleanField({ initial: false }),
        pendingShipBenefits: new fields.ArrayField(new fields.ObjectField(), {
          initial: [],
        }),
      };
    }
  }

  CONFIG.Actor.dataModels.character = OfficersCharacterData;
  console.log("sta-officers-log | OfficersCharacterData registered.");
}
