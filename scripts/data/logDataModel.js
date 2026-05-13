/**
 * OfficersLogData — Extended TypeDataModel for the "log" item type.
 *
 * The STA system already defines LogData (extends TypeDataModel) and registers it
 * at CONFIG.Item.dataModels.log. This module sub-classes that definition to add the
 * sta-officers-log module's own fields, so they live in `item.system` rather than
 * `item.flags["sta-officers-log"]`.
 *
 * Fields migrated from flags:
 *  - callbackLink            ObjectField — { fromLogId, valueId, milestoneId? }
 *  - arcInfo                 ObjectField — { isArc, steps, valueId, chainLogIds, arcLabel }
 *  - primaryValueId          StringField — ID of the primary value item for this log
 *  - callbackLinkDisabled    BooleanField — user's explicit "no link" override
 *  - createdWithTrauma       BooleanField — whether the primary value was a trauma at creation
 *  - pendingMilestoneBenefit ObjectField — pending milestone/arc benefit payload
 *  - showMilestoneArcButton  BooleanField — show the Choose Benefit button for this log
 *  - primaryDirectiveKey     StringField — key of the selected directive
 *  - directiveLabels         ObjectField — map of directive key → display text
 *  - customDate              StringField (nullable) — user-set in-game date override (YYYY-MM-DD)
 *  - customIrlDate           StringField (nullable) — user-set real-world IRL date override (YYYY-MM-DD)
 *  - flowchartPosition       ObjectField (nullable) — saved x/y position in the flowchart
 */

export function registerOfficersLogDataModel() {
  const BaseLogData = CONFIG.Item.dataModels?.log;
  if (!BaseLogData) {
    console.warn(
      "sta-officers-log | STA system LogData not found at CONFIG.Item.dataModels.log; skipping TypeDataModel registration.",
    );
    return;
  }

  const { fields } = foundry.data;

  class OfficersLogData extends BaseLogData {
    static defineSchema() {
      return {
        ...super.defineSchema(),

        // ── Core chain / callback fields (migrated from flags) ──────────────
        callbackLink: new fields.ObjectField({ nullable: true, initial: null }),
        arcInfo: new fields.ObjectField({ nullable: true, initial: null }),
        primaryValueId: new fields.StringField({ initial: "" }),
        callbackLinkDisabled: new fields.BooleanField({ initial: false }),
        createdWithTrauma: new fields.BooleanField({ initial: false }),

        // ── Milestone / arc flow fields ───────────────────────────────────
        pendingMilestoneBenefit: new fields.ObjectField({
          nullable: true,
          initial: null,
        }),
        showMilestoneArcButton: new fields.BooleanField({ initial: false }),

        // ── Directive metadata ───────────────────────────────────────────────
        primaryDirectiveKey: new fields.StringField({ initial: "" }),
        directiveLabels: new fields.ObjectField({ initial: {} }),

        // ── Display / layout fields ───────────────────────────────────────────
        customDate: new fields.StringField({ nullable: true, initial: null }),
        customIrlDate: new fields.StringField({
          nullable: true,
          initial: null,
        }),
        flowchartPosition: new fields.ObjectField({
          nullable: true,
          initial: null,
        }),
      };
    }
  }

  CONFIG.Item.dataModels.log = OfficersLogData;
  console.log("sta-officers-log | OfficersLogData registered.");
}
