# 着せ替え (dressing room)

Local viewer for Oathless characters: race and sex, face, hair, equipment on the body, motions, and the
status / skill simulator / buff panels.

Run it from the MMO Build folder:

```
node viewer/serve.cjs 8790
```

Then open http://localhost:8790/ (this PC only).

What it needs besides this folder (kept on the development PC, not in this repo):

- `MMO Build/extracted/` for the models, texture sheets and motions
- `MMO Build/UE/ServerData/` for items.json, techniques.json and technique-opcodes.json
- `MMO Build/UE/DemoData/technic.json` for the weapon class to skill table
- `MMO Build/rules-profile/reference.cjs` and `C:\Claude Docs\our-game` (rules, gear, active effects, game-data.json):
  the status panels run the game server's own stat code (`status-engine.cjs`), so they show the game's numbers

Data files in `data/` are written by `build_data.py`.
