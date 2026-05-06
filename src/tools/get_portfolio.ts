/**
 * Tool: indexa_get_portfolio
 *
 * Retrieves the current state of an Indexa account's portfolio:
 * total value, cash, list of instruments held (ISIN, name, asset class,
 * amount, cost, unrealized P/L and return %).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/client.js";
import { formatEur, renderOutput } from "../services/format.js";
import {
  parsePortfolio,
  positionUnrealizedPL,
  type RawPortfolioResponse,
  type RawPosition,
} from "../services/portfolio_parse.js";
import {
  accountNumberSchema,
  responseFormatSchema,
} from "../schemas/common.js";

const InputSchema = z
  .object({
    account_number: accountNumberSchema,
    response_format: responseFormatSchema,
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

function renderPosition(p: RawPosition): string[] {
  const lines: string[] = [];
  const isin = p.instrument.identifier ?? p.instrument.isin_code ?? "—";
  const name = p.instrument.name ?? "(sin nombre)";
  const mgmt = p.instrument.management_company_description;
  const pl = positionUnrealizedPL(p);
  const sign = pl >= 0 ? "+" : "";
  const cost = p.cost_amount ?? 0;
  const amount = p.amount ?? 0;

  lines.push(`### ${name}`);
  if (mgmt) lines.push(`_${mgmt}_`);
  lines.push(`- **ISIN**: ${isin}`);
  lines.push(
    `- **Valor actual**: ${formatEur(amount)} (${p.titles ?? "—"} títulos a ${formatEur(p.price)})`
  );
  lines.push(`- **Coste**: ${formatEur(cost)}`);
  lines.push(`- **P/L latente**: ${sign}${formatEur(pl)}`);
  if (cost > 0) {
    const pct = ((amount - cost) / cost) * 100;
    lines.push(
      `- **Rentab. sobre coste**: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
    );
  }
  lines.push("");
  return lines;
}

function renderMarkdown(raw: RawPortfolioResponse): string {
  const { totalAmount, cashAmount, instrumentsAmount, instrumentsCost, date, positions, unrealizedPL } =
    parsePortfolio(raw);

  const lines: string[] = [];
  lines.push(`# Cartera`);
  lines.push("");
  lines.push(`- **Valor total**: ${formatEur(totalAmount)}`);
  lines.push(`- **Fondos**: ${formatEur(instrumentsAmount)}`);
  if (cashAmount > 0) lines.push(`- **Efectivo**: ${formatEur(cashAmount)}`);
  if (instrumentsCost > 0) {
    lines.push(`- **Coste total**: ${formatEur(instrumentsCost)}`);
    const sign = unrealizedPL >= 0 ? "+" : "";
    lines.push(`- **P/L latente total**: ${sign}${formatEur(unrealizedPL)}`);
    const pct = ((instrumentsAmount - instrumentsCost) / instrumentsCost) * 100;
    lines.push(
      `- **Rentab. sobre coste**: ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
    );
  }
  if (date) lines.push(`- **Datos a fecha**: ${date}`);
  lines.push("");

  if (positions.length === 0) {
    lines.push("_No hay posiciones abiertas en esta cuenta._");
    return lines.join("\n");
  }

  const byClass = new Map<string, { amount: number; cost: number }>();
  for (const p of positions) {
    const key =
      p.instrument.asset_class_description ??
      p.instrument.asset_class ??
      "unknown";
    const agg = byClass.get(key) ?? { amount: 0, cost: 0 };
    agg.amount += p.amount ?? 0;
    agg.cost += p.cost_amount ?? 0;
    byClass.set(key, agg);
  }

  lines.push(`## Distribución por clase de activo`);
  lines.push("");
  const sortedClasses = [...byClass.entries()].sort(
    (a, b) => b[1].amount - a[1].amount
  );
  for (const [cls, agg] of sortedClasses) {
    const pct =
      instrumentsAmount > 0
        ? ((agg.amount / instrumentsAmount) * 100).toFixed(1)
        : "—";
    const pl = agg.amount - agg.cost;
    const clsSign = pl >= 0 ? "+" : "";
    lines.push(
      `- **${cls}**: ${formatEur(agg.amount)} (${pct}%) — P/L: ${clsSign}${formatEur(pl)}`
    );
  }
  lines.push("");

  lines.push(`## Posiciones (${positions.length})`);
  lines.push("");
  const sortedPos = [...positions].sort(
    (a, b) => (b.amount ?? 0) - (a.amount ?? 0)
  );
  for (const p of sortedPos) {
    lines.push(...renderPosition(p));
  }

  return lines.join("\n");
}

export function registerGetPortfolio(server: McpServer): void {
  server.registerTool(
    "indexa_get_portfolio",
    {
      title: "Get Indexa portfolio composition",
      description: `Retrieve the current portfolio of an Indexa account: total value, cash position, and the full list of instruments currently held (ISIN, name, asset class, market value, cost basis, unrealized P/L and return %).

API response shape:
  { "portfolio": { "total_amount", "cash_amount", "instruments_amount", "instruments_cost", "date" },
    "cash_accounts": [{ "amount", "date" }],
    "instrument_accounts": [{ "positions": [{
      "amount", "cost_amount", "price", "titles",
      "instrument": { "identifier"(ISIN), "name", "asset_class", "management_company_description" }
    }] }] }

The Markdown output includes: grand total, cost basis, total P/L and return %,
breakdown by asset class with %, and per-position detail sorted by value.

Args:
  - account_number (string): Indexa account ID, from indexa_get_me
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Examples:
  - Use when: "What's my Indexa portfolio worth?"
  - Use when: "Show me what funds I'm holding"
  - Use when: "How much am I up/down on my Indexa account?"
  - Don't use for: historical returns → indexa_get_performance
  - Don't use for: transaction history → indexa_get_transactions`,
      inputSchema: InputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Input) => {
      try {
        const raw = await apiGet<RawPortfolioResponse>(
          `/accounts/${encodeURIComponent(params.account_number)}/portfolio`
        );
        const parsed = parsePortfolio(raw);
        const markdown = renderMarkdown(raw);
        const structured = {
          total_amount: parsed.totalAmount,
          cash_amount: parsed.cashAmount,
          instruments_amount: parsed.instrumentsAmount,
          instruments_cost: parsed.instrumentsCost,
          unrealized_pl: parsed.unrealizedPL,
          date: parsed.date,
          position_count: parsed.positions.length,
          positions: parsed.positions,
        };
        const { text } = renderOutput(params.response_format, markdown, structured);
        return {
          content: [{ type: "text", text }],
          structuredContent: structured,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: handleApiError(error) }],
          isError: true,
        };
      }
    }
  );
}
