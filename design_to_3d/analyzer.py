"""Vision-based design drawing analyzer.

Uses a vision-capable LLM (OpenAI or Anthropic) to extract structured
3D geometry data from design drawing images — floor plans, elevations,
sections, and technical drawings.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ─── Prompts ──────────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a technical drawing analyst specializing in architecture and engineering.
Analyze design drawings and extract precise geometric and dimensional information.

For FLOOR PLANS return:
{
  "drawing_type": "floor_plan",
  "overall_width": <meters, estimate if unlabeled>,
  "overall_depth": <meters>,
  "wall_thickness": <meters, default 0.2>,
  "floor_height": <ceiling height in meters, default 2.8>,
  "rooms": [
    {
      "name": <string>,
      "x": <float, left edge from origin>,
      "y": <float, bottom edge from origin>,
      "width": <float>,
      "depth": <float>,
      "height": <optional float, overrides floor_height>
    }
  ],
  "openings": [
    {
      "type": "door" | "window",
      "room": <room name>,
      "wall": "north" | "south" | "east" | "west",
      "position": <offset in meters from wall start>,
      "width": <float>,
      "height": <float>
    }
  ]
}

For ELEVATIONS return:
{
  "drawing_type": "elevation",
  "direction": "front" | "back" | "left" | "right",
  "total_height": <meters>,
  "floor_height": <meters>,
  "roof_type": "flat" | "gable" | "hip" | "shed" | "none",
  "roof_pitch_degrees": <number if applicable, else null>
}

For TECHNICAL / MECHANICAL drawings return:
{
  "drawing_type": "technical",
  "object_name": <string>,
  "overall_dimensions": {"width": <float>, "height": <float>, "depth": <float>},
  "features": [{"type": <string>, "description": <string>}]
}

For ISOMETRIC / PERSPECTIVE views return:
{
  "drawing_type": "isometric",
  "object_name": <string>,
  "overall_dimensions": {"width": <float>, "height": <float>, "depth": <float>},
  "rooms": [<same schema as floor_plan rooms, if applicable>]
}

Rules:
- Use labeled scale when present; otherwise estimate real-world dimensions.
- Coordinates originate at the bottom-left of the drawing.
- Output ONLY valid JSON — no explanation, no markdown fences."""

_USER_PROMPT = (
    "Analyze this {view_type} design drawing and extract all geometric information. "
    "Return structured JSON following the exact schema in your instructions."
)

# ─── Image helpers ────────────────────────────────────────────────────────────

_MIME_MAP: Dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".svg": "image/svg+xml",
}


def _encode_image(path: str) -> tuple[str, str]:
    """Return (base64_data, mime_type) for a local image file."""
    p = Path(path)
    mime = _MIME_MAP.get(p.suffix.lower(), "image/png")
    data = base64.standard_b64encode(p.read_bytes()).decode("utf-8")
    return data, mime


def _parse_json(text: str) -> Dict[str, Any]:
    """Extract and parse JSON from an LLM response, handling markdown wrappers."""
    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Strip ```json ... ``` fences
    stripped = re.sub(r"```(?:json)?\s*", "", text).strip().rstrip("`").strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass
    # Grab outermost {...}
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    logger.warning("Could not parse JSON from LLM response; returning raw text")
    return {"raw": text, "drawing_type": "unknown"}


# ─── Provider backends ────────────────────────────────────────────────────────


def _analyze_openai(image_data: str, mime_type: str, prompt: str, model: str) -> str:
    try:
        import openai
    except ImportError as exc:
        raise ImportError("openai package required: pip install openai") from exc

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENAI_API_KEY environment variable is not set.")

    client = openai.OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
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
    return resp.choices[0].message.content or ""


def _analyze_anthropic(image_data: str, mime_type: str, prompt: str, model: str) -> str:
    try:
        import anthropic
    except ImportError as exc:
        raise ImportError("anthropic package required: pip install anthropic") from exc

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("ANTHROPIC_API_KEY environment variable is not set.")

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=4096,
        system=_SYSTEM_PROMPT,
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
    block = resp.content[0]
    return block.text if hasattr(block, "text") else ""


# ─── Public API ───────────────────────────────────────────────────────────────


def _resolve_provider(provider: str) -> str:
    """Auto-detect provider from available API keys."""
    if provider != "auto":
        return provider
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    raise EnvironmentError(
        "No API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY."
    )


def analyze_drawing(
    image_path: str,
    *,
    view_type: str = "auto",
    provider: str = "auto",
    model: Optional[str] = None,
) -> Dict[str, Any]:
    """Analyze a design drawing image and return structured geometry data.

    Parameters
    ----------
    image_path:
        Path to the drawing image (PNG, JPG, WEBP, etc.).
    view_type:
        Drawing type hint: ``'floor_plan'``, ``'front_elevation'``,
        ``'side_elevation'``, ``'section'``, ``'isometric'``,
        ``'technical'``, or ``'auto'``.
    provider:
        Vision LLM provider: ``'openai'``, ``'anthropic'``, or ``'auto'``
        (auto-detects from available API keys).
    model:
        Specific model ID. Defaults to ``gpt-4o`` (OpenAI) or
        ``claude-sonnet-4-6`` (Anthropic).

    Returns
    -------
    dict
        Parsed geometry data. Keys depend on ``drawing_type``; always
        includes ``"drawing_type"``.
    """
    p = Path(image_path)
    if not p.exists():
        raise FileNotFoundError(f"Drawing not found: {image_path}")

    provider = _resolve_provider(provider)
    image_data, mime_type = _encode_image(image_path)
    prompt = _USER_PROMPT.format(view_type=view_type)

    logger.info("Analyzing %s (%s) via %s", p.name, view_type, provider)

    if provider == "openai":
        model = model or "gpt-4o"
        raw = _analyze_openai(image_data, mime_type, prompt, model)
    elif provider == "anthropic":
        model = model or "claude-sonnet-4-6"
        raw = _analyze_anthropic(image_data, mime_type, prompt, model)
    else:
        raise ValueError(f"Unknown provider '{provider}'. Use 'openai' or 'anthropic'.")

    return _parse_json(raw)
