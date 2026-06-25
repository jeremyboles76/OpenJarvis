"""Solomon · Coinbase Trading — API router for the autonomous trading agent.

Exposes:
    POST /v1/solomon-trading/analyze   Run one trading cycle and persist result
    GET  /v1/solomon-trading/history   Return the 50 most recent results
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
import uuid
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from openjarvis.core.config import DEFAULT_CONFIG_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/solomon-trading", tags=["solomon-trading"])

_DB_PATH = DEFAULT_CONFIG_DIR / "solomon_trading.db"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


def _get_db() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS trading_runs (
            id TEXT PRIMARY KEY,
            market_context TEXT NOT NULL,
            agent_response TEXT NOT NULL,
            model TEXT NOT NULL,
            max_risk_pct REAL NOT NULL,
            created_at REAL NOT NULL
        )
        """
    )
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class AnalyzeRequest(BaseModel):
    market_context: str
    model: str = "gpt-4o"
    max_risk_pct: float = 0.02


class AnalyzeResponse(BaseModel):
    run_id: str
    market_context: str
    agent_response: str
    model: str
    max_risk_pct: float
    created_at: float


class HistoryEntry(BaseModel):
    id: str
    market_context: str
    agent_response: str
    model: str
    max_risk_pct: float
    created_at: float


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_market(body: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    """Run one Solomon trading cycle against *market_context*.

    Delegates to :class:`~openjarvis.agents.coinbase_trading.CoinbaseTradingAgent`.
    The Coinbase CDP credentials and OpenAI key are sourced from environment
    variables (``CDP_API_KEY_NAME``, ``CDP_API_KEY_PRIVATE_KEY``,
    ``OPENAI_API_KEY``).
    """
    if not body.market_context.strip():
        raise HTTPException(status_code=400, detail="market_context must not be empty.")

    try:
        from openjarvis.agents.coinbase_trading import CoinbaseTradingAgent
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "CoinbaseTradingAgent is not available. "
                "Install with:  uv sync --extra trading-coinbase"
            ),
        ) from exc

    # Reuse the engine already attached to app.state if available; otherwise
    # create a lightweight stub so BaseAgent.__init__ succeeds.
    engine = getattr(getattr(request, "app", None), "state", None)
    engine = getattr(engine, "engine", None)

    if engine is None:
        try:
            from openjarvis.engine.cloud import CloudEngine

            engine = CloudEngine()
        except Exception:
            from openjarvis.engine._stubs import InferenceEngine

            class _NullEngine(InferenceEngine):
                engine_id = "null"

                def generate(self, messages, **kwargs):  # type: ignore[override]
                    return {"content": "", "finish_reason": "stop"}

            engine = _NullEngine()

    try:
        agent = CoinbaseTradingAgent(
            engine=engine,
            model=body.model,
            openai_model=body.model,
            max_risk_pct=body.max_risk_pct,
        )
        result = agent.run(body.market_context)
        agent_response = result.content
    except Exception as exc:
        logger.warning("Trading agent run failed: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    run_id = str(uuid.uuid4())
    created_at = time.time()
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO trading_runs VALUES (?, ?, ?, ?, ?, ?)",
            (run_id, body.market_context, agent_response, body.model, body.max_risk_pct, created_at),
        )
        conn.commit()
    finally:
        conn.close()

    logger.info("Solomon trading run stored (id=%s)", run_id)
    return AnalyzeResponse(
        run_id=run_id,
        market_context=body.market_context,
        agent_response=agent_response,
        model=body.model,
        max_risk_pct=body.max_risk_pct,
        created_at=created_at,
    )


@router.get("/history", response_model=List[HistoryEntry])
async def get_history() -> List[HistoryEntry]:
    """Return the 50 most recent Solomon trading runs."""
    conn = _get_db()
    try:
        rows = conn.execute(
            """
            SELECT id, market_context, agent_response, model, max_risk_pct, created_at
            FROM trading_runs
            ORDER BY created_at DESC
            LIMIT 50
            """
        ).fetchall()
    finally:
        conn.close()

    return [
        HistoryEntry(
            id=r[0],
            market_context=r[1],
            agent_response=r[2],
            model=r[3],
            max_risk_pct=r[4],
            created_at=r[5],
        )
        for r in rows
    ]
