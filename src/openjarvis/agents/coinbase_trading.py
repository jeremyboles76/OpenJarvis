"""CoinbaseTradingAgent — autonomous crypto trading via Coinbase AgentKit + LangGraph.

Requires the ``trading-coinbase`` optional dependency group::

    uv sync --extra trading-coinbase

Environment variables:
    CDP_API_KEY_NAME         Coinbase Developer Platform API key name
    CDP_API_KEY_PRIVATE_KEY  Coinbase Developer Platform private key
    OPENAI_API_KEY           OpenAI key for the GPT-4o reasoning engine
"""

from __future__ import annotations

import os
from typing import Any, Optional

from openjarvis.agents._stubs import AgentContext, AgentResult, BaseAgent
from openjarvis.core.events import EventBus
from openjarvis.core.registry import AgentRegistry
from openjarvis.engine._stubs import InferenceEngine

TRADING_SYSTEM_PROMPT = """\
You are an expert quantitative crypto trading agent.
Your goal is to optimize portfolio returns using strict risk management.
Always verify current balance before placing an order.
Never risk more than {risk_pct}% of total capital on a single trade."""


@AgentRegistry.register("coinbase_trading")
class CoinbaseTradingAgent(BaseAgent):
    """Autonomous crypto trading agent backed by Coinbase AgentKit and LangGraph.

    The agent is initialized lazily: the Coinbase CDP app, AgentKit skills,
    and LangGraph react graph are built on the first :meth:`run` call so that
    ``--help`` and import-time registration work without requiring the optional
    dependencies to be installed.

    Args:
        engine: OpenJarvis inference engine (unused at runtime; kept for
            interface compatibility).
        model: OpenJarvis model string (unused at runtime; the actual LLM is
            selected via *openai_model*).
        openai_model: OpenAI model name passed to ``ChatOpenAI``.
        openai_api_key: OpenAI API key; falls back to ``OPENAI_API_KEY`` env var.
        cdp_api_key_name: CDP key name; falls back to ``CDP_API_KEY_NAME``.
        cdp_api_key_private_key: CDP private key; falls back to
            ``CDP_API_KEY_PRIVATE_KEY``.
        max_risk_pct: Maximum fraction of total capital to risk per trade
            (default 0.02 → 2%).
    """

    agent_id = "coinbase_trading"
    _default_temperature = 0.0
    _default_max_tokens = 4096

    def __init__(
        self,
        engine: InferenceEngine,
        model: str,
        *,
        bus: Optional[EventBus] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        openai_model: str = "gpt-4o",
        openai_api_key: Optional[str] = None,
        cdp_api_key_name: Optional[str] = None,
        cdp_api_key_private_key: Optional[str] = None,
        max_risk_pct: float = 0.02,
    ) -> None:
        super().__init__(
            engine,
            model,
            bus=bus,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        self._openai_model = openai_model
        self._openai_api_key = openai_api_key or os.environ.get("OPENAI_API_KEY", "")
        self._cdp_api_key_name = cdp_api_key_name or os.environ.get(
            "CDP_API_KEY_NAME", ""
        )
        self._cdp_api_key_private_key = cdp_api_key_private_key or os.environ.get(
            "CDP_API_KEY_PRIVATE_KEY", ""
        )
        self._max_risk_pct = max_risk_pct
        self._trading_agent: Any = None  # lazily initialized on first run

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_trading_agent(self) -> Any:
        """Construct the LangGraph react agent with Coinbase AgentKit tools."""
        try:
            from coinbase_developer_platform import CoinbaseApp  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "CoinbaseTradingAgent requires 'coinbase-developer-platform'. "
                "Install the full set with:  uv sync --extra trading-coinbase"
            ) from exc

        try:
            from coinbase_agentkit import AgentKit, CoinbaseSkill  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "CoinbaseTradingAgent requires 'coinbase-agentkit'. "
                "Install the full set with:  uv sync --extra trading-coinbase"
            ) from exc

        try:
            from langchain_openai import ChatOpenAI  # type: ignore[import-untyped]
            from langgraph.prebuilt import create_react_agent  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "CoinbaseTradingAgent requires 'langchain-openai' and 'langgraph'. "
                "Install the full set with:  uv sync --extra trading-coinbase"
            ) from exc

        app = CoinbaseApp.from_env()
        agent_kit = AgentKit(
            app=app,
            skills=[
                CoinbaseSkill.TRADE_SPOT,
                CoinbaseSkill.GET_WALLET_BALANCE,
                CoinbaseSkill.GET_MARKET_DATA,
            ],
        )

        llm = ChatOpenAI(
            model=self._openai_model,
            temperature=self._temperature,
            api_key=self._openai_api_key or None,
        )

        risk_pct = int(self._max_risk_pct * 100)
        system_modifier = TRADING_SYSTEM_PROMPT.format(risk_pct=risk_pct)

        return create_react_agent(
            model=llm,
            tools=agent_kit.get_tools(),
            state_modifier=system_modifier,
        )

    # ------------------------------------------------------------------
    # BaseAgent interface
    # ------------------------------------------------------------------

    def run(
        self,
        input: str,
        context: Optional[AgentContext] = None,
        **kwargs: Any,
    ) -> AgentResult:
        """Invoke the trading agent with *input* as the market context prompt."""
        self._emit_turn_start(input)

        if self._trading_agent is None:
            self._trading_agent = self._build_trading_agent()

        response = self._trading_agent.invoke({"messages": [("user", input)]})
        messages = response.get("messages", [])
        content = messages[-1].content if messages else ""

        self._emit_turn_end(turns=1)
        return AgentResult(content=content, turns=1)


__all__ = ["CoinbaseTradingAgent", "TRADING_SYSTEM_PROMPT"]
