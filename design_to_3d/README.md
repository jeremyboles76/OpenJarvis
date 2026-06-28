# design_to_3d

A standalone Python program that converts design drawings into 3D model files using vision-capable LLMs.

## How it works

1. **Analyze** — Each drawing image is sent to a vision LLM (Claude or GPT-4o) which extracts structured geometry: room layouts, dimensions, wall thicknesses, ceiling heights.
2. **Merge** — Multiple views (floor plan + elevations) are combined into a single geometry description.
3. **Build** — The geometry is assembled into a 3D mesh and exported as GLB, OBJ, or STL.

```
floor_plan.png  ─┐
                  ├─► vision LLM ─► geometry JSON ─► 3D mesh ─► model.glb
front_elev.png  ─┘
```

## Supported drawing types

| View type | What the LLM extracts |
|---|---|
| `floor_plan` | Room layout, dimensions, wall thickness, door/window openings |
| `front_elevation` / `side_elevation` | Building height, floor height, roof type/pitch |
| `section` | Internal heights, structural elements |
| `isometric` | Overall dimensions, visible features |
| `technical` | Object dimensions, holes, fillets, extrusions |
| `auto` | LLM infers the type automatically |

## Supported output formats

| Format | Extension | Dependency |
|---|---|---|
| Binary glTF | `.glb` | `trimesh` + `numpy` (falls back to OBJ if absent) |
| Wavefront OBJ | `.obj` | None |
| ASCII STL | `.stl` | None |

## Setup

```bash
# Install dependencies (from the design_to_3d/ directory or repo root)
pip install -r design_to_3d/requirements.txt

# Set your API key (at least one required)
export ANTHROPIC_API_KEY="sk-ant-..."   # Claude vision
export OPENAI_API_KEY="sk-..."          # GPT-4o vision
```

## Usage

### Command line

```bash
# Single floor plan → GLB (default)
python -m design_to_3d floor_plan.png

# Floor plan + front elevation → GLB
python -m design_to_3d floor_plan.png front_elevation.png -o building.glb

# Use explicit view types
python -m design_to_3d fp.png fe.png \
    --view-types floor_plan,front_elevation \
    -o building.glb

# OBJ output (no trimesh needed)
python -m design_to_3d drawing.png --format obj -o model.obj

# Technical drawing → STL (good for 3D printing)
python -m design_to_3d bracket.png --view-types technical --format stl

# Dump extracted geometry to inspect
python -m design_to_3d floor_plan.png --dump-geometry --geometry-file geo.json

# Use OpenAI instead of Anthropic
python -m design_to_3d drawing.png --provider openai --model gpt-4o

# Full options
python -m design_to_3d --help
```

### Python API

```python
from design_to_3d import analyze_drawing, build_model, merge_geometries

# Analyze a single drawing
geometry = analyze_drawing("floor_plan.png", view_type="floor_plan")

# Or multiple drawings
geo1 = analyze_drawing("floor_plan.png",    view_type="floor_plan")
geo2 = analyze_drawing("front_elev.png",    view_type="front_elevation")
geometry = merge_geometries([geo1, geo2])

# Inspect the extracted geometry
import json
print(json.dumps(geometry, indent=2))

# Build the 3D model
output = build_model(geometry, "building.glb")          # GLB (needs trimesh)
output = build_model(geometry, "building.obj")          # OBJ (no deps)
output = build_model(geometry, "building.stl")          # STL (no deps)
print(f"Saved: {output}")
```

### Example geometry JSON (floor plan)

```json
{
  "drawing_type": "floor_plan",
  "overall_width": 12.0,
  "overall_depth": 9.0,
  "wall_thickness": 0.2,
  "floor_height": 2.8,
  "rooms": [
    {"name": "living_room",  "x": 0.0, "y": 0.0, "width": 6.0, "depth": 5.0, "height": 2.8},
    {"name": "kitchen",      "x": 6.0, "y": 0.0, "width": 6.0, "depth": 4.0, "height": 2.8},
    {"name": "bedroom_1",    "x": 0.0, "y": 5.0, "width": 4.0, "depth": 4.0, "height": 2.8},
    {"name": "bathroom",     "x": 4.0, "y": 5.0, "width": 2.0, "depth": 4.0, "height": 2.4}
  ]
}
```

## Notes

- **Scale estimation**: If no scale bar is present in the drawing, the LLM estimates dimensions based on visual proportions and architectural standards.
- **trimesh fallback**: When `trimesh` is not installed, GLB requests automatically fall back to OBJ format. The output file extension changes to `.obj`.
- **Multiple drawings**: Providing both a floor plan and an elevation gives the best results — the floor plan defines the room layout and the elevation provides accurate heights.
- **Coordinates**: Room `x`/`y` values originate at the bottom-left of the drawing. `z` is always 0 (ground floor). Heights extend upward.
