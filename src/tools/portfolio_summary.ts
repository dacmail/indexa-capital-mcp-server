/**
 * Tool: indexa_portfolio_summary
 *
 * Convenience tool that combines /users/me + /portfolio + /performance
 * for every active account into a single response.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/client.js";
import { formatEur, formatPercent, renderOutput } from "../services/format.js";
import {
  parsePortfolio,
  type RawPortfolioResponse,
} from "../services/portfolio_parse.js";
import { responseFormatSchema } from "../schemas/common.js";

const InputSchema = z.object({ response_format: responseFormatSchema }).strict();
type Input = z.infer<typeof InputSchema>;

interface MeAccount { account_number: string; status: string; type: "mutual" | "pension" }
interface MePartial { email?: string; name?: string; surname?: string; accounts?: MeAccount[] }
interface PerformanceStub {
  performance?: { period?: string[]; return?: number[] };
  plan_expected_return?: number;
}

interface AccountSummary {
  account_number: string;
  type: "mutual" | "pension";
  status: string;
  total_value: number | null;
  cash: number | null;
  unrealized_pl: number | null;
  cumulative_return: number | null;
  plan_expected_return: number | null;
  error?: string;
}

function cumulativeReturn(values: number[] | undefined): number | null {
  if (!values || values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (!first) return null;
  return last / first - 1;
}

async function summariseAccount(account: MeAccount): Promise<AccountSummary> {
  const summary: AccountSummary = {
    account_number: account.account_number,
    type: account.type,
    status: account.status,
    total_value: null,
    cash: null,
    unrealized_pl: null,
    cumulative_return: null,
    plan_expected_return: null,
  };

  if (account.status !== "active") return summary;

  try {
    const [rawPortfolio, perf] = await Promise.all([
      apiGet<RawPortfolioResponse>(
        `/accounts/${encodeURIComponent(account.account_number)}/portfolio`
      ).catch(() => null),
      apiGet<PerformanceStub>(
        `/accounts/${encodeURIComponent(account.account_number)}/performance`
      ).catch(() => null),
    ]);

    if (rawPortfolio) {
      const parsed = parsePortfolio(rawPortfolio);
      summary.total_value = parsed.totalAmount;
      summary.cash = parsed.cashAmount;
      summary.unrealized_pl = parsed.unrealizedPL;
    }

    if (perf?.performance) {
      summary.cumulative_return = cumulativeReturn(perf.performance.return);
      summary.plan_expected_return = perf.plan_expected_return ?? null;
    }
  } catch (err) {
    summary.error = err instanceof Error ? err.message : String(err);
  }

  return summary;
}

function renderMarkdown(user: MePartial, summaries: AccountSummary[]): string {
  const name = [user.name, user.surname].filter(Boolean).join(" ") || user.email || "usuario";
  const lines: string[] = [];
  lines.push(`# Resumen Indexa Capital — ${name}`);
  lines.push("");

  if (summaries.length === 0) {
    lines.push("_No hay cuentas asociadas a este usuario._");
    return lines.join("\n");
  }

  const totalValue = summaries.reduce((s, a) => s + (a.total_value ?? 0), 0);
  const totalPL = summaries.reduce((s, a) => s + (a.unrealized_pl ?? 0), 0);
  const sign = totalPL >= 0 ? "+" : "";
  lines.push(`- **Patrimonio total en Indexa**: ${formatEur(totalValue)}`);
  lines.push(`- **P/L latente total**: ${sign}${formatEur(totalPL)}`);
  lines.push(`- **Cuentas**: ${summaries.length}`);
  lines.push("");

  for (const a of summaries) {
    const label = a.type === "mutual" ? "Cartera de fondos" : "Plan de pensiones";
    lines.push(`## ${a.account_number} — ${label}`);
    lines.push(`- **Estado**: ${a.status}`);
    if (a.status !== "active") {
      lines.push(`- _Sin datos de cartera (cuenta no activa)._`);
      lines.push("");
      continue;
    }
    if (a.error) {
      lines.push(`- ⚠️ Error: ${a.error}`);
      lines.push("");
      continue;
    }
    lines.push(`- **Valor total**: ${formatEur(a.total_value)}`);
    if (a.cash !== null && a.cash > 0) lines.push(`- **Efectivo**: ${formatEur(a.cash)}`);
    const plSign = (a.unrealized_pl ?? 0) >= 0 ? "+" : "";
    lines.push(`- **P/L latente**: ${plSign}${formatEur(a.unrealized_pl)}`);
    if (a.cumulative_return !== null) {
      lines.push(`- **Rentabilidad acumulada**: ${formatPercent(a.cumulative_return)}`);
    }
    if (a.plan_expected_return !== null) {
      lines.push(`- **Rentabilidad esperada**: ${formatPercent(a.plan_expected_return)}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Para más detalle: `indexa_get_portfolio` (composición), `indexa_get_performance` (histórico), `indexa_get_transactions` (movimientos)._");
  return lines.join("\n");
}

export function registerPortfolioSummary(server: McpServer): void {
  server.registerTool(
    "indexa_portfolio_summary",
    {
      title: "Indexa portfolio overview (all accounts)",
      description: `Convenience tool that returns a one-shot overview of ALL the user's Indexa Capital accounts: total wealth, per-account value, cash, unrealized P/L and cumulative return. Calls /users/me then /portfolio and /performance for each active account in parallel.

Use this as the FIRST tool for open-ended questions like "how are my Indexa investments doing?" or "give me an overview of my Indexa". Only use account-specific tools when the user specifies one account or aspect (composition, transactions, fees).

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns JSON:
  { "user": { email, name, surname },
    "accounts": [{ account_number, type, status, total_value, cash,
                   unrealized_pl, cumulative_return, plan_expected_return, error? }],
    "totals": { total_value, unrealized_pl, account_count } }`,
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
        const me = await apiGet<MePartial>("/users/me");
        const accounts = me.accounts ?? [];
        const summaries = await Promise.all(accounts.map(summariseAccount));

        const totals = {
          total_value: summaries.reduce((s, a) => s + (a.total_value ?? 0), 0),
          unrealized_pl: summaries.reduce((s, a) => s + (a.unrealized_pl ?? 0), 0),
          account_count: summaries.length,
        };
        const structured = {
          user: { email: me.email, name: me.name, surname: me.surname },
          accounts: summaries,
          totals,
        };

        const markdown = renderMarkdown(me, summaries);
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
