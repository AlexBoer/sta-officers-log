/**
 * HouseData - Structured data for Klingon House actors.
 *
 * Status, Legacy, and Temperament keep their mechanical bonuses alongside
 * their selected values so character creation can consume the House directly.
 */

export function registerHouseDataModel() {
  const { fields } = foundry.data;

  const houseChoice = () =>
    new fields.SchemaField({
      value: new fields.StringField({ initial: "" }),
      description: new fields.StringField({ initial: "" }),
      attributeBonuses: new fields.ObjectField({ initial: {} }),
      departmentBonuses: new fields.ObjectField({ initial: {} }),
      suggestedValues: new fields.ArrayField(new fields.StringField(), {
        initial: [],
      }),
      suggestedFocuses: new fields.ArrayField(new fields.StringField(), {
        initial: [],
      }),
      suggestedTalents: new fields.ArrayField(new fields.StringField(), {
        initial: [],
      }),
      reputationModifier: new fields.NumberField({
        integer: true,
        initial: 0,
      }),
      freeDepartmentBonus: new fields.BooleanField({ initial: false }),
    });

  class HouseData extends foundry.abstract.TypeDataModel {
    static defineSchema() {
      return {
        status: houseChoice(),
        legacy: houseChoice(),
        temperament: houseChoice(),
        attributeBonuses: new fields.ObjectField({ initial: {} }),
        departmentBonuses: new fields.ObjectField({ initial: {} }),
        reputation: new fields.NumberField({
          required: true,
          integer: true,
          initial: 3,
          min: 0,
          max: 12,
        }),
        influence: new fields.NumberField({
          required: true,
          integer: true,
          initial: 6,
          min: 6,
          max: 12,
        }),
        might: new fields.NumberField({
          required: true,
          integer: true,
          initial: 6,
          min: 6,
          max: 12,
        }),
        wealth: new fields.NumberField({
          required: true,
          integer: true,
          initial: 6,
          min: 6,
          max: 12,
        }),
        isGreatHouse: new fields.BooleanField({ initial: true }),
        highCouncilSeat: new fields.BooleanField({ initial: false }),
        dissolved: new fields.BooleanField({ initial: false }),
        leaderUuid: new fields.StringField({ nullable: true, initial: null }),
        successionOrder: new fields.ArrayField(new fields.StringField(), {
          initial: [],
        }),
        allies: new fields.ArrayField(new fields.StringField(), {
          initial: [],
        }),
        rivals: new fields.ArrayField(new fields.StringField(), {
          initial: [],
        }),
        description: new fields.StringField({ initial: "" }),
        history: new fields.StringField({ initial: "" }),
        advancementHistory: new fields.ArrayField(new fields.ObjectField(), {
          initial: [],
        }),
      };
    }
  }

  CONFIG.Actor.dataModels["sta-officers-log.house"] = HouseData;
  console.log("sta-officers-log | HouseData registered.");
}
