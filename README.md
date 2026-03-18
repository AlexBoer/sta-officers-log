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

The GM can start a new mission, which manages many of the new features in this module. This also automated much of the bookkeeping associated with started a new mission.

<img width="259" height="141" alt="image" src="https://github.com/user-attachments/assets/6ba2a060-5354-4092-8b9c-0210a72da7ab" />
<img width="333" height="507" alt="image" src="https://github.com/user-attachments/assets/adcdb61e-cfbe-44d4-8f72-389029834f8b" />

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

Each Value on a character sheet has a **Use Value** button added to it. Clicking it opens a dialog where the player selects how they are using the Value this scene.

<img width="646" height="184" alt="image" src="https://github.com/user-attachments/assets/1f1766f3-fdbd-4cd7-9f7c-67409072af3b" />


| Use Type | Effect |
|---|---|
| **Positive** | Spends 1 Determination |
| **Negative** | Gains 1 Determination |
| **Challenge** | Gains 1 Determination |

In all cases, the value is marked as used on the current mission log.

<img width="926" height="377" alt="image" src="https://github.com/user-attachments/assets/83629aab-7d1e-4c50-88c7-4f74aa8e89bd" />


### Challenged Values

The Challenged Toggle is hidden by default to prevent players from using it inccorectly. Once a Value has been challenged via the "Use Value" button, the Challenged toggle becomes visible to allow players to reset it after rewriting the value.

<img width="649" height="116" alt="image" src="https://github.com/user-attachments/assets/bb1f83eb-9f3e-47f0-9408-e4a0c1b91db4" />

---

## 3. Making Callbacks

Callbacks are automated, including recording value usage and checking for if a MIelstone has been earned.

**How it works:**

1. A player uses a Value.
2. The module checks their logs for previous uses of the same Value.
3. If eligible sources exist, a **Callback Request** dialog opens on the player's screen listing those previous logs.
4. The player selects the log they are calling back to (or declines).
5. The current mission log has a new property that remembers which log it called back to.
6. 1 Determination is added to the character (max 3)

Each character can only make 1 callback per mission.

<img width="554" height="350" alt="image" src="https://github.com/user-attachments/assets/336fe86f-d91a-49f6-9504-160e9afffda4" />

**Eligibility rules:**
- A log can only be the target of one callback.
- Making a callback sets a property called 'Primary Value" to the used value. Once a mission log has a Primary value, it can ONLY be called back to using that value. This prevents players from breaking a chain of missions with a different value and accidentally preventing them from earning an Arc.

**GM-initiated callbacks:** The GM can also manually trigger a callback prompt for any online player using a button on the STA Momentum Tracker.

---

### Sorting Logs

Click the **Sort** button in the Logs section header to cycle through four modes:

| Mode | Description |
|---|---|
| **Date** | Creation order (default). |
| **Alphabetical** | Sorted A→Z by Log name. |
| **Chain** | Sorted by callback chain depth to visualize arc-chains. |
| **Custom** | Drag-to-reorder manually. This is the default from the STA system. |

<img width="652" height="111" alt="image" src="https://github.com/user-attachments/assets/9863a5e9-d441-419d-8a98-927257558eb5" />

### Hiding Unused Logs

The **eye icon** in the Logs header hides logs that have no Value invoked yet. This let's players keep session notes in their mission log items, but can still filter to just the logs that contribute towards character advancement. The current mission log is never hidden.

### Callback Source Highlighting

Each log with a callback link shows a small icon button. Clicking it briefly highlights the previous log it links back to, letting you trace a chain at a glance.

### Resizing Sections

Drag the divider between the Logs and Milestones sections to resize them.

---

## 4. Milestones & Arcs

When a mission ends, the **Choose Milestone** button activates on the character's current mission log. Clicking it opens a benefit selection dialog.

<img width="744" height="410" alt="image" src="https://github.com/user-attachments/assets/bad85b17-9d8c-4b64-886f-e5ced3999448" />

Choosing an option from this dialog will automatically revise the character sheet. When players without Owner permission on the group ship chooses ship-related milestone benefits, those benefits are **queued** rather than applied immediately. The GM will be prompted to apply those benefits.

