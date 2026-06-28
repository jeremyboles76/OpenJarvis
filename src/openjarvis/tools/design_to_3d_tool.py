"""Tools for converting design drawings to 3D models.

Provides two registered tools:
  - ``analyze_drawing``  — vision-LLM analysis of design drawing images
  - ``build_3d_model``   — 3D geometry construction from analyzed drawing data
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

logger = logging.getLogger(__name__)

# ─── Vision analysis prompts ─────────────────────────────────────────────────

_ANALYSIS_SYSTEM_PROMPT = """\
You are a technical drawing analyst specializing in architecture and engineering.
Analyze design drawings and extract precise geometric and dimensional information.

For floor plans, return JSON with:
{
  "drawing_type": "floor_plan",
  "overall_width": <meters>,
  "overall_depth": <meters>,
  "wall_thickness": <meters, default 0.2>,
  "floor_height": <ceiling height in meters, default 2.8>,
  "rooms": [
    {"name": <string>, "x": <float>, "y": <float>,
     "width": <float>, "depth": <float>, "height": <optional float>}
  ],
  "openings": [
    {"type": "door"|"window", "room": <name>, "wall": "north"|"south"|"east"|"west",
     "position": <offset from wall start>, "width": <float>, "height": <float>}
  ]
}

For elevations, return JSON with:
{
  "drawing_type": "elevation",
  "direction": "front"|"back"|"left"|"right",
  "total_height": <meters>,
  "floor_height": <meters>,
  "roof_type": "flat"|"gable"|"hip"|"shed"|"none",
  "roof_pitch_degrees": <number if applicable>
}

For technical/mechanical drawings, return JSON with:
{
  "drawing_type": "technical",
  "object_name": <string>,
  "overall_dimensions": {"width": <float>, "height": <float>, "depth": <float>},
  "features": [{"type": <string>, "description": <string>}]
}

For isometric or perspective views, return JSON with:
{
  "drawing_type": "isometric",
  "object_name": <string>,
  "overall_dimensions": {"width": <float>, "height": <float>, "depth": <float>},
  "rooms": [<same schema as floor_plan rooms, if applicable>]
}

If scale is shown, use it. Otherwise estimate reasonable real-world dimensions.
Output ONLY valid JSON with no additional commentary."""

_ANALYSIS_USER_PROMPT = (
    "Analyze this {view_type} design drawing and extract all geometric information. "
    "Return structured JSON following the exact schema in your instructions."
)


# ─── Image encoding ──────────────────────────────────────────────────────────


def _encode_image(path: str) -> tuple[str, str]:
    """Return (base64_data, mime_type) for a local image file."""
    p = Path(path)
    mime_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".bmp": "image/bmp",
        ".tiff": "image/tiff",
        ".tif": "image/tiff",
    }
    mime = mime_map.get(p.suffix.lower(), "image/png")
    data = base64.standard_b64encode(p.read_bytes()).decode("utf-8")
    return data, mime


# ─── Vision API calls ─────────────────────────────────────────────────────────


def _call_openai_vision(image_data: str, mime_type: str, prompt: str, model: str) -> str:
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = openai.OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _ANALYSIS_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime_type};base64,{image_data}",
                            "detail": "high",
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            },
        ],
        max_tokens=4096,
    )
    return response.choices[0].message.content or ""


def _call_anthropic_vision(image_data: str, mime_type: str, prompt: str, model: str) -> str:
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=_ANALYSIS_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": image_data,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )
    block = response.content[0]
    return block.text if hasattr(block, "text") else ""


def _parse_json_response(text: str) -> dict:
    """Extract and parse JSON from a possibly-wrapped LLM response."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Strip markdown code fences
    stripped = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    # Find the outermost JSON object
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {"raw": text}


# ─── DrawingAnalyzerTool ──────────────────────────────────────────────────────


