/**
 * OfficersTraitData — Extended TypeDataModel for the "trait" item type.
 *
 * The STA system already defines TraitData (extends TypeDataModel) and registers
 * it at CONFIG.Item.dataModels.trait. This module sub-classes that definition to
 * add sta-officers-log's scar fields, so they live in `item.system` rather than
 * `item.flags["sta-officers-log"]`.
 *
 * Fields migrated from flags:
 *  - isScar     BooleanField — whether this trait is a Scar
 *  - isScarUsed BooleanField — whether this Scar has been spent
 */

export function registerOfficersTraitDataModel() {
  const BaseTraitData = CONFIG.Item.dataModels?.trait;
  if (!BaseTraitData) {
    console.warn(
      "sta-officers-log | STA system TraitData not found at CONFIG.Item.dataModels.trait; skipping trait TypeDataModel registration.",
    );
    return;
  }

  const { fields } = foundry.data;

  class OfficersTraitData extends BaseTraitData {
    static defineSchema() {
      return {
        ...super.defineSchema(),

        // ── Scar fields (migrated from flags) ───────────────────────────────
        isScar: new fields.BooleanField({ initial: false }),
        isScarUsed: new fields.BooleanField({ initial: false }),
      };
    }
  }

  CONFIG.Item.dataModels.trait = OfficersTraitData;
  console.log("sta-officers-log | OfficersTraitData registered.");
}
