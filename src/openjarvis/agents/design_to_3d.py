"""DesignTo3DAgent — pipeline agent: design drawings → 3D model file.

Pipeline
--------
1. Analyze each drawing image via vision LLM (``analyze_drawing`` tool).
2. Synthesize multiple analyses into a unified geometry description.
3. Build the 3D model file (``build_3d_model`` tool).
4. Return the output path with a summary.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from openjarvis.agents._stubs import AgentContext, AgentResult, BaseAgent
from openjarvis.core.events import EventBus, EventType
from openjarvis.core.registry import AgentRegistry
from openjarvis.core.types import Message, Role
from openjarvis.engine._stubs import InferenceEngine

logger = logging.getLogger(__name__)

_SYNTHESIS_PROMPT = """\
You are a 3D modeling expert. Below are analysis results from one or more design drawings.
Synthesize them into a single unified geometry description for 3D model construction.

Drawing analyses:
{analyses}

Return a single JSON object with:
{{
  "drawing_type": "floor_plan" | "building" | "object",
  "overall_width": <float, total footprint width in meters>,
  "overall_depth": <float, total footprint depth in meters>,
  "floor_height": <float, ceiling height in meters>,
  "wall_thickness": <float, meters>,
  "rooms": [
    {{
      "name": <string>,
      "x": <float>, "y": <float>,
      "width": <float>, "depth": <float>,
      "height": <optional float>
    }}
  ]
}}