@ToolRegistry.register("analyze_drawing")
class DrawingAnalyzerTool(BaseTool):
    """Analyze design drawing images via a vision LLM to extract 3D geometry data."""

    tool_id = "analyze_drawing"
    is_local = False

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="analyze_drawing",
            description=(
                "Analyze a design drawing image (floor plan, elevation, section, or technical "
                "drawing) using a vision-capable LLM. Returns structured JSON with rooms, "
                "walls, dimensions, and spatial features for 3D model construction."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "image_path": {
                        "type": "string",
                        "description": "Path to the design drawing image file.",
                    },
                    "view_type": {
                        "type": "string",
                        "description": (
                            "Type of drawing: 'floor_plan', 'front_elevation', "
                            "'side_elevation', 'section', 'isometric', 'technical', or 'auto'."
                        ),
                    },
                    "provider": {
                        "type": "string",
                        "description": "Vision LLM provider: 'openai', 'anthropic', or 'auto'.",
                    },
                    "model": {
                        "type": "string",
                        "description": "Specific model ID (optional). Auto-selects if not set.",
                    },
                },
                "required": ["image_path"],
            },
            category="media",
            required_capabilities=["network:fetch"],
            timeout_seconds=120.0,
        )

    def execute(self, **params: Any) -> ToolResult:
        image_path = params.get("image_path", "")
        if not image_path:
            return ToolResult(tool_name="analyze_drawing", content="No image_path provided.", success=False)

        p = Path(image_path)
        if not p.exists():
            return ToolResult(
                tool_name="analyze_drawing",
                content=f"File not found: {image_path}",
                success=False,
            )

        view_type = params.get("view_type", "auto")
        provider = params.get("provider", "auto")

        try:
            image_data, mime_type = _encode_image(image_path)
        except Exception as exc:
            return ToolResult(
                tool_name="analyze_drawing",
                content=f"Failed to read image: {exc}",
                success=False,
            )

        prompt = _ANALYSIS_USER_PROMPT.format(view_type=view_type)

        if provider == "auto":
            if os.environ.get("ANTHROPIC_API_KEY"):
                provider = "anthropic"
            elif os.environ.get("OPENAI_API_KEY"):
                provider = "openai"
            else:
                return ToolResult(
                    tool_name="analyze_drawing",
                    content=(
                        "No vision API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
                    ),
                    success=False,
                )

        model = params.get("model") or ""
        try:
            if provider == "openai":
                model = model or "gpt-4o"
                raw = _call_openai_vision(image_data, mime_type, prompt, model)
            elif provider == "anthropic":
                model = model or "claude-sonnet-4-6"
                raw = _call_anthropic_vision(image_data, mime_type, prompt, model)
            else:
                return ToolResult(
                    tool_name="analyze_drawing",
                    content=f"Unknown provider '{provider}'. Use 'openai' or 'anthropic'.",
                    success=False,
                )
        except Exception as exc:
            return ToolResult(
                tool_name="analyze_drawing",
                content=f"Vision API error ({provider}): {exc}",
                success=False,
            )

        parsed = _parse_json_response(raw)
        result_json = json.dumps(parsed)

        return ToolResult(
            tool_name="analyze_drawing",
            content=result_json,
            success=True,
            metadata={
                "image_path": image_path,
                "view_type": view_type,
                "provider": provider,
                "model": model,
            },
        )


# ─── 3D geometry helpers ──────────────────────────────────────────────────────


def _box_verts_faces(
    x: float, y: float, z: float,
    w: float, d: float, h: float,
) -> tuple[list[tuple], list[tuple]]:
    """Return (vertices, triangles) for an axis-aligned box."""
    v = [
        (x,     y,     z),      # 0 bottom-front-left
        (x + w, y,     z),      # 1 bottom-front-right
        (x + w, y + d, z),      # 2 bottom-back-right
        (x,     y + d, z),      # 3 bottom-back-left
        (x,     y,     z + h),  # 4 top-front-left
        (x + w, y,     z + h),  # 5 top-front-right
        (x + w, y + d, z + h),  # 6 top-back-right
        (x,     y + d, z + h),  # 7 top-back-left
    ]
    f = [
        (0, 2, 1), (0, 3, 2),   # bottom (CCW from below)
        (4, 5, 6), (4, 6, 7),   # top
        (0, 1, 5), (0, 5, 4),   # front
        (2, 3, 7), (2, 7, 6),   # back
        (3, 0, 4), (3, 4, 7),   # left
        (1, 2, 6), (1, 6, 5),   # right
    ]
    return v, f


