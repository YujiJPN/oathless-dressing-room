"""Build the dressing-room viewer's data files from the decoded tables.

  python viewer/build_data.py      ->  viewer/data/items.json, appearance.json, races.json, icons.json

items.json       every item that has an appearance row: id, names, kind, slot, row, icon id
appearance.json  per race/sex block, per row: piece glb, sheet png(s), category code, effect file, extra part
races.json       block labels, default face/hair/body rows, starter items, the race base body, the race's motion set
                 (tables/motion-sets.csv + action-labels.csv); the "select" clips of tables/player-motion-tables.csv are
                 7-frame face-expression morphs, so none of them exports as a body clip
icons.json       icon-sheet order (tables/icon-sheets.json) and the png of every icon sheet
"""
import collections
import csv
import glob
import json
import os

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
T = os.path.join(ROOT, "tables")
ft = json.load(open(os.path.join(T, "file-table.json")))
by_path = {r["path"]: r for r in ft}
by_recno = {r["recno"]: r for r in ft}

models = {}
for f in glob.glob(os.path.join(ROOT, "extracted", "models", "catalog-part*.csv")):
    for r in csv.DictReader(open(f, encoding="utf-8")):
        if r["group"] != "ERROR" and r["glb"] and "/" in r["glb"]:
            models[int(r["recno"])] = r["glb"]
anims = {}
for f in glob.glob(os.path.join(ROOT, "extracted", "anims", "catalog-part*.csv")):
    for r in csv.DictReader(open(f, encoding="utf-8")):
        if r["glb"] and not r["glb"].startswith('"') and r["group"] not in ("ERROR", "NONE", ""):
            anims[int(r["recno"])] = r["glb"]
sheet_png = {}
for f in glob.glob(os.path.join(ROOT, "extracted", "sheets", "catalog-part*.csv")):
    for r in csv.DictReader(open(f, encoding="utf-8")):
        if r["surface"] == "0" and r["png"]:
            sheet_png[int(r["recno"])] = r["png"]


def glb_of(path):
    r = by_path.get(path)
    return models.get(r["recno"]) if r else None


def png_of(path, surface=0):
    r = by_path.get(path)
    if not r:
        return None
    rel = path[5:].replace("\\", "/")
    p = f"{rel[0]}/{r['recno']:05d}_{rel[2:-4]}_{surface}.png"
    return p if os.path.exists(os.path.join(ROOT, "extracted", "sheets", p)) else None


def surfaces_of(path):
    """Every decoded surface of a sheet (multi-surface sheets are the texture stages an effect animates)."""
    out = []
    for i in range(16):
        p = png_of(path, i)
        if not p:
            break
        out.append(p)
    return out


def ref(v, kinds):
    r = by_recno.get(v) if isinstance(v, int) else None
    return r if r and r["type"] in kinds else None


# the model's own slot byte (NMD header +0x0e, tables/nmd-slots.csv): the client replaces the base body's meshes of
# that slot when the piece is worn (the row's +4 code is a category, not the same numbering)
mesh_slot = {}
ns = os.path.join(T, "nmd-slots.csv")
if os.path.exists(ns):
    for r in csv.DictReader(open(ns, encoding="utf-8")):
        mesh_slot[int(r["recno"])] = int(r["mesh_slot"])

# the sheet surface a model draws with (tools/scan_nmd_surfaces.cjs -> tables/nmd-surfaces.csv): a multi-surface sheet is
# shared by several models, each naming its surface in its subsets (Merchant Ware draws with surface 2 of its four).
# Models that mix surfaces carry one primitive per surface instead (material "...|surface<N>" in the glb).
mesh_surface = {}
nsf = os.path.join(T, "nmd-surfaces.csv")
if os.path.exists(nsf):
    for r in csv.DictReader(open(nsf, encoding="utf-8")):
        s = r["surfaces"].split()
        if len(s) == 1 and s[0].isdigit() and int(s[0]) > 0:
            mesh_surface[int(r["recno"])] = int(s[0])

appearance = {}
for r in json.load(open(os.path.join(T, "appearance-table.json"))):
    # +8 is the only model reference in a row; a row without one has no model for that race/sex (the item is locked to
    # the other sex, or is an NPC costume made for one race). Field +0 is just the row's own index, not a file.
    mesh = r["alt_mesh"]
    g = glb_of(mesh) if mesh else None
    if not g:
        continue
    e = {"g": g, "c": r["slot"]}
    mr = by_path.get(mesh)
    if mr and mr["recno"] in mesh_slot:
        e["m"] = mesh_slot[mr["recno"]]
    if mr and mr["recno"] in mesh_surface:
        e["sf"] = mesh_surface[mr["recno"]]
    if r["texture"] and png_of(r["texture"]):
        e["t"] = png_of(r["texture"])
        more = surfaces_of(r["texture"])
        if len(more) > 1:
            e["ts"] = more
    if r["texture2"] and png_of(r["texture2"]):
        e["t2"] = png_of(r["texture2"])
    tail = r.get("tail") or []
    if tail:
        nta = ref(tail[0], ("NTA",))
        if nta:
            e["fx"] = nta["path"][5:]
        xm = ref(tail[6], ("NMD",))
        if xm and glb_of(xm["path"]):
            e["x"] = {"g": glb_of(xm["path"])}
            xs = ref(tail[7], ("NSD",))
            if xs and png_of(xs["path"]):
                e["x"]["t"] = png_of(xs["path"])
    appearance.setdefault(str(r["block"]), {})[str(r["row"])] = e

