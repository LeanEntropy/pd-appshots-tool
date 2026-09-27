"""Read facts from a layered PSD: layer tree, text, fonts, colours and layer groups.

Usage: python psd_facts.py <input.psd> <output.json>

Deterministic, read-only. Based on the proven spike script (psd_dump2.py).
"""

import json
import sys

from psd_tools import PSDImage


def rgba(values):
    if not values or len(values) < 4:
        return None
    a, r, g, b = values[:4]
    return {"r": round(r * 255), "g": round(g * 255), "b": round(b * 255), "a": round(a, 3),
            "hex": "#{:02x}{:02x}{:02x}".format(round(r * 255), round(g * 255), round(b * 255))}


def text_facts(layer):
    facts = {"text": None, "runs": []}
    try:
        facts["text"] = layer.text
    except Exception as e:  # noqa: BLE001 - record and continue
        facts["error"] = str(e)
        return facts
    try:
        fonts = [f.get("Name") for f in (layer.resource_dict or {}).get("FontSet", [])]
        runs = layer.engine_dict.get("StyleRun", {}).get("RunArray", [])
        for run in runs:
            sd = run.get("StyleSheet", {}).get("StyleSheetData", {})
            idx = sd.get("Font")
            size = sd.get("FontSize")
            fill = sd.get("FillColor")
            stroke = sd.get("StrokeColor")
            facts["runs"].append({
                "font": str(fonts[idx]) if idx is not None and idx < len(fonts) else None,
                "size": round(float(size), 1) if size else None,
                "fill": rgba(fill.get("Values")) if fill else None,
                "stroke": rgba(stroke.get("Values")) if stroke else None,
            })
    except Exception as e:  # noqa: BLE001
        facts["runError"] = str(e)
    return facts


def walk(layer, path):
    node = {
        "name": layer.name,
        "path": path + [layer.name],
        "kind": layer.kind,
        "visible": bool(layer.is_visible()),
        "opacity": getattr(layer, "opacity", None),
        "blend": str(getattr(layer, "blend_mode", "")),
    }
    try:
        node["bbox"] = list(layer.bbox)
    except Exception:  # noqa: BLE001
        node["bbox"] = None
    if layer.kind == "type":
        node.update(text_facts(layer))
    if layer.kind == "smartobject":
        try:
            node["smartObjectFile"] = layer.smart_object.filename
        except Exception:  # noqa: BLE001
            node["smartObjectFile"] = None
    if layer.is_group():
        node["children"] = [walk(child, node["path"]) for child in layer]
    return node


def flatten(nodes):
    for n in nodes:
        yield n
        yield from flatten(n.get("children", []))


def main():
    if len(sys.argv) != 3:
        print("Usage: python psd_facts.py <input.psd> <output.json>", file=sys.stderr)
        sys.exit(2)
    psd = PSDImage.open(sys.argv[1])
    tree = [walk(layer, []) for layer in psd]
    flat = list(flatten(tree))
    texts = [n for n in flat if n["kind"] == "type"]
    fonts = sorted({r["font"] for t in texts for r in t.get("runs", []) if r.get("font")})
    out = {
        "file": sys.argv[1],
        "canvas": {"width": psd.width, "height": psd.height, "colorMode": str(psd.color_mode)},
        "topLevelGroups": [{"name": n["name"], "visible": n["visible"], "kind": n["kind"]} for n in tree],
        "textLayers": [{"path": t["path"], "text": t.get("text"), "visible": t["visible"],
                        "runs": t.get("runs", [])} for t in texts],
        "fonts": fonts,
        "smartObjects": [{"path": n["path"], "file": n.get("smartObjectFile"), "visible": n["visible"]}
                         for n in flat if n["kind"] == "smartobject"],
        "tree": tree,
    }
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"{len(texts)} text layers, {len(tree)} top-level items, fonts: {', '.join(fonts)}")


if __name__ == "__main__":
    main()