### Talent & Focus Pickers

The benefit dialog includes search-and-select pickers for talents and focuses sourced from the STA compendium packs. GMs can add custom compendium packs in the world settings.

<img width="514" height="600" alt="image" src="https://github.com/user-attachments/assets/1787531b-5bb9-4491-86fc-b651f1029d02" />

---

## 5. Reputation & Acclaim

This module replaces the default Reputation roll button with a **Acclaim Survey**.

<img width="897" height="654" alt="image" src="https://github.com/user-attachments/assets/cb01447c-35bf-41a2-9d03-6855e50a8244" />


### Rolling Reputation

Instead of rolling immediately, the player is presented with a survey of yes/no questions. Their answers determine the number of **Positive** and **Negative Influences** before the roll.

### GM Survey Monitor

The macro "Monitor Reputation Surveys" allows the GM to see the players answers updated in the survey in real time.

### Spending Acclaim & Reprimands

The **Spend Acclaim** and **Spend Reprimands** buttons open spend dialogs with pre-built options from the rulebook:

<img width="312" height="201" alt="image" src="https://github.com/user-attachments/assets/5c4971bb-7519-4268-992f-b93d32451b25" />

<img width="511" height="1132" alt="image" src="https://github.com/user-attachments/assets/9d93b3c8-5edc-46ee-be5d-e7b47d665a6a" />


---

## 6. Trauma Rules

When a value is marked as a Trauma, it will automate the stress gain and recovering from using it.

## 7. Scar Rules

On a Trait item sheet, tick the **Scar** checkbox. A **Use Scar** button appears on Scar traits. Pushing the buttons adds 1 Determination to the cahracter sheet after the GM gives approval. Scars reset to "unused" at the start of each new mission.

---

## 8. Supporting Character Advancement

The **Development** tab on supporting character sheets lets the GM advance supporting characters between missions. Buttons disable automatically when their cap is reached.

---

## 9. Directives

Mission Directives can be configured by the GM in **Module Settings → Mission Directives** or above the Momentum Tracker. The momentum tracker must be set to the bottom left in the STA system settings.

On the character sheet, a **Use Directive** button lets players invoke the active directives similarly to Values. Directive uses are recorded on the current mission log.

Directives also appear as options inside the Use Value dialog.

---

## 11. Macros & GM Tools

The module includes a **STA Officers Log Macros** compendium pack with ready-to-use macros:

| Macro | Description |
|---|---|
| **New Scene** | Decrements Momentum and refreshes NPC Personal Threat. |
| **Label Values** | Renumbers Value icons (V1–V8) based on current sort order. |
| **New Mission** | Starts a new mission |
| **Add New Player to Mission** | Select a player to add to the current mission. |
| **Reset Callbacks** | Allows players to make a new callback |
| **Send Reputation Roll** | Allows the GM to give the players a preset Reputation Roll result. |
| **Start Reputation Survey** | Opens the Reputation Survey for all players. |
| **Monitor Reputation Surveys** | Allows the GM to see what answers players are giving, to facilitate conversation. |

### Experimental: Mission Log Flowchart

Adds a button to characer sheets that opens a new window to visualize callback chains. Each mission log is a node, coloured with the values they used. Arrows show callbacks. Nodes that are a part of arcs are put in a box.

<img width="882" height="642" alt="image" src="https://github.com/user-attachments/assets/ce5c5a04-16b1-44e3-a3e3-f80a4f2eb0f2" />

---

## 12. Settings Reference

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
| Talent Picker: Filter by Folder | Enable if your custom talent pack uses Crew/Starship folder structure (true by default on the most recent release of the STA system) |
| Focus Picker: Custom Compendium | Comma-separated pack IDs to add to the focus picker. |

### Client Settings _(per user)_

| Setting | Description | Default |
|---|---|---|
| Enable Sheet Enhancements | Master toggle for all Officers Log UI additions. | On |
| Hide Challenged Value Toggle | Hide the Chal? checkbox until a value is challenged. | On |
| Show 'Used' Toggle on Logs | Show the manual Used toggle on log items. | Off |
| Enable Flowchart View | Add the experimental Flowchart button to the Logs section. | Off |
