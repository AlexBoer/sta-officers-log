# STA Officers Log

Tools for character development in _Star Trek Adventures_ for Foundry VTT.

- Players have a new button on their values, "Use Value", which does the following:
  - Marks the current log item with the value's use.
  - checks to see if a callback is possible and prompts the player to make the callback (not not)
  - adjusts determination automatically, and links logs to the one they callback to.
  - supports setting a value to be a "Trauma" and handles stress tracking from trauma usage automatically. 
- The GM can start a new mission, which resets Determination and Stress on all character. Then, it creates log items on all main characters withe the mission's name.
- Sorts and organizes logs by name, date, or into "chain-order" to visualize character arcs.
- Adds support for Scars in te 23rd Century Campaign guide.
- Adds support for mission directive to log items.
- UI based milestone/arc benefit picker. Level up right in the VTT! Supports using focus and talent items from the compendium and checks for requirements.

## Requirements

- Foundry VTT v13
- Star Trek Adventures system (https://github.com/mkscho63/sta)
- SocketLib (https://github.com/farling42/foundryvtt-socketlib)

## Installation

- Currently not on the Public Foundry page yet.
- **Manifest URL (for manual install):**
  `https://github.com/AlexBoer/sta-officers-log/releases/latest/download/module.json`

After installation, enable **STA Officers Log** in your world’s **Manage Modules**.
