"""``jarvis design-to-3d`` — Convert design drawings to 3D models."""

from __future__ import annotations

import json as json_mod
import logging
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

logger = logging.getLogger(__name__)
_console = Console()


@click.command("design-to-3d")
@click.argument("drawings", nargs=-1, required=True, type=click.Path(exists=True))
@click.option(
    "--view-types", "-t",
    default="auto",
    show_default=True,
    help=(
        "Comma-separated view type for each drawing. "
        "Options: floor_plan, front_elevation, side_elevation, "
        "section, isometric, technical, auto."
    ),
)
@click.option(
    "--output", "-o",
    default=None,
    help="Output 3D model file (.glb, .obj, or .stl). Default: ./model.glb",
)
@click.option(
    "--format", "-f",
    "output_format",
    type=click.Choice(["glb", "obj", "stl"], case_sensitive=False),
    default="glb",
    show_default=True,
    help="Output format (overridden by --output extension).",
)
@click.option(
    "--provider",
    type=click.Choice(["auto", "openai", "anthropic"], case_sensitive=False),
    default="auto",
    show_default=True,
    help="Vision LLM provider for drawing analysis.",
)
@click.option(
    "--model",
    default=None,
    help="Vision model ID (e.g. gpt-4o, claude-sonnet-4-6).",
)
@click.option(
    "--json-output",
    is_flag=True,
    default=False,
    help="Print result as JSON instead of rich output.",
)
@click.pass_context
def design_to_3d(
    ctx: click.Context,
    drawings: tuple,
    view_types: str,
    output: str | None,
    output_format: str,
    provider: str,
    model: str | None,
    json_output: bool,
) -> None:
    """Convert design drawings to a 3D model.

    DRAWINGS are image files (PNG, JPG, etc.) of floor plans, elevations,
    sections, or technical drawings. One or more files may be supplied.

    \b
    Examples:
      jarvis design-to-3d floor_plan.png
      jarvis design-to-3d floor_plan.png front_elevation.png -o building.glb
      jarvis design-to-3d drawing.png --format obj --provider openai
    """
    from openjarvis.agents.design_to_3d import DesignTo3DAgent
    from openjarvis.engine import get_engine

    image_paths = list(drawings)

    vt_parts = [v.strip() for v in view_types.split(",")]
    if len(vt_parts) == 1 and len(image_paths) > 1:
        vt_list = vt_parts * len(image_paths)
    else:
        vt_list = vt_parts

    if not output:
        ext_map = {"glb": ".glb", "obj": ".obj", "stl": ".stl"}
        output = str(Path.cwd() / f"model{ext_map.get(output_format, '.glb')}")

    ext = Path(output).suffix.lower().lstrip(".")
    if ext in ("glb", "obj", "stl"):
        output_format = ext

    _console.print(
        Panel.fit(
            f"[bold cyan]OpenJarvis Design-to-3D[/]\n"
            f"Drawings : [green]{len(image_paths)}[/]\n"
            f"Output   : [yellow]{output}[/]  ([blue]{output_format.upper()}[/])\n"
            f"Provider : [magenta]{provider}[/]",
            border_style="cyan",
        )
    )

    try:
        engine = get_engine()
    except Exception as exc:
        _console.print(f"[red]Engine init failed:[/] {exc}")
        _console.print("[dim]Hint: Set ANTHROPIC_API_KEY or OPENAI_API_KEY and run 'jarvis init'[/]")
        sys.exit(1)

    synthesis_model = model or "claude-sonnet-4-6"

    agent = DesignTo3DAgent(
        engine=engine,
        model=synthesis_model,
        vision_provider=provider,
        vision_model=model,
        output_format=output_format,
        output_dir=str(Path(output).parent),
    )

    with Progress(SpinnerColumn(), TextColumn("[progress.description]{task.description}"), transient=True) as prog:
        prog.add_task("Analyzing drawings and building 3D model…")
        result = agent.run(
            input=" ".join(image_paths),
            image_paths=image_paths,
            view_types=vt_list,
            output_path=output,
        )

    if json_output:
        click.echo(json_mod.dumps(
            {"content": result.content, "metadata": result.metadata, "turns": result.turns},
            indent=2,
        ))
        return

    out = result.metadata.get("output_path")
    if out and Path(out).exists():
        size_kb = Path(out).stat().st_size / 1024
        _console.print(f"\n[bold green]Done![/]  Saved to [cyan]{out}[/]  ({size_kb:.1f} KB)")
        rooms = result.metadata.get("rooms", 0)
        if rooms:
            _console.print(f"  Rooms: [yellow]{rooms}[/]")
    else:
        _console.print(f"\n[bold red]Failed:[/] {result.content}")
        sys.exit(1)


__all__ = ["design_to_3d"]
