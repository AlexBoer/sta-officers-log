/**
 * HouseSheet - Editable Klingon House actor sheet.
 */

import { MODULE_ID } from "../core/constants.js";
import { t } from "../core/i18n.js";
import { STAActors } from "/systems/sta/module/actors/sta-actors.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const creatingMemberActors = new WeakMap();

function _getStaActorsClass() {
  if (CONFIG?.Actor?.sheetClasses) {
    for (const typeMap of Object.values(CONFIG.Actor.sheetClasses)) {
      if (!typeMap || typeof typeMap !== "object") continue;
      for (const entry of Object.values(typeMap)) {
        let cls = entry?.cls;
        while (cls && cls !== Function.prototype && cls !== Object.prototype) {
          if (Array.isArray(cls.PALETTES)) return cls;
          cls = Object.getPrototypeOf(cls);
        }
      }
    }
  }
  return STAActors;
}

function _warnHouseEditPermission() {
  ui.notifications?.warn?.(
    game.i18n.localize("sta-officers-log.house.editMembersNoPermission") ||
      "You do not have permission to edit this House.",
  );
}

async function _updateHouse(sheet, changes) {
  try {
    await sheet.actor.update(changes);
    return true;
  } catch (error) {
    console.error(`${MODULE_ID} | failed to update House`, error);
    ui.notifications?.error?.(
      game.i18n.localize("sta-officers-log.house.updateFailed") ||
        "Could not update this House.",
    );
    return false;
  }
}

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
      addMember: HouseSheet._onAddMember,
      editDummyMember: HouseSheet._onEditDummyMember,
      removeDummyMember: HouseSheet._onRemoveDummyMember,
      createMemberActor: HouseSheet._onCreateMemberActor,
      addToSuccession: HouseSheet._onAddToSuccession,
      moveSuccession: HouseSheet._onMoveSuccession,
      removeFromSuccession: HouseSheet._onRemoveFromSuccession,
      onColourPalette: function (ev) {
        return this._onColourPalette(ev);
      },
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
    dragDrop: [
      { dragSelector: ".house-item-row", dropSelector: ".house-sheet" },
    ],
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
    const linkedMembers = (game.actors ?? [])
      .filter((actor) => {
        if (actor.type !== "character") return false;
        const assigned = String(actor.system?.houseActorUuid ?? "");
        return assigned === houseUuid || assigned === houseId;
      })
      .map((actor) => ({
        ref: actor.uuid,
        id: actor.id,
        name: actor.name,
        img: actor.img,
        uuid: actor.uuid,
        role: actor.system?.showklingon
          ? String(actor.system?.houseRole ?? "").trim()
          : "",
        isDummy: false,
      }));
    const dummyMembers = (system.dummyMembers ?? []).map((member) => ({
      ref: `dummy:${member.id}`,
      id: member.id,
      name: String(member.name ?? ""),
      img: "icons/svg/mystery-man.svg",
      uuid: null,
      role: String(member.role ?? "").trim(),
      isDummy: true,
    }));
    const members = [...linkedMembers, ...dummyMembers].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    const characters = members.map((member) => ({
      ref: member.ref,
      name: member.name,
      selected: member.ref === system.leaderUuid || member.id === system.leaderUuid,
      selectedSeatHolder: member.ref === system.highCouncilSeatHolder,
    }));
    const membersByRef = new Map(members.map((member) => [member.ref, member]));
    const succession = (system.successionOrder ?? [])
      .map((ref) => membersByRef.get(ref))
      .filter(Boolean);

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
      succession,
      hasUnscheduledMembers: members.some(
        (member) => !(system.successionOrder ?? []).includes(member.ref),
      ),
      unscheduledMembers: members.filter(
        (member) => !(system.successionOrder ?? []).includes(member.ref),
      ),
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

    this._applyPalette();

    if (!this._houseDragDrop) {
      this._houseDragDrop = new foundry.applications.ux.DragDrop({
        dragSelector: ".house-item-row",
        dropSelector: ".house-sheet",
        permissions: {
          dragstart: () => this.actor.isOwner,
          drop: () => this.actor.isOwner,
        },
        callbacks: {
          dragstart: this._onDragStart.bind(this),
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

  static async _onAddMember() {
    await this._editDummyMember();
  }

  static async _onEditDummyMember(_event, target) {
    const memberId = String(target.dataset.memberId ?? "");
    const member = (this.actor.system?.dummyMembers ?? []).find(
      (entry) => entry.id === memberId,
    );
    if (!member) return;
    await this._editDummyMember(member);
  }

  async _editDummyMember(existing = null) {
    if (!this.actor.isOwner) {
      _warnHouseEditPermission();
      return;
    }
    const title = existing
      ? t("sta-officers-log.house.editMemberTitle") || "Edit House Member"
      : t("sta-officers-log.house.addMemberTitle") || "Add House Member";
    const result = await foundry.applications.api.DialogV2.wait({
      classes: ["sta-officers-log"],
      window: { title },
      content: `<form>
        <div class="form-group">
          <label>${t("sta-officers-log.house.memberName") || "Name"}</label>
          <input name="memberName" type="text" value="${foundry.utils.escapeHTML(existing?.name ?? "")}" required autofocus />
        </div>
        <div class="form-group">
          <label>${t("sta-officers-log.house.role") || "House Role"}</label>
          <input name="memberRole" type="text" value="${foundry.utils.escapeHTML(existing?.role ?? "")}" />
        </div>
      </form>`,
      buttons: [
        {
          action: "save",
          label: t("sta-officers-log.house.saveMember") || "Save",
          default: true,
          callback: (_event, _button, dialog) => ({
            name: String(dialog.element.querySelector('[name="memberName"]')?.value ?? "").trim(),
            role: String(dialog.element.querySelector('[name="memberRole"]')?.value ?? "").trim(),
          }),
        },
        {
          action: "cancel",
          label: t("sta-officers-log.house.cancelMember") || "Cancel",
        },
      ],
      close: () => null,
    });
    if (!result) return;
    if (!result.name) {
      ui.notifications?.warn?.(
        t("sta-officers-log.house.memberNameRequired") ||
          "A House member name is required.",
      );
      return;
    }

    const members = [...(this.actor.system?.dummyMembers ?? [])];
    if (existing) {
      const index = members.findIndex((entry) => entry.id === existing.id);
      if (index < 0) return;
      members[index] = { ...members[index], ...result };
    } else {
      members.push({ id: foundry.utils.randomID(), ...result });
    }
    if (!(await _updateHouse(this, { "system.dummyMembers": members }))) return;
    this.render(true);
  }

  static async _onRemoveDummyMember(_event, target) {
    if (!this.actor.isOwner) {
      _warnHouseEditPermission();
      return;
    }
    const memberId = String(target.dataset.memberId ?? "");
    const member = (this.actor.system?.dummyMembers ?? []).find(
      (entry) => entry.id === memberId,
    );
    if (!member) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: {
        title: t("sta-officers-log.house.removeMemberTitle") || "Remove House Member",
      },
      content: `<p>${t("sta-officers-log.house.removeMemberConfirm") || "Remove"} ${foundry.utils.escapeHTML(member.name)}?</p>`,
    });
    if (!confirmed) return;
    const ref = `dummy:${memberId}`;
    const update = {
      "system.dummyMembers": (this.actor.system?.dummyMembers ?? []).filter(
        (entry) => entry.id !== memberId,
      ),
      "system.successionOrder": (this.actor.system?.successionOrder ?? []).filter(
        (entry) => entry !== ref,
      ),
    };
    if (this.actor.system?.leaderUuid === ref) update["system.leaderUuid"] = null;
    if (this.actor.system?.highCouncilSeatHolder === ref)
      update["system.highCouncilSeatHolder"] = null;
    if (!(await _updateHouse(this, update))) return;
    this.render(true);
  }

  static async _onCreateMemberActor(_event, target) {
    if (!this.actor.isOwner) {
      _warnHouseEditPermission();
      return;
    }
    const memberId = String(target.dataset.memberId ?? "");
    const member = (this.actor.system?.dummyMembers ?? []).find(
      (entry) => entry.id === memberId,
    );
    if (!member) return;
    let inFlight = creatingMemberActors.get(this);
    if (!inFlight) {
      inFlight = new Set();
      creatingMemberActors.set(this, inFlight);
    }
    if (inFlight.has(memberId)) {
      ui.notifications?.info?.(
        t("sta-officers-log.house.memberCreateInProgress") ||
          "A character is already being created from this House member.",
      );
      return;
    }
    inFlight.add(memberId);
    let createdActor = null;
    try {
      createdActor = await Actor.create({
        name: member.name,
        type: "character",
        ownership: {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
          [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
        },
        system: {
          showklingon: true,
          houseActorUuid: this.actor.uuid,
          houseRole: member.role ?? "",
          house: this.actor.name,
        },
      });
      if (!createdActor) {
        throw new Error("Actor.create returned no character document.");
      }

      const dummyRef = `dummy:${memberId}`;
      const update = {
        "system.dummyMembers": (this.actor.system?.dummyMembers ?? []).filter(
          (entry) => entry.id !== memberId,
        ),
      };
      if (this.actor.system?.leaderUuid === dummyRef)
        update["system.leaderUuid"] = createdActor.uuid;
      if ((this.actor.system?.successionOrder ?? []).includes(dummyRef)) {
        update["system.successionOrder"] = this.actor.system.successionOrder.map(
          (ref) => (ref === dummyRef ? createdActor.uuid : ref),
        );
      }
      if (this.actor.system?.highCouncilSeatHolder === dummyRef)
        update["system.highCouncilSeatHolder"] = createdActor.uuid;
      await this.actor.update(update);
      this.render(true);
      await createdActor.sheet?.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | failed to create character from House member`, error);
      if (createdActor) {
        try {
          await createdActor.delete();
        } catch (rollbackError) {
          console.error(`${MODULE_ID} | failed to roll back created House member`, rollbackError);
          ui.notifications?.error?.(
            t("sta-officers-log.house.memberCreateRollbackFailed") ||
              "The character was created, but could not be linked or rolled back. The dummy member is still listed.",
          );
          this.render(true);
          return;
        }
      }
      ui.notifications?.error?.(
        t("sta-officers-log.house.memberCreateFailed") ||
          "Could not create and link a character from this House member.",
      );
    } finally {
      inFlight.delete(memberId);
    }
  }

  static async _onAddToSuccession(_event, target) {
    if (!this.actor.isOwner) {
      _warnHouseEditPermission();
      return;
    }
    const ref = String(
      target.dataset.memberRef ??
        target.closest(".house-succession-add")?.querySelector(
          ".house-succession-select",
        )?.value ??
        "",
    );
    const order = [...(this.actor.system?.successionOrder ?? [])];
    if (!ref || order.includes(ref)) return;
    if (
      !(await _updateHouse(this, {
        "system.successionOrder": [...order, ref],
      }))
    )
      return;
    this.render(true);
  }

  static async _onMoveSuccession(_event, target) {
    if (!this.actor.isOwner) {
      _warnHouseEditPermission();
      return;
    }
    const ref = String(target.dataset.memberRef ?? "");
    const order = [...(this.actor.system?.successionOrder ?? [])];
    const index = order.indexOf(ref);
    const direction = target.dataset.direction === "up" ? -1 : 1;
    const next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    if (!(await _updateHouse(this, { "system.successionOrder": order })))
      return;
    this.render(true);
  }

  static async _onRemoveFromSuccession(_event, target) {
    if (!this.actor.isOwner) {
      _warnHouseEditPermission();
      return;
    }
    const ref = String(target.dataset.memberRef ?? "");
    if (
      !(await _updateHouse(this, {
        "system.successionOrder": (
          this.actor.system?.successionOrder ?? []
        ).filter((entry) => entry !== ref),
      }))
    )
      return;
    this.render(true);
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

  _onDragStart(event) {
    const row = event.currentTarget?.closest?.("[data-item-id]");
    const itemId = row?.dataset.itemId;
    const item = itemId && this.actor.items.get(itemId);
    if (!item || !this.actor.isOwner) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify(item.toDragData()),
    );
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

  // Delegate to the STA system's own palette dialog/application so House
  // sheets stay in lockstep with whatever picker STA ships (new presets,
  // the custom 5-color picker introduced in STA 2.8.2, etc). Both methods
  // only touch `this.document`/`this.element`, so calling them against a
  // House sheet instance works even though House isn't an STAActors sheet.
  async _onColourPalette(event, target) {
    const staCls = _getStaActorsClass();
    const impl = staCls?.prototype?._onColourPalette ?? STAActors.prototype._onColourPalette;
    return impl.call(this, event, target);
  }

  _applyPalette() {
    const staCls = _getStaActorsClass();
    const impl = staCls?.prototype?._applyPalette ?? STAActors.prototype._applyPalette;
    impl.call(this);
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
