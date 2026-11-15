# MARKET DECK data

Mock US-equity market data for the `market-deck` theme.

- 10 tickers with 120 generated OHLCV points each.
- Commodities/macro and crypto marquee values.
- Positions, risk metrics, market breadth, sector moves.
- Fallback news per ticker.
- Deterministic generator: `specs/_tests/make-market-deck-data.mjs`.

Prices, forecasts, positions, and news fallbacks are simulated. The theme can
attempt live crypto quotes (CoinGecko) and live news (GDELT DOC 2.0), but stock
prices remain SIM unless a CORS-enabled provider/proxy is added.

Not investment advice.
