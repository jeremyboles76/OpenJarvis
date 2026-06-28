"""design_to_3d — convert design drawings to 3D models.

Usage
-----
    python -m design_to_3d floor_plan.png
    python -m design_to_3d floor_plan.png front_elev.png -o building.glb
    python -m design_to_3d drawing.png --format obj --provider openai
    python -m design_to_3d *.png --view-types floor_plan,front_elevation --verbose

Run ``python -m design_to_3d --help`` for full options.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import List, Optional

from design_to_3d.analyzer import analyze_drawing
from design_to_3d.builder import build_model, merge_geometries


# ─── Logging ─────────────────────────────────────────────────────────────────


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
        datefmt="%H:%M:%S",
        level=level,
    )
    # Keep third-party libs quiet unless verbose
    if not verbose:
        for noisy in ("httpx", "httpcore", "openai", "anthropic"):
            logging.getLogger(noisy).setLevel(logging.WARNING)


# ─── Rich progress (optional) ────────────────────────────────────────────────


def _try_rich():
    try:
        from rich.console import Console
        from rich.panel import Panel
        from rich.progress import Progress, SpinnerColumn, TextColumn
        return Console(), Panel, Progress, SpinnerColumn, TextColumn
    except ImportError:
        return None, None, None, None, None


# ─── Argument parsing ─────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m design_to_3d",
        description=(
            "Convert design drawings (floor plans, elevations, technical drawings) "
            "to 3D model files (GLB, OBJ, STL) using a vision-capable LLM."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python -m design_to_3d floor_plan.png
  python -m design_to_3d floor_plan.png front_elevation.png -o building.glb
  python -m design_to_3d drawing.png --format obj --provider openai
  python -m design_to_3d *.png --view-types floor_plan,front_elevation

environment variables:
  ANTHROPIC_API_KEY   API key for Anthropic (Claude vision models)
  OPENAI_API_KEY      API key for OpenAI (GPT-4o vision)
        """,
    )
    p.add_argument(
        "drawings",
        nargs="+",
        metavar="DRAWING",
        help="Path(s) to design drawing image files (PNG, JPG, WEBP, etc.).",
    )
    p.add_argument(
        "--view-types", "-t",
        default="auto",
        metavar="TYPES",
        help=(
            "Comma-separated view type for each drawing. "
            "Options: floor_plan, front_elevation, side_elevation, "
            "section, isometric, technical, auto. "
            "Single value applies to all drawings. Default: auto"
        ),
    )
    p.add_argument(
        "--output", "-o",
        default=None,
        metavar="FILE",
        help=(
            "Output 3D model file path. "
            "Extension determines format (.glb, .obj, .stl). "
            "Default: ./model.glb"
        ),
    )
    p.add_argument(
        "--format", "-f",
        choices=["glb", "obj", "stl"],
        default="glb",
        dest="fmt",
        help="Output format (overridden by --output extension). Default: glb",
    )
    p.add_argument(
        "--provider",
        choices=["auto", "openai", "anthropic"],
        default="auto",
        help="Vision LLM provider. Default: auto (uses available API key)",
    )
    p.add_argument(
        "--model",
        default=None,
        metavar="MODEL_ID",
        help=(
            "Vision model ID. "
            "Default: claude-sonnet-4-6 (Anthropic) or gpt-4o (OpenAI)"
        ),
    )
    p.add_argument(
        "--dump-geometry",
        action="store_true",
        default=False,
        help="Print extracted geometry JSON to stdout before building.",
    )
    p.add_argument(
        "--geometry-file",
        default=None,
        metavar="FILE",
        help="Save extracted geometry JSON to this file.",
    )
    p.add_argument(
        "--verbose", "-v",
        action="store_true",
        default=False,
        help="Enable debug logging.",
    )
    return p


# ─── Main ─────────────────────────────────────────────────────────────────────