def _rooms_to_geometry(geometry: Dict) -> tuple[list, list]:
    """Convert geometry dict to (all_vertices, all_faces) with base offsets applied."""
    rooms: List[Dict] = geometry.get("rooms", [])
    default_height = float(geometry.get("floor_height", 2.8))

    if not rooms:
        # Fall back to overall_dimensions
        ow = float(
            geometry.get("overall_width")
            or geometry.get("overall_dimensions", {}).get("width", 5.0)
        )
        od = float(
            geometry.get("overall_depth")
            or geometry.get("overall_dimensions", {}).get("depth", 5.0)
        )
        oh = float(
            geometry.get("overall_height")
            or geometry.get("overall_dimensions", {}).get("height", default_height)
        )
        rooms = [{"name": "body", "x": 0.0, "y": 0.0, "width": ow, "depth": od, "height": oh}]

    all_verts: list[tuple] = []
    all_faces: list[tuple] = []

    for room in rooms:
        rx = float(room.get("x", 0))
        ry = float(room.get("y", 0))
        rw = float(room.get("width", 1))
        rd = float(room.get("depth", 1))
        rh = float(room.get("height", default_height))
        base = len(all_verts)
        verts, faces = _box_verts_faces(rx, ry, 0.0, rw, rd, rh)
        all_verts.extend(verts)
        all_faces.extend((f[0] + base, f[1] + base, f[2] + base) for f in faces)

    return all_verts, all_faces


def _build_obj(geometry: Dict, output_path: str) -> str:
    """Write a Wavefront OBJ file from geometry data."""
    verts, faces = _rooms_to_geometry(geometry)

    with open(output_path, "w") as fh:
        fh.write("# 3D model generated by OpenJarvis design-to-3d\n\n")
        for v in verts:
            # OBJ convention: X right, Y up, Z toward viewer — swap our Y/Z
            fh.write(f"v {v[0]:.4f} {v[2]:.4f} {-v[1]:.4f}\n")
        fh.write("\n")
        for f in faces:
            fh.write(f"f {f[0] + 1} {f[1] + 1} {f[2] + 1}\n")

    return output_path


def _build_glb(geometry: Dict, output_path: str) -> str:
    """Build a GLB (binary glTF) file using trimesh."""
    import trimesh

    verts, faces = _rooms_to_geometry(geometry)

    import numpy as np

    v_arr = np.array(verts, dtype=np.float32)
    f_arr = np.array(faces, dtype=np.uint32)
    mesh = trimesh.Trimesh(vertices=v_arr, faces=f_arr, process=False)
    mesh.export(output_path, file_type="glb")
    return output_path


def _build_stl(geometry: Dict, output_path: str) -> str:
    """Build an ASCII STL file from geometry data (no trimesh required)."""
    verts, faces = _rooms_to_geometry(geometry)

    with open(output_path, "w") as fh:
        fh.write("solid openjarvis_model\n")
        for f in faces:
            v0 = verts[f[0]]
            v1 = verts[f[1]]
            v2 = verts[f[2]]
            # Compute face normal (not unit, just direction)
            e1 = (v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2])
            e2 = (v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2])
            nx = e1[1]*e2[2] - e1[2]*e2[1]
            ny = e1[2]*e2[0] - e1[0]*e2[2]
            nz = e1[0]*e2[1] - e1[1]*e2[0]
            fh.write(f"  facet normal {nx:.6f} {nz:.6f} {-ny:.6f}\n")
            fh.write("    outer loop\n")
            for vi in (f[0], f[1], f[2]):
                v = verts[vi]
                fh.write(f"      vertex {v[0]:.6f} {v[2]:.6f} {-v[1]:.6f}\n")
            fh.write("    endloop\n")
            fh.write("  endfacet\n")
        fh.write("endsolid openjarvis_model\n")

    return output_path


