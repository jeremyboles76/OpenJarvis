"""design_to_3d — convert design drawings to 3D models.

Standalone program with no OpenJarvis dependency.

Quick start::

    from design_to_3d import analyze_drawing, build_model

    geo = analyze_drawing("floor_plan.png", view_type="floor_plan")
    path = build_model(geo, "building.glb")
    print(f"Model saved: {path}")
"""

from design_to_3d.analyzer import analyze_drawing
from design_to_3d.builder import build_model, merge_geometries

__version__ = "1.0.0"
__all__ = ["analyze_drawing", "build_model", "merge_geometries"]
