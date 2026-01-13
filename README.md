# STA Officers Log

Tools for character development and mission/callback workflow in _Star Trek Adventures_ for Foundry VTT.

## Requirements

- Foundry VTT v13
- STA system
- SocketLib

## What It Adds

- A GM-driven “callback request” flow (prompt a specific player to make a callback)
- Character sheet enhancements for logs/arcs (sorting, grouping, linking controls)
- Buttons for the GM to start a new mission, or a new scene. New missions create logs for selected players to enable automatic log notekeeping.
- "+" Button for milestones now opens a dialog that will apply the benefit for you. Focus and talent benefits pull from the STA compendium.

## Settings

Most settings are exposed under **Module Settings → STA Officers Log**.

- **Enable Sheet Enhancements** (client): toggles injected STA sheet UI tweaks
- **Show Log Used Toggle** (client): Enable this setting to bring back to "used" toggle on log in the character sheet. By default, it is now hidden to prevent users from accidentally breaking log-chains.

## Notes

- The CSS in `styles/sta-style-enhance.css` is now scoped to `body.system-sta` to reduce unintended style bleed into non-STA worlds.
