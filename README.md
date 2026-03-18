# STA Officers Log

**STA Officers Log** is a Foundry VTT module for the _Star Trek Adventures_ tabletop RPG system. It automates character advancement, including callbacks, milestones and arcs, and reputation rolls.

---

## Table of Contents

1. [Requirements & Installation](#requirements--installation)
2. [Mission Management](#1-mission-management)
3. [Using Values](#2-using-values)
4. [The Callback Flow](#3-the-callback-flow)
5. [Mission Logs](#4-mission-logs)
6. [Milestones & Benefits](#5-milestones--benefits)
7. [Arcs](#6-arcs)
8. [Reputation & Acclaim](#7-reputation--acclaim)
9. [Trauma Rules _(optional)_](#8-trauma-rules-optional)
10. [Scar Rules _(optional)_](#9-scar-rules-optional)
11. [Supporting Characters](#10-supporting-characters)
12. [Ship Benefits](#11-ship-benefits)
13. [Directives](#12-directives)
14. [Macros & GM Tools](#13-macros--gm-tools)
15. [Settings Reference](#14-settings-reference)

---

## Requirements & Installation

**Requirements:**
- Foundry VTT v13+
- [Star Trek Adventures system](https://github.com/mkscho63/sta)
- [SocketLib](https://github.com/farling42/foundryvtt-socketlib)

**Installation:**

> Currently not listed on the public Foundry module browser.

Install manually using the Manifest URL in Foundry's **Manage Modules → Install Module**:

```
https://github.com/AlexBoer/sta-officers-log/releases/latest/download/module.json
```

After installation, enable **STA Officers Log** in your world's **Manage Modules**.

---

## 1. Mission Management
_GM feature._

The GM controls the mission lifecycle from the **STA Tracker** panel. Starting a new mission:

- Resets Determination, Stress, and Ship Readiness for all characters.
- Creates a fresh **Mission Log** item on each participating character's sheet.
- Resets all callback eligibility, trauma use counts, and scar used-states.
<img width="259" height="141" alt="image" src="https://github.com/user-attachments/assets/6ba2a060-5354-4092-8b9c-0210a72da7ab" />
<img width="583" height="1013" alt="image" src="https://github.com/user-attachments/assets/adcdb61e-cfbe-44d4-8f72-389029834f8b" />


### Adding Participants

Use the **Add Participant** macro to add a character to the current mission. A mission log is automatically created for them.

### Mission Settings

| Setting | Description |
|---|---|
| **Reset Callbacks** | Allow characters to make a new callback this mission. If false, characters will save their callback status from the previous mission. |
| **Reset Determination** | Sets each character's Determination to 1. |
| **Reset Stress** | Sets each character's Determination to 0 |
| **Reset Ships** | Set's Reserve Power to TRUE, Shields to max, and Shaken to FALSE |
| **Reset Scars** | Allows characters to use their scars once per mission. If false, characters will save their scar usage status from the previous mission. |
| **Reset Momentum** | Sets momentum to 0 |
| **Reset Threat** | Sets Threat to 2 x Player Count |
| **Create New Mission Logs** | Adds a mission to each participating character, and marks it as the current mission. |
---

## 2. Using Values
_Player feature._

Each Value on a character sheet has a **Use Value** button added by this module. Clicking it opens a dialog where the player selects how they are using the Value this scene.

| Use Type | Effect |
|---|---|
| **Positive** | Spends 1 Determination (if available); marks the current mission log. |
| **Negative** | Gains 1 Determination; marks the log; triggers the callback prompt. |
| **Challenge** | Marks the value as Challenged; triggers the callback prompt. |

The dialog also lets players select a **Directive** instead of a Value (see [Directives](#12-directives)).

> **Screenshot placeholder** — Use Value dialog on the character sheet

### Challenged Values

Once a Value has been challenged via the dialog, the Challenged toggle becomes visible on the sheet. The **Hide Challenged Toggle** client setting (on by default) keeps things clean until that point.

---

## 3. The Callback Flow

_Player initiates; GM approves._

A **callback** is when a player references a past use of one of their Values to earn Determination. This module automates the entire process.

**How it works:**

1. A player uses a Value negatively or challenges it.
2. The module checks their logs for previous uses of the same Value.
3. If eligible sources exist, a **Callback Request** dialog opens on the player's screen listing those previous logs.
4. The player selects the source log they are calling back to (or declines).
5. The callback link is recorded on the new log, and the player gains 1 Determination.

> **Screenshot placeholder** — Callback Request dialog showing available source logs

**Eligibility rules:**
- A log can only be the target of one callback per mission.
- Logs already at the end of a completed arc chain count differently.

**GM-initiated callbacks:** The GM can also manually trigger a callback prompt for any online player from the STA Tracker.

---

## 4. Mission Logs

_Visible on all character sheets._

Every time a Value (or Directive) is used, a **Log** item is automatically created on the character tracking that mission's events. Logs are the building blocks for arc detection and milestone selection.

> **Screenshot placeholder** — Logs section on a character sheet

### Sorting Logs

Click the **Sort** button in the Logs section header to cycle through four modes:

| Mode | Description |
|---|---|
| **Date** | Creation order (default). |
| **Alphabetical** | Sorted A→Z by value name. |
| **Chain** | Sorted by callback chain depth — great for visualising arc progress. |
| **Custom** | Drag-to-reorder manually. |

Your preference is saved per character.

### Hiding Unused Logs

The **eye icon** in the Logs header hides logs that have no Value invoked yet. The current mission log is never hidden.

### Callback Source Highlighting

Each log with a callback link shows a small icon button. Clicking it briefly highlights the previous log it links back to, letting you trace a chain at a glance.

### Resizing Sections

Drag the divider between the Logs and Milestones sections to resize them. Your preference is saved per character per client.

---

## 5. Milestones & Benefits

_Player feature._

When a mission ends, the **Choose Milestone** button activates on the character's current mission log. Clicking it opens a benefit selection dialog.

> **Screenshot placeholder** — Milestone benefit selection dialog

**Normal Milestone benefits** include:
- Swap or gain a **Focus**
- Swap or gain a **Talent**
- Adjust an **Attribute** or **Discipline**
- Gain **Determination**

**Arc Milestone benefits** (unlocked by completing an Arc — see [Arcs](#6-arcs)) include:
- Increase an Attribute or Discipline (not just a swap)
- Change a Value
- Other major advancements per the rulebook

Once selected, a **Milestone item** is created on the character sheet recording the choice.

### Talent & Focus Pickers

The benefit dialog includes search-and-select pickers for talents and focuses sourced from the official STA compendium packs. GMs can add custom compendium packs in the world settings.

---

## 6. Arcs

_Automatic detection._

Arcs are major character growth moments earned by building long callback chains. The module tracks this automatically.

**Requirements for an Arc:**
- A callback chain of at least **3 logs** for your first arc, **4 logs** for your second, **5** for your third, and so on.
- All logs in the chain must use the **same Value**.
- Logs already consumed by a previous arc cannot be reused.

When a log qualifies as the end of an arc chain, the **Choose Milestone** dialog automatically offers an **Arc Milestone** instead of a Normal Milestone, and displays the chain of logs that forms it.

> **Screenshot placeholder** — Arc detection shown in the milestone dialog

---

## 7. Reputation & Acclaim

_Player and GM feature._

This module replaces the default Reputation roll button with a richer **Acclaim Survey** system.

> **Screenshot placeholder** — Acclaim survey dialog

### Rolling Reputation

Instead of rolling immediately, the player is presented with a survey of yes/no questions drawn from the rulebook (and any custom questions the GM has defined). Their answers determine the number of **Positive** and **Negative Influences** before the roll.

- **Positive influence questions** (7 by default, based on the rulebook)
- **Negative influence questions** (10 by default, based on the rulebook)

GMs can customise both lists in **Module Settings**.

### GM Survey Monitor

When the GM triggers **Survey All Players**, a monitor dialog opens showing the realtime answer status for every player (Waiting / Answering / Rolled).

> **Screenshot placeholder** — GM Survey Monitor

### Spending Acclaim & Reprimands

The **Spend Acclaim** and **Spend Reprimands** buttons open spend dialogs with pre-built options from the rulebook:

**Acclaim options include:** Pike Medal of Valor, Cochrane Medal of Excellence, Grankite Order of Tactics, Commend Another, Elevation, Gain Favor, Promotion, and more.

**Reprimand options include:** Court-Martial, Demotion, Detention, Stripped of Award, and more.

GMs can add **custom awards** and **custom spend options** in Module Settings using the format `Name | Cost | Description`.

---

## 8. Trauma Rules _(optional)_

_Requires **Enable Trauma Rules** to be turned on in Module Settings._

From the _23rd Century Campaign Guide_, Trauma is an optional rule for values that have turned against a character.

### Marking a Value as Trauma

On any Value item sheet, tick the **Trauma** checkbox. The Value will be visually labelled on the character sheet.

### Using a Trauma Value

Each positive use of a Trauma Value inflicts stress equal to the cumulative use count during this mission:
- 1st use → 1 Stress
- 2nd use → 2 Stress
- 3rd use → 3 Stress
- …and so on

All use counts reset when a new mission begins.

> **Screenshot placeholder** — Trauma value on the character sheet

---

## 9. Scar Rules _(optional)_

_Requires **Enable Scar Rules** to be turned on in Module Settings._

Also from the _23rd Century Campaign Guide_, Scars are Traits with mechanical consequences.

### Marking a Trait as a Scar

On a Trait item sheet, tick the **Scar** checkbox.

### Using a Scar

A **Use Scar** button appears on Scar traits. Using it follows the same approval flow as using a Value — the GM is notified and the use is logged. Scars reset to "unused" at the start of each new mission.

---

## 10. Supporting Characters

_GM feature._

The **Development** tab on supporting character sheets lets the GM advance supporting characters between missions.

Available improvements:
- Increase an **Attribute** (up to max 12)
- Increase a **Discipline** (up to max 5)
- Add a **Focus** (up to 6 total)
- Add a **Talent** (up to 4 total)

Buttons disable automatically when their cap is reached.

---

## 11. Ship Benefits

_GM feature._

When players without Owner permission on the group ship earn ship-related milestone benefits, those benefits are **queued** rather than applied immediately.

The GM can review and process queued benefits from the **Review Ship Benefits** button in the STA Tracker. A notification also appears if benefits are waiting.

> **Screenshot placeholder** — Pending Ship Benefits dialog

---

## 12. Directives

_Player and GM feature._

Mission Directives (like the Prime Directive) can be configured by the GM in **Module Settings → Mission Directives**.

On the character sheet, a **Use Directive** button lets players invoke the active directives similarly to Values. Directive uses are recorded on the current mission log.

Directives also appear as options inside the Use Value dialog.

---

## 13. Macros & GM Tools

The module includes a **STA Officers Log Macros** compendium pack with ready-to-use macros:

| Macro | Description |
|---|---|
| **New Scene** | Decrements Momentum and refreshes NPC Personal Threat. |
| **Open Group Ship** | Opens the configured group ship actor sheet. |
| **Label Values** | Renumbers Value icons (V1–V8) based on current sort order. |

All key GM functions are also accessible from the **STA Tracker** panel without needing macros.

### Experimental: Mission Log Flowchart

Enable **"[Experimental] Enable Mission Log Flowchart"** in client settings to add a **Flowchart** button to the Logs section. This renders your callback chains as an interactive diagram.

> **Screenshot placeholder** — Mission Log Flowchart view

---

## 14. Settings Reference

### World Settings _(GM only)_

| Setting | Description |
|---|---|
| Enable Trauma Rules | Enable optional Trauma Value mechanics. |
| Enable Scar Rules | Enable optional Scar Trait mechanics. |
| Group Ship | Actor ID of the party's shared starship. |
| Auto-prompt on Determination Roll | Trigger callback prompts when Determination is rolled in chat. |
| Mission Directives | List of active directives for the current mission. |
| Reputation Survey Enabled | Use the survey flow for reputation rolls instead of rolling directly. |
| Positive Influence Questions | Customise the yes/no survey questions for positive influences. |
| Negative Influence Questions | Customise the yes/no survey questions for negative influences. |
| Custom Awards | Custom award items for the Acclaim spend dialog. |
| Custom Acclaim Spend | Custom spend options for Acclaim. |
| Custom Reprimand Spend | Custom spend options for Reprimands. |
| Talent Picker: Custom Compendium | Comma-separated pack IDs to add to the talent picker. |
| Talent Picker: Filter by Folder | Enable if your custom talent pack uses Crew/Starship folder structure. |
| Focus Picker: Custom Compendium | Comma-separated pack IDs to add to the focus picker. |

### Client Settings _(per user)_

| Setting | Description | Default |
|---|---|---|
| Enable Sheet Enhancements | Master toggle for all Officers Log UI additions. | On |
| Hide Challenged Value Toggle | Hide the Chal? checkbox until a value is challenged. | On |
| Show 'Used' Toggle on Logs | Show the manual Used toggle on log items. | Off |
| Enable Flowchart View | Add the experimental Flowchart button to the Logs section. | Off |
