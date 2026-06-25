#!/usr/bin/env python3
"""Coinbase Trading Agent — autonomous crypto trading via Coinbase AgentKit.

Prerequisites
-------------
1. Install the trading extras::

       uv sync --extra trading-coinbase

2. Set environment variables::

       export CDP_API_KEY_NAME="your-cdp-key-name"
       export CDP_API_KEY_PRIVATE_KEY="your-cdp-private-key"
       export OPENAI_API_KEY="your-openai-api-key"

Usage
-----
Run a one-shot trading cycle::

    python examples/coinbase_trading/coinbase_trading_agent.py \\
        "BTC price drops 5% on high volume. RSI is at 28. Analyze and trade if conditions met."

Check portfolio balance only (no trades)::

    python examples/coinbase_trading/coinbase_trading_agent.py \\
        "What is my current wallet balance across all assets?"

Use a stricter risk limit::

    python examples/coinbase_trading/coinbase_trading_agent.py \\
        "ETH is showing a golden cross on the 4h chart. Evaluate and act." \\
        --max-risk-pct 0.01
"""

from __future__ import annotations

import sys

import click


@click.command()
@click.argument("market_context")
@click.option(
    "--model",
    default="gpt-4o",
    show_default=True,
    help="OpenAI model used as the reasoning engine.",
)
@click.option(
    "--max-risk-pct",
    default=0.02,
    show_default=True,
    type=float,
    help="Maximum fraction of capital to risk per trade (e.g. 0.02 = 2%).",
)
def main(market_context: str, model: str, max_risk_pct: float) -> None:
    """Run one trading cycle against MARKET_CONTEXT.

    The agent checks the current wallet balance, evaluates the provided market
    signal, and places a spot trade only when risk-management conditions are met.
    """
    try:
        from openjarvis import Jarvis
    except ImportError:
        click.echo(
            "Error: openjarvis is not installed. "
            "Install it with:  uv sync --extra dev",
            err=True,
        )
        sys.exit(1)

    click.echo(f"Market context : {market_context}")
    click.echo(f"Model          : {model}")
    click.echo(f"Max risk       : {max_risk_pct * 100:.1f}% of capital")
    click.echo("-" * 60)

    try:
        j = Jarvis(model=model, engine_key="cloud")
    except Exception as exc:
        click.echo(
            f"Error: could not initialize Jarvis — {exc}\n\n"
            "Make sure CDP_API_KEY_NAME, CDP_API_KEY_PRIVATE_KEY, and "
            "OPENAI_API_KEY are set in your environment.",
            err=True,
        )
        sys.exit(1)

    try:
        response = j.ask(
            market_context,
            agent="coinbase_trading",
            openai_model=model,
            max_risk_pct=max_risk_pct,
        )
    except Exception as exc:
        click.echo(f"Error during trading cycle: {exc}", err=True)
        sys.exit(1)
    finally:
        j.close()

    click.echo(response)


if __name__ == "__main__":
    main()