icon_id = {}
for r in csv.DictReader(open(os.path.join(T, "item-master.csv"), encoding="utf-8")):
    icon_id[int(r["id"])] = int(r["f14"], 16)

# the item's material id (weapon +0xd0, shield +0xbc, clothing +0xb0) is the record number of an NMT file: the D3D material
# the piece is lit with (copper 1512, gold 1517, silver 1516 ...). The viewer multiplies the sheet by diffuse + ambient/2,
# relative to the default material 1511 (grey 0.5), so an untinted piece stays as it is.
nmt = {}
nm = os.path.join(T, "nmt-materials.csv")
if os.path.exists(nm):
    for r in csv.DictReader(open(nm, encoding="utf-8")):
        d = [float(r["diffuse_" + c]) + 0.5 * float(r["ambient_" + c]) for c in "rgb"]
        nmt[int(r["recno"])] = d
base_mat = nmt.get(1511, [0.695, 0.695, 0.695])


def tint_of(mid):
    try:
        mid = int(mid)
    except (TypeError, ValueError):
        return None
    if mid not in nmt or mid == 1511:
        return None
    t = [nmt[mid][i] / base_mat[i] for i in range(3)]
    s = min(1.0, 1.4 / max(t))   # cap the brightness without losing the hue (silver stays white, not yellow)
    return [round(v * s, 3) for v in t]

items = []
starter = {}
held_count = 0
for r in csv.DictReader(open(os.path.join(T, "item-appearance.csv"), encoding="utf-8")):
    slot = r["slot"] or r["kind"]
    it = {"id": int(r["id"]), "n": r["name"], "e": r["name_en"], "k": r["kind"], "s": slot}
    if r["appearance_row"]:
        it["r"] = int(r["appearance_row"])
    elif r.get("held_mesh"):
        # weapons and shields: a rigid prop from the held-item table, hung on the dummy with attach code "a"
        g = glb_of("data\\" + r["held_mesh"])
        if not g:
            continue
        h = {"g": g, "a": int(r["attach"] or 0), "s": float(r["scale"] or 1), "t": r["held_text"]}
        hr = by_path.get("data\\" + r["held_mesh"])
        if hr and hr["recno"] in mesh_surface:
            h["sf"] = mesh_surface[hr["recno"]]
        if r["held_sheet"] and png_of("data\\" + r["held_sheet"]):
            h["t"] = png_of("data\\" + r["held_sheet"])
            more = surfaces_of("data\\" + r["held_sheet"])
            if len(more) > 1:
                h["ts"] = more
        else:
            h.pop("t")
        if r["held_sheet2"] and png_of("data\\" + r["held_sheet2"]):
            h["t2"] = png_of("data\\" + r["held_sheet2"])
        if r["held_nta"]:
            h["fx"] = r["held_nta"]
        h["label"] = r["held_text"]
        it["h"] = h
        held_count += 1
    else:
        continue
    if icon_id.get(it["id"]):
        it["i"] = icon_id[it["id"]]
    # the item's sex mask (visual record: bit 0 male, bit 1 female), kept only when it locks the item to one sex; the
    # viewer uses it to say why a row has no model for the current race/sex
    try:
        sx = int(r.get("sex_mask") or "0", 16) & 3
    except ValueError:
        sx = 0
    if sx in (1, 2):
        it["sx"] = sx
    tint = tint_of(r.get("material"))
    if tint:
        it["tint"] = tint
    items.append(it)
    if r["name_en"] in ("Cloth Shirt", "Cloth Pants", "Cloth Shoes", "Cloth Glove") and r["name_en"] not in starter:
        starter[r["name_en"]] = int(r["id"])

# race per block from the creature rows' height scale (0.84/0.90 Newter, 0.93/0.87 Cognite, 1.15/1.0 Pandemos, 0.57 Elmony)
# and the faces (blocks 2/3 slit eyes and long ears, 6/7 big eyes and round ears)
labels = {"0": "Newter male", "1": "Newter female", "2": "Cognite male", "3": "Cognite female",
          "6": "Elmony male", "7": "Elmony female", "4": "Pandemos male", "5": "Pandemos female"}
clips = {}
for r in csv.DictReader(open(os.path.join(T, "player-motion-tables.csv"), encoding="utf-8")):
    if r["phase"] != "0":
        continue
    g = anims.get(int(r["nma_recno"]))
    if g:
        clips.setdefault(r["appearance_block"], []).append({"label": f"select {r['action']}", "g": g})
