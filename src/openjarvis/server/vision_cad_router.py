"""Vision-to-CAD structured feedback router.

Accepts an image, calls Claude vision to extract CAD parameters as structured
JSON, stores confirmed/corrected extractions for use as few-shot examples.
"""

from __future__ import annotations

import base64
import json
import logging
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from openjarvis.core.config import DEFAULT_CONFIG_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/vision-to-cad", tags=["vision-to-cad"])

_FEEDBACK_DB = DEFAULT_CONFIG_DIR / "vision_cad_feedback.db"

_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB — Claude's hard limit

_EXTRACTION_PROMPT = """\
You are a CAD engineering assistant. Analyze this sketch or image and extract \
all geometric and dimensional information.

Return ONLY a JSON object with this exact structure (no other text):
{
  "width_mm": <number or null if unknown>,
  "height_mm": <number or null if unknown>,
  "depth_mm": <number or null if unknown>,
  "material": "<material name or null>",
  "features": [
    {
      "type": "<hole|notch|fillet|chamfer|thread|slot|boss|rib|pocket>",
      "description": "<brief description>",
      "size": "<size with units if visible, otherwise null>"
    }
  ],
  "angles": [
    {"description": "<what angle>", "degrees": <number>}
  ],
  "notes": "<any other observations — mention if dimensions appear estimated>",
  "confidence": <0.0 to 1.0>
}

If dimensions are not labeled, estimate from visual proportions and set \
confidence below 0.5. Return ONLY the JSON object."""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def _get_db() -> sqlite3.Connection:
    _FEEDBACK_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_FEEDBACK_DB)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cad_feedback (
            id TEXT PRIMARY KEY,
            image_name TEXT NOT NULL,
            image_data_url TEXT NOT NULL,
            original_extraction TEXT NOT NULL,
            corrected_extraction TEXT NOT NULL,
            confirmed_at REAL NOT NULL
        )
        """
    )
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class CADFeature(BaseModel):
    type: str
    description: str
    size: Optional[str] = None


class CADExtraction(BaseModel):
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    depth_mm: Optional[float] = None
    material: Optional[str] = None
    features: List[CADFeature] = []
    angles: List[dict] = []
    notes: str = ""
    confidence: float = 0.0


class ExtractionResponse(BaseModel):
    image_id: str
    image_name: str
    image_data_url: str
    extraction: CADExtraction


class FeedbackRequest(BaseModel):
    image_id: str
    image_name: str
    image_data_url: str
    original_extraction: dict
    corrected_extraction: dict


class FeedbackResponse(BaseModel):
    id: str
    stored: bool


class HistoryEntry(BaseModel):
    id: str
    image_name: str
    image_data_url: str
    original_extraction: dict
    corrected_extraction: dict
    confirmed_at: float


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/extract", response_model=ExtractionResponse)
async def extract_cad_params(
    file: UploadFile = File(...),
    request: Request = None,  # type: ignore[assignment]
) -> ExtractionResponse:
    """Receive an image and return structured CAD parameters via Claude vision."""
    mime = file.content_type or "image/jpeg"
    if mime not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {mime}. Use JPEG, PNG, GIF, or WebP.",
        )

    data = await file.read()
    if len(data) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image exceeds 20 MB limit.")

    b64 = base64.b64encode(data).decode()
    data_url = f"data:{mime};base64,{b64}"
    image_id = str(uuid.uuid4())
    image_name = file.filename or "sketch.jpg"

    extraction = CADExtraction(
        confidence=0.0,
        notes="No vision engine available — install anthropic and set ANTHROPIC_API_KEY.",
    )

    try:
        import anthropic

        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": _EXTRACTION_PROMPT},
                    ],
                }
            ],
        )
        raw = msg.content[0].text.strip()
        parsed: dict[str, Any] = json.loads(raw)
        extraction = CADExtraction(**parsed)
        logger.info("Vision extraction succeeded (image_id=%s, confidence=%.2f)", image_id, extraction.confidence)
    except ImportError:
        logger.warning("anthropic package not installed; returning empty extraction")
    except Exception as exc:
        logger.warning("Vision extraction failed: %s", exc)
        extraction = CADExtraction(confidence=0.0, notes=f"Extraction failed: {exc}")

    return ExtractionResponse(
        image_id=image_id,
        image_name=image_name,
        image_data_url=data_url,
        extraction=extraction,
    )


@router.post("/feedback", response_model=FeedbackResponse)
async def store_feedback(body: FeedbackRequest) -> FeedbackResponse:
    """Store a confirmed or corrected CAD extraction as a training example."""
    entry_id = str(uuid.uuid4())
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO cad_feedback VALUES (?, ?, ?, ?, ?, ?)",
            (
                entry_id,
                body.image_name,
                body.image_data_url,
                json.dumps(body.original_extraction),
                json.dumps(body.corrected_extraction),
                time.time(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    logger.info("Stored CAD feedback entry (id=%s)", entry_id)
    return FeedbackResponse(id=entry_id, stored=True)


@router.get("/history", response_model=List[HistoryEntry])
async def get_history() -> List[HistoryEntry]:
    """Return the 50 most recent confirmed CAD extractions."""
    conn = _get_db()
    try:
        rows = conn.execute(
            """
            SELECT id, image_name, image_data_url,
                   original_extraction, corrected_extraction, confirmed_at
            FROM cad_feedback
            ORDER BY confirmed_at DESC
            LIMIT 50
            """
        ).fetchall()
    finally:
        conn.close()

    return [
        HistoryEntry(
            id=r[0],
            image_name=r[1],
            image_data_url=r[2],
            original_extraction=json.loads(r[3]),
            corrected_extraction=json.loads(r[4]),
            confirmed_at=r[5],
        )
        for r in rows
    ]