If there are no rooms, set rooms to [] and use overall_dimensions instead.
Return ONLY valid JSON."""

_PATH_RE = re.compile(
    r"[\w./\\-]+\.(?:png|jpg|jpeg|gif|webp|bmp|tiff|tif|svg)",
    re.IGNORECASE,
)


@AgentRegistry.register("design_to_3d")
class DesignTo3DAgent(BaseAgent):
    """Pipeline agent that converts design drawing images to a 3D model file.

    Unlike general-purpose ReAct agents, this runs a fixed three-step
    pipeline: analyze → synthesize → build. Each step is instrumented
    via the event bus when one is wired.
    """

    agent_id = "design_to_3d"
    _default_temperature = 0.2
    _default_max_tokens = 4096

    def __init__(
        self,
        engine: InferenceEngine,
        model: str,
        *,
        bus: Optional[EventBus] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        vision_provider: str = "auto",
        vision_model: Optional[str] = None,
        output_format: str = "glb",
        output_dir: Optional[str] = None,
    ) -> None:
        super().__init__(engine, model, bus=bus, temperature=temperature, max_tokens=max_tokens)
        self._vision_provider = vision_provider
        self._vision_model = vision_model
        self._output_format = output_format
        self._output_dir = output_dir or str(Path.cwd())

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _pub(self, event: EventType, payload: dict) -> None:
        if self._bus:
            self._bus.publish(event, payload)

    def _analyze_drawing(self, image_path: str, view_type: str) -> Dict:
        from openjarvis.tools.design_to_3d_tool import DrawingAnalyzerTool

        self._pub(EventType.TOOL_CALL_START, {"tool": "analyze_drawing", "image": image_path})
        tool = DrawingAnalyzerTool()
        kwargs: Dict[str, Any] = dict(
            image_path=image_path,
            view_type=view_type,
            provider=self._vision_provider,
        )
        if self._vision_model:
            kwargs["model"] = self._vision_model

        result = tool.execute(**kwargs)
        self._pub(EventType.TOOL_CALL_END, {"tool": "analyze_drawing", "success": result.success})

        if not result.success:
            raise RuntimeError(f"Drawing analysis failed: {result.content}")
        try:
            return json.loads(result.content)
        except json.JSONDecodeError:
            return {"raw": result.content, "drawing_type": view_type}

    def _synthesize(self, analyses: List[Dict]) -> Dict:
        if len(analyses) == 1 and analyses[0].get("rooms"):
            return analyses[0]

        prompt = _SYNTHESIS_PROMPT.format(analyses=json.dumps(analyses, indent=2))
        messages = [Message(role=Role.USER, content=prompt)]
        result = self._generate(messages)
        content = result.get("content", "")
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except json.JSONDecodeError:
                pass
        return analyses[0]

    def _build_model(self, geometry: Dict, output_path: str) -> str:
        from openjarvis.tools.design_to_3d_tool import Build3DModelTool

        self._pub(EventType.TOOL_CALL_START, {"tool": "build_3d_model", "output": output_path})
        tool = Build3DModelTool()
        result = tool.execute(
            geometry_data=json.dumps(geometry),
            output_path=output_path,
            output_format=self._output_format,
        )
        self._pub(EventType.TOOL_CALL_END, {"tool": "build_3d_model", "success": result.success})

        if not result.success:
            raise RuntimeError(f"3D model build failed: {result.content}")
        return result.metadata.get("output_path", output_path)

    # ── Public run ────────────────────────────────────────────────────────────

    def run(
        self,
        input: str,
        context: Optional[AgentContext] = None,
        *,
        image_paths: Optional[List[str]] = None,
        view_types: Optional[List[str]] = None,
        output_path: Optional[str] = None,
        **kwargs: Any,
    ) -> AgentResult:
        """Run the drawing-to-3D pipeline.

        Parameters
        ----------
        input:
            Natural language description of the task. File paths mentioned
            here are extracted if *image_paths* is not provided.
        image_paths:
            Explicit list of drawing image paths.
        view_types:
            Corresponding view types for each image. Defaults to ``'auto'``.
        output_path:
            Where to save the 3D model. Defaults to ``<output_dir>/model.<fmt>``.
        """
        self._emit_turn_start(input)

        if not image_paths:
            image_paths = _PATH_RE.findall(input)

        if not image_paths:
            msg = (
                "No design drawing images provided. "
                "Pass image_paths=['path/to/drawing.png'] or include file paths in the input."
            )
            self._emit_turn_end(content_length=len(msg))
            return AgentResult(content=msg, turns=0)

        n = len(image_paths)
        if view_types is None:
            view_types = ["auto"] * n
        elif len(view_types) < n:
            view_types = list(view_types) + ["auto"] * (n - len(view_types))

        if not output_path:
            ext = {"glb": ".glb", "obj": ".obj", "stl": ".stl"}.get(self._output_format, ".glb")
            output_path = str(Path(self._output_dir) / f"model{ext}")

        analyses: List[Dict] = []
        errors: List[str] = []

        # Step 1 — analyze
        for i, (img, vt) in enumerate(zip(image_paths, view_types)):
            logger.info("Analyzing %d/%d: %s (%s)", i + 1, n, img, vt)
            try:
                analyses.append(self._analyze_drawing(img, vt))
            except Exception as exc:
                logger.warning("Analysis failed for %s: %s", img, exc)
                errors.append(f"{img}: {exc}")

        if not analyses:
            msg = "All drawing analyses failed:\n" + "\n".join(errors)
            self._emit_turn_end(content_length=len(msg))
            return AgentResult(content=msg, turns=1)

        # Step 2 — synthesize
        try:
            geometry = self._synthesize(analyses)
        except Exception as exc:
            logger.warning("Synthesis failed, using first analysis: %s", exc)
            geometry = analyses[0]

        # Step 3 — build
        try:
            actual_path = self._build_model(geometry, output_path)
        except Exception as exc:
            msg = f"3D model construction failed: {exc}"
            self._emit_turn_end(content_length=len(msg))
            return AgentResult(content=msg, turns=2)

        rooms = geometry.get("rooms", [])
        parts = [f"3D model generated: {actual_path}"]
        if rooms:
            names = [r.get("name", "room") for r in rooms[:5]]
            parts.append(f"Rooms ({len(rooms)}): {', '.join(names)}")
        if errors:
            parts.append(f"Warnings: {'; '.join(errors)}")

        content = "\n".join(parts)
        self._emit_turn_end(content_length=len(content))

        return AgentResult(
            content=content,
            turns=3,
            metadata={
                "output_path": actual_path,
                "format": self._output_format,
                "drawings_analyzed": len(analyses),
                "rooms": len(rooms),
                "geometry": geometry,
            },
        )


__all__ = ["DesignTo3DAgent"]