# ─── Build3DModelTool ─────────────────────────────────────────────────────────


@ToolRegistry.register("build_3d_model")
class Build3DModelTool(BaseTool):
    """Construct a 3D model file from structured geometry data extracted from design drawings."""

    tool_id = "build_3d_model"
    is_local = True

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="build_3d_model",
            description=(
                "Build a 3D model file (GLB, OBJ, or STL) from geometry data returned by "
                "analyze_drawing. GLB output requires the trimesh package; OBJ and STL work "
                "without any additional dependencies. Falls back to OBJ when trimesh is absent."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "geometry_data": {
                        "type": "string",
                        "description": (
                            "JSON string from analyze_drawing. Must include 'rooms' list or "
                            "'overall_dimensions'. Can also accept a merged/synthesized geometry."
                        ),
                    },
                    "output_path": {
                        "type": "string",
                        "description": (
                            "Destination file path. File extension (.glb/.obj/.stl) "
                            "determines format and overrides output_format."
                        ),
                    },
                    "output_format": {
                        "type": "string",
                        "description": "Output format: 'glb' (default), 'obj', or 'stl'.",
                    },
                },
                "required": ["geometry_data"],
            },
            category="media",
            timeout_seconds=60.0,
        )

    def execute(self, **params: Any) -> ToolResult:
        geometry_raw = params.get("geometry_data", "")
        if not geometry_raw:
            return ToolResult(tool_name="build_3d_model", content="No geometry_data provided.", success=False)

        try:
            geometry: Dict = (
                geometry_raw if isinstance(geometry_raw, dict)
                else json.loads(geometry_raw)
            )
        except json.JSONDecodeError as exc:
            return ToolResult(
                tool_name="build_3d_model",
                content=f"Invalid geometry JSON: {exc}",
                success=False,
            )

        fmt = params.get("output_format", "glb").lower()
        output_path = params.get("output_path", "")

        if not output_path:
            import tempfile
            ext = {"glb": ".glb", "obj": ".obj", "stl": ".stl"}.get(fmt, ".glb")
            output_path = str(Path(tempfile.gettempdir()) / f"openjarvis_model{ext}")

        # Let file extension override format
        ext_from_path = Path(output_path).suffix.lower().lstrip(".")
        if ext_from_path in ("glb", "obj", "stl"):
            fmt = ext_from_path

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        try:
            if fmt == "glb":
                try:
                    import trimesh  # noqa: F401
                    actual = _build_glb(geometry, output_path)
                except ImportError:
                    logger.info("trimesh not installed; falling back to OBJ")
                    output_path = str(Path(output_path).with_suffix(".obj"))
                    actual = _build_obj(geometry, output_path)
                    fmt = "obj"
            elif fmt == "stl":
                actual = _build_stl(geometry, output_path)
            else:
                actual = _build_obj(geometry, output_path)
                fmt = "obj"
        except Exception as exc:
            logger.exception("3D model build failed")
            return ToolResult(
                tool_name="build_3d_model",
                content=f"3D model build error: {exc}",
                success=False,
            )

        file_size = Path(actual).stat().st_size
        rooms = len(geometry.get("rooms", []))

        return ToolResult(
            tool_name="build_3d_model",
            content=f"3D model saved to: {actual} ({file_size:,} bytes, format: {fmt.upper()})",
            success=True,
            metadata={
                "output_path": actual,
                "format": fmt,
                "file_size_bytes": file_size,
                "rooms": rooms,
            },
        )


__all__ = ["DrawingAnalyzerTool", "Build3DModelTool"]