# the client's motion sets (tables/motion-sets.csv: set x action id -> clip) with the action labels that the techniques
# give them (tables/action-labels.csv). Player sets from the player creature rows (tables/motion-set-usage.csv): Newter 1 (male)
# / 2 (female) — shared by the unreleased "Beast Blood" rows — Cognite ("Elf") 3/4, Pandemos ("Ogre") 5/6, Elmony ("Dwarf") 7/8.
MOTION_SET = {"0": 1, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6, "6": 7, "7": 8}
# every action id's name (tables/action-names.csv, tools/build_action_names.py: the client's state machine, the emotes,
# the weapon classes, the instruments, the techniques, and the clips classified by eye), grouped by kind in the viewer
labels_by_action = {}
lead_in = set()   # motion ids whose property flags carry 0x100000: the client starts them at frame 0 (the lead-in), then loops
an = os.path.join(T, "action-names.csv")
if os.path.exists(an):
    for r in csv.DictReader(open(an, encoding="utf-8")):
        labels_by_action[int(r["action"])] = (r["kind"] or "unnamed", r["name_en"], r["name_ja"])
        if int(r["flags"], 16) & 0x100000:
            lead_in.add(int(r["action"]))
else:
    for r in csv.DictReader(open(os.path.join(T, "action-labels.csv"), encoding="utf-8")):
        names = [n for n in (r["techniques_cast"], r["techniques_second"], r["techniques_third"]) if n]
        labels_by_action[int(r["action"])] = (r["range"], names[0].split("; ")[0] + (" …" if "; " in names[0] else "") if names else "", "")
motions = collections.defaultdict(list)
ms = os.path.join(T, "motion-sets.csv")
if os.path.exists(ms):
    for r in csv.DictReader(open(ms, encoding="utf-8")):
        if r["clip_glb"]:
            a = int(r["action"])
            kind, name, ja = labels_by_action.get(a, ("unnamed", "", ""))
            # the record's window (FUN_005b5eb0): low 16 = start (and loop start), high 16 = end; a motion flagged
            # 0x100000 starts at frame 0 instead and loops start..end after the lead-in (sit down 15, crouch 46)
            m = {"a": a, "g": r["clip_glb"], "f": int(r["frames"] or 0), "l": int(r["flags"] or 0), "n": name, "j": ja, "r": kind}
            if a in lead_in:
                m["z"] = 1
            motions[int(r["set"])].append(m)
actions = []   # kept for older pages; the per-race list below replaces it
# the race base bodies (tables/base-models.csv, tools/export_base_models.cjs): the NPC composite model the client dresses
# every player on. One mesh per slot (1 face, 7 hair, 2 chest, 3 legs, 6 hands, 8 feet, 90 eyes), each textured with one
# surface of the row's multi-surface sheet; a worn piece hides the base mesh of its slot, the eyes stay.
base = {}
bm = os.path.join(T, "base-models.csv")
if os.path.exists(bm):
    for r in csv.DictReader(open(bm, encoding="utf-8")):
        surfaces = {}
        for m in r["meshes"].split():
            slot, surface, _ = m.split(":")
            p = png_of("data\\" + r["nsd_path"], int(surface))
            if p:
                surfaces[surface] = p
        base[r["block"]] = {"g": r["glb"], "s": surfaces, "sheet": int(r["nsd_recno"]), "model": int(r["nmd_recno"]),
                            "slots": {m.split(":")[0]: int(m.split(":")[1]) for m in r["meshes"].split()}}
# no stand-in body row any more: the bare body is the race base body
races = {b: {"label": labels.get(b, f"block {b}"), "face": 0, "hair": 11 if b == "1" else 8,
             "body": None, "base": base.get(b), "clips": clips.get(b, []),
             "set": MOTION_SET.get(b), "actions": motions.get(MOTION_SET.get(b), [])} for b in sorted(appearance)}
icons = json.load(open(os.path.join(T, "icon-sheets.json")))
icon_data = {"order": icons["order"], "png": {str(s): sheet_png[s] for s in icons["order"] if s in sheet_png}}
os.makedirs(os.path.join(ROOT, "viewer", "data"), exist_ok=True)
json.dump(items, open(os.path.join(ROOT, "viewer", "data", "items.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(appearance, open(os.path.join(ROOT, "viewer", "data", "appearance.json"), "w", encoding="utf-8"), separators=(",", ":"))
json.dump({"races": races, "starter": starter, "actions": actions}, open(os.path.join(ROOT, "viewer", "data", "races.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
json.dump(icon_data, open(os.path.join(ROOT, "viewer", "data", "icons.json"), "w", encoding="utf-8"), separators=(",", ":"))
print(f"items {len(items)} ({sum(1 for i in items if 'i' in i)} with icons, {held_count} held props), appearance rows {sum(len(v) for v in appearance.values())} in {len(appearance)} blocks, "
      f"starter {starter}, select clips { {b: len(c) for b, c in clips.items()} }, motion-set actions { {b: len(r['actions']) for b, r in races.items()} }, icon sheets {len(icon_data['png'])}")
