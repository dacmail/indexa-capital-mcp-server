/**
 * portfolio_parse.ts
 *
 * Shared helper that normalises the raw JSON from GET /accounts/{id}/portfolio
 * into a stable shape that all tools can rely on, regardless of which
 * variant the Indexa API returns.
 *
 * Confirmed real shape (May 2026):
 *   {
 *     portfolio: { total_amount, cash_amount, instruments_amount, instruments_cost, date },
 *     cash_accounts:        [{ amount, date }],
 *     instrument_accounts:  [{ amount, date, positions: [Position] }]
 *   }
 *
 * Legacy / undocumented fallback shapes also handled:
 *   { total_amount, positions, unrealized, instrumental_account }
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RawInstrument {
  asset_class?: string;
  asset_class_description?: string;
  identifier?: string;
  isin_code?: string;
  identifier_name?: string;
  name?: string;
  description?: string;
  management_company_description?: string;
  [key: string]: unknown;
}

export interface RawPosition {
  amount?: number;
  cost_amount?: number;
  cost_price?: number;
  date?: string;
  instrument: RawInstrument;
  price?: number;
  titles?: number;
  type?: string;
  profit_loss?: number;          // not always present
  realized?: boolean;
  subscription_date?: string;    // not always present
  [key: string]: unknown;
}

export interface RawPortfolioSummary {
  total_amount?: number;
  cash_amount?: number;
  instruments_amount?: number;
  instruments_cost?: number;
  date?: string;
  [key: string]: unknown;
}

/** The raw JSON blob from the API — permissive to handle any variant. */
export interface RawPortfolioResponse {
  portfolio?: RawPortfolioSummary;
  cash_accounts?: Array<{ amount?: number; date?: string }>;
  instrument_accounts?: Array<{ amount?: number; date?: string; positions?: RawPosition[] }>;
  // Legacy fallback keys
  total_amount?: number;
  instrumental_account?: { amount?: number };
  positions?: RawPosition[];
  unrealized?: RawPosition[];
  [key: string]: unknown;
}

/** Normalised, ready-to-use portfolio data. */
export interface ParsedPortfolio {
  totalAmount: number;
  cashAmount: number;
  instrumentsAmount: number;
  instrumentsCost: number;
  date: string | undefined;
  positions: RawPosition[];
  unrealizedPL: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Computes the unrealized P/L for a single position.
 * Uses `profit_loss` if the API provides it; otherwise falls back to
 * `amount - cost_amount` (which is equivalent for unrealized positions).
 */
export function positionUnrealizedPL(p: RawPosition): number {
  if (p.profit_loss !== undefined && p.profit_loss !== null) {
    return p.profit_loss;
  }
  return (p.amount ?? 0) - (p.cost_amount ?? 0);
}

// ─── Main parser ─────────────────────────────────────────────────────────────

/**
 * Normalises any variant of the `/portfolio` API response into a
 * `ParsedPortfolio` object.  All callers should use this instead of
 * reading from the raw response directly.
 */
export function parsePortfolio(raw: RawPortfolioResponse): ParsedPortfolio {
  // Positions: real shape nests them inside instrument_accounts[].positions
  const positions: RawPosition[] =
    (raw.instrument_accounts ?? []).flatMap((ia) => ia.positions ?? []).length > 0
      ? (raw.instrument_accounts ?? []).flatMap((ia) => ia.positions ?? [])
      : (raw.positions ?? raw.unrealized ?? []);

  // Cash: real shape has portfolio.cash_amount; fallbacks for legacy variants
  const cashAmount =
    raw.portfolio?.cash_amount ??
    raw.cash_accounts?.[0]?.amount ??
    raw.instrumental_account?.amount ??
    0;

  // Instruments total (current market value of all positions)
  const instrumentsAmount =
    raw.portfolio?.instruments_amount ??
    positions.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Cost basis
  const instrumentsCost =
    raw.portfolio?.instruments_cost ??
    positions.reduce((s, p) => s + (p.cost_amount ?? 0), 0);

  // Grand total
  const totalAmount =
    raw.portfolio?.total_amount ??
    raw.total_amount ??
    instrumentsAmount + cashAmount;

  // Unrealized P/L across all positions
  const unrealizedPL = positions.reduce(
    (s, p) => s + positionUnrealizedPL(p),
    0
  );

  return {
    totalAmount,
    cashAmount,
    instrumentsAmount,
    instrumentsCost,
    date: raw.portfolio?.date,
    positions,
    unrealizedPL,
  };
}
