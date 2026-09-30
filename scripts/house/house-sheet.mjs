/**
 * HouseSheet - Editable Klingon House actor sheet.
 */

import { MODULE_ID } from "../core/constants.js";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class HouseSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  _activeHouseTab = "details";

  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "house-sheet"],
    actions: {
      editImage: HouseSheet._onEditImage,
      openMember: HouseSheet._onOpenMember,
      createHouseItem: HouseSheet._onCreateHouseItem,
      openHouseFocusPicker: HouseSheet._onOpenHouseFocusPicker,
      openHouseTalentPicker: HouseSheet._onOpenHouseTalentPicker,
      editHouseItem: HouseSheet._onEditHouseItem,
      deleteHouseItem: HouseSheet._onDeleteHouseItem,
    },
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
    },
    position: {
      height: 720,
      width: 760,
    },
    window: {
      resizable: true,
    },
    dragDrop: [{ dragSelector: null, dropSelector: ".house-sheet" }],
  };

  static PARTS = {
    sheet: {
      template: `modules/${MODULE_ID}/templates/house-sheet.hbs`,
    },
  };

  get title() {
    return `${this.actor.name} - House`;
  }

  async _prepareContext(_options) {
    const system = this.actor.system;
    const attributeKeys = [
      "control",
      "daring",
      "fitness",
      "insight",
      "presence",
      "reason",
    ];
    const departmentKeys = [
      "command",
      "conn",
      "engineering",
      "medicine",
      "science",
      "security",
    ];
    const attributeBonusRows = attributeKeys.map((key) => ({
      key,
      label: game.i18n.localize(`sta.actor.character.attribute.${key}`),
      total: Number(system.attributeBonuses?.[key] ?? 0),
    }));
    const departmentBonusRows = departmentKeys.map((key) => ({
      key,
      label: game.i18n.localize(`sta.actor.character.discipline.${key}`),
      total: Number(system.departmentBonuses?.[key] ?? 0),
    }));
    const houseUuid = String(this.actor.uuid ?? "");
    const houseId = String(this.actor.id ?? "");
    const members = (game.actors ?? [])
      .filter((actor) => {
        if (actor.type !== "character") return false;
        const assigned = String(actor.system?.houseActorUuid ?? "");
        return assigned === houseUuid || assigned === houseId;
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((actor) => ({
        id: actor.id,
        name: actor.name,
        img: actor.img,
        uuid: actor.uuid,
      }));
    const characters = members.map((member) => ({
      uuid: member.uuid,
      name: member.name,
      selected:
        member.uuid === system.leaderUuid || member.id === system.leaderUuid,
    }));

    return {
      actor: this.actor,
      system,
      isLcars: false,
      focuses: this.actor.items
        .filter((item) => item.type === "focus")
        .sort((left, right) => left.name.localeCompare(right.name)),
      talents: this.actor.items
        .filter((item) => item.type === "talent")
        .sort((left, right) => left.name.localeCompare(right.name)),
      traits: this.actor.items
        .filter((item) => item.type === "trait")
        .sort((left, right) => left.name.localeCompare(right.name)),
      milestones: this.actor.items
        .filter((item) => item.type === "milestone")
        .sort((left, right) => left.name.localeCompare(right.name)),
      attributeBonusRows,
      departmentBonusRows,
      members,
      memberCount: members.length,
      characters,
      status: system.status ?? {},
      legacy: system.legacy ?? {},
      temperament: system.temperament ?? {},
      statusAttributeBonuses: JSON.stringify(
        system.status?.attributeBonuses ?? {},
        null,
        2,
      ),
      statusDepartmentBonuses: JSON.stringify(
        system.status?.departmentBonuses ?? {},
        null,
        2,
      ),
      legacyAttributeBonuses: JSON.stringify(
        system.legacy?.attributeBonuses ?? {},
        null,
        2,
      ),
      legacyDepartmentBonuses: JSON.stringify(
        system.legacy?.departmentBonuses ?? {},
        null,
        2,
      ),
      temperamentAttributeBonuses: JSON.stringify(
        system.temperament?.attributeBonuses ?? {},
        null,
        2,
      ),
      temperamentDepartmentBonuses: JSON.stringify(
        system.temperament?.departmentBonuses ?? {},
        null,
        2,
      ),
      statusSuggestedValues: JSON.stringify(
        system.status?.suggestedValues ?? [],
        null,
        2,
      ),
      legacySuggestedFocuses: JSON.stringify(
        system.legacy?.suggestedFocuses ?? [],
        null,
        2,
      ),
      legacySuggestedTalents: JSON.stringify(
        system.legacy?.suggestedTalents ?? [],
        null,
        2,
      ),
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    if (!root) return;

    if (!this._houseDragDrop) {
      this._houseDragDrop = new foundry.applications.ux.DragDrop({
        dragSelector: null,
        dropSelector: ".house-sheet",
        permissions: {
          drop: () => this.actor.isOwner,
        },
        callbacks: {
          drop: this._onDrop.bind(this),
        },
      });
    }
    this._houseDragDrop.bind(root);

    const activateHouseTab = (selected) => {
      const tab = root.querySelector(`.house-tabs [data-tab="${selected}"]`);
      if (!tab) selected = "details";
      this._activeHouseTab = selected;

      root.querySelectorAll(".house-tabs [data-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === selected);
      });
      root.querySelectorAll("[data-tab-content]").forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.tabContent !== selected);
      });
    };

    root.querySelectorAll(".house-tabs [data-tab]").forEach((tab) => {
      if (tab.dataset.houseTabWired === "1") return;
      tab.dataset.houseTabWired = "1";
      tab.addEventListener("click", () => {
        activateHouseTab(tab.dataset.tab);
      });
    });

    activateHouseTab(this._activeHouseTab);

    root.querySelectorAll("[data-tab-target]").forEach((button) => {
      if (button.dataset.houseTabTargetWired === "1") return;
      button.dataset.houseTabTargetWired = "1";
      button.addEventListener("click", () => {
        root.querySelector(`[data-tab="${button.dataset.tabTarget}"]`)?.click();
      });
    });

    root.querySelectorAll("[data-json-path]").forEach((input) => {
      if (input.dataset.houseJsonWired === "1") return;
      input.dataset.houseJsonWired = "1";
      input.addEventListener("change", async () => {
        try {
          const value = JSON.parse(input.value || "{}");
          await this.actor.update({ [input.dataset.jsonPath]: value });
          input.value = JSON.stringify(value, null, 2);
        } catch (_) {
          ui.notifications?.warn?.("House bonuses must be valid JSON.");
        }
      });
    });
  }

  static _onEditImage(_event, _target) {
    const sheet = this;
    new FilePicker({
      type: "image",
      current: sheet.actor.img,
      callback: (path) => sheet.actor.update({ img: path }),
    }).browse();
  }

  static async _onOpenMember(_event, target) {
    const member = game.actors?.get(target.dataset.actorId);
    if (member) await member.sheet?.render(true);
  }

  static async _onCreateHouseItem(_event, target) {
    const nameByType = {
      focus: "New Focus",
      talent: "New Talent",
      trait: "New Trait",
      milestone: "House Development",
    };
    const [item] = await this.actor.createEmbeddedDocuments("Item", [
      {
        name: nameByType[target.dataset.type] ?? "New Item",
        type: target.dataset.type,
      },
    ]);
    await item?.sheet?.render?.(true);
  }

  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.getDragEventData(event);
    if (data?.type !== "Item" || !this.actor.isOwner) return false;

    const item = await Item.implementation.fromDropData(data);
    if (
      !item ||
      !["focus", "talent", "trait", "milestone"].includes(item.type)
    ) {
      ui.notifications?.warn?.(
        "Only Focus, Talent, Trait, and Milestone items can be added to a House.",
      );
      return false;
    }

    const itemData = item.toObject();
    delete itemData._id;
    await this.actor.createEmbeddedDocuments("Item", [itemData]);
    this.render(true);
    return true;
  }

  static async _onOpenHouseFocusPicker() {
    const { openDefineFocusDialog } =
      await import("../creation/define-dialogs.mjs");
    await openDefineFocusDialog(this.actor);
    this.render(true);
  }

  static async _onOpenHouseTalentPicker() {
    if (!game.staUtils?.talentPicker) {
      const { openDefineTalentDialog } =
        await import("../creation/define-dialogs.mjs");
      await openDefineTalentDialog(this.actor);
      this.render(true);
      return;
    }

    const loadingDialog = new foundry.applications.api.DialogV2({
      window: { title: "Loading House Talents" },
      classes: ["sta-officers-log", "talent-loading-dialog"],
      content:
        '<div class="sta-talent-loading-dialog"><div class="sta-talent-loading-spinner" aria-hidden="true"></div><div class="sta-talent-loading-message">Loading House talents from compendiums...</div></div>',
      buttons: [{ action: "loading", label: " ", callback: () => false }],
      default: "loading",
      closeOnSubmit: false,
      rejectClose: true,
      modal: true,
    });

    await loadingDialog.render(true);
    try {
      const { loadTalentPickerTalents } =
        await import("../milestones/talentPickerDialog.js");
      const loadResult = await loadTalentPickerTalents({ actor: this.actor });
      for (const message of loadResult?.errors ?? []) {
        ui.notifications?.warn?.(message);
      }
      const houseTalents = (loadResult?.talents ?? []).filter(
        (entry) =>
          String(entry?.talenttype?.typeenum ?? "")
            .trim()
            .toLowerCase() === "house",
      );
      await loadingDialog.close();
      const result = await game.staUtils.talentPicker({
        title: "House Talent Picker",
        heading: "Choose a House Talent",
        actorName: this.actor.name,
        talents: houseTalents,
        eligibility: false,
        allowCustom: true,
        categoryLabel: "House Talents",
      });
      if (!result) return;

      if (result.custom) {
        await this.actor.createEmbeddedDocuments("Item", [
          { type: "talent", name: "New Talent", system: { description: "" } },
        ]);
      } else {
        const talent = result.talent?.data ?? result.talent;
        const itemData = foundry.utils.deepClone(talent ?? {});
        delete itemData._id;
        itemData.type = "talent";
        await this.actor.createEmbeddedDocuments("Item", [itemData]);
      }
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | House Talent picker failed`, error);
      ui.notifications?.error?.("Unable to load House talents.");
    } finally {
      await loadingDialog.close();
    }
  }

  static async _onEditHouseItem(_event, target) {
    await this.actor.items.get(target.dataset.itemId)?.sheet?.render?.(true);
  }

  static async _onDeleteHouseItem(_event, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete House Item" },
      content: `<p>Delete ${foundry.utils.escapeHTML(item.name)}?</p>`,
    });
    if (confirmed) await item.delete();
  }
}