def main(argv: Optional[List[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _setup_logging(args.verbose)

    console, Panel, Progress, SpinnerColumn, TextColumn = _try_rich()
    use_rich = console is not None

    drawings: List[str] = args.drawings

    # Validate input files
    missing = [d for d in drawings if not Path(d).exists()]
    if missing:
        print(f"ERROR: file(s) not found: {', '.join(missing)}", file=sys.stderr)
        return 1

    # Parse view types
    view_types_raw = [v.strip() for v in args.view_types.split(",")]
    if len(view_types_raw) == 1:
        view_types = view_types_raw * len(drawings)
    else:
        view_types = view_types_raw
        if len(view_types) < len(drawings):
            view_types += ["auto"] * (len(drawings) - len(view_types))

    # Determine output path and format
    output = args.output or f"model.{args.fmt}"
    ext = Path(output).suffix.lower().lstrip(".")
    fmt = ext if ext in ("glb", "obj", "stl") else args.fmt

    if use_rich:
        console.print(
            Panel.fit(
                f"[bold cyan]design_to_3d[/]\n"
                f"Drawings : [green]{len(drawings)}[/] — {', '.join(Path(d).name for d in drawings)}\n"
                f"Output   : [yellow]{output}[/]  ([blue]{fmt.upper()}[/])\n"
                f"Provider : [magenta]{args.provider}[/]",
                border_style="cyan",
                title="3D Model Generator",
            )
        )
    else:
        print(f"design_to_3d: {len(drawings)} drawing(s) → {output} ({fmt.upper()})")

    analyses = []
    errors = []

    # ── Step 1: Analyze each drawing ─────────────────────────────────────────
    for i, (img, vt) in enumerate(zip(drawings, view_types), 1):
        label = f"[{i}/{len(drawings)}] Analyzing {Path(img).name} ({vt})"
        if use_rich:
            with Progress(SpinnerColumn(), TextColumn("{task.description}"), transient=True) as prog:
                prog.add_task(label)
                try:
                    geo = analyze_drawing(
                        img,
                        view_type=vt,
                        provider=args.provider,
                        model=args.model,
                    )
                    analyses.append(geo)
                except Exception as exc:
                    errors.append(f"{img}: {exc}")
                    if use_rich:
                        console.print(f"  [red]✗[/] {Path(img).name}: {exc}")
        else:
            print(label, end=" ... ", flush=True)
            try:
                geo = analyze_drawing(
                    img,
                    view_type=vt,
                    provider=args.provider,
                    model=args.model,
                )
                analyses.append(geo)
                print("ok")
            except Exception as exc:
                errors.append(f"{img}: {exc}")
                print(f"FAILED: {exc}")

    if not analyses:
        print(f"ERROR: all drawings failed to analyze:\n" + "\n".join(errors), file=sys.stderr)
        return 1

    # ── Step 2: Merge analyses ────────────────────────────────────────────────
    geometry = merge_geometries(analyses)

    if args.dump_geometry:
        print(json.dumps(geometry, indent=2))

    if args.geometry_file:
        Path(args.geometry_file).write_text(json.dumps(geometry, indent=2))
        if use_rich:
            console.print(f"  Geometry saved to [cyan]{args.geometry_file}[/]")
        else:
            print(f"Geometry saved to {args.geometry_file}")

    # ── Step 3: Build 3D model ────────────────────────────────────────────────
    build_label = f"Building {fmt.upper()} model"
    if use_rich:
        with Progress(SpinnerColumn(), TextColumn("{task.description}"), transient=True) as prog:
            prog.add_task(build_label)
            try:
                actual_path = build_model(geometry, output, fmt=fmt)
            except Exception as exc:
                console.print(f"[red]Build failed:[/] {exc}")
                return 1
    else:
        print(build_label, end=" ... ", flush=True)
        try:
            actual_path = build_model(geometry, output, fmt=fmt)
            print("ok")
        except Exception as exc:
            print(f"FAILED: {exc}", file=sys.stderr)
            return 1

    # ── Report ────────────────────────────────────────────────────────────────
    size_kb = Path(actual_path).stat().st_size / 1024
    rooms = len(geometry.get("rooms", []))

    if use_rich:
        console.print()
        console.print(f"[bold green]✓ Done![/]  {actual_path}  ({size_kb:.1f} KB)")
        if rooms:
            room_names = [r.get("name", "?") for r in geometry.get("rooms", [])[:6]]
            console.print(f"  Rooms ({rooms}): {', '.join(room_names)}")
        if errors:
            console.print(f"  [yellow]Warnings:[/] {'; '.join(errors)}")
    else:
        print(f"\nDone: {actual_path}  ({size_kb:.1f} KB)")
        if rooms:
            print(f"Rooms: {rooms}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
