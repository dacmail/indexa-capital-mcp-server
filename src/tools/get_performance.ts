/**
 * Tool: indexa_get_performance
 *
 * Retrieves historical and projected performance for an Indexa account.
 *
 * The /performance endpoint returns parallel arrays where return[i],
 * period[i], best[i], worst[i], expected[i] correspond to the same
 * point in time. Performance values are returned in base 100 (a value
 * of 105 at index N means +5% cumulative return since the start).
 *
 * Per Indexa support: monthly return = 100*(return[end]/return[start] - 1).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/client.js";
import {
  formatPercent,
  renderOutput,
} from "../services/format.js";
import {
  accountNumberSchema,
  isoDateSchema,
  responseFormatSchema,
} from "../schemas/common.js";

const InputSchema = z
  .object({
    account_number: accountNumberSchema,
    date_from: isoDateSchema
      .optional()
      .describe(
        "Lower bound for the returned series (YYYY-MM-DD). Omit for full history."
      ),
    date_to: isoDateSchema
      .optional()
      .describe(
        "Upper bound for the returned series (YYYY-MM-DD). Omit for latest available."
      ),
    include_projections: z
      .boolean()
      .default(false)
      .describe(
        "Include best/worst/expected projection arrays in the JSON output. " +
          "These can be very large; default false to keep responses small."
      ),
    response_format: responseFormatSchema,
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface PerformanceResponse {
  plan_expected_return?: number;
  performance?: {
    period?: string[];
    return?: number[];
    benchmark?: number[];
    best?: number[];
    worst?: number[];
    expected?: number[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Normalises any ISO 8601 date string to YYYY-MM-DD.
 *
 * Fast path: if the string starts with a date segment, slice it directly.
 * "2022-01-31T01:00:00+01:00" → "2022-01-31"
 * "2022-01-31"               → "2022-01-31"
 *
 * Fallback: parse with Date and format in UTC (handles edge cases).
 */
function toCalendarDate(isoString: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(isoString)) return isoString.slice(0, 10);
  try {
    const d = new Date(isoString);
    return d.toISOString().slice(0, 10);
  } catch {
    return isoString.slice(0, 10); // best effort
  }
}

/**
 * Filters parallel arrays to a date window. The arrays must all be the
 * same length as `period`.
 */
function sliceByDate(
  data: PerformanceResponse,
  from?: string,
  to?: string
): PerformanceResponse {
  const perf = data.performance;
  if (!perf?.period || perf.period.length === 0) return data;

  let startIdx = 0;
  let endIdx = perf.period.length - 1;

  if (from) {
    startIdx = perf.period.findIndex((d) => toCalendarDate(d) >= from);
    if (startIdx === -1) startIdx = perf.period.length;
  }
  if (to) {
    for (let i = perf.period.length - 1; i >= 0; i--) {
      if (toCalendarDate(perf.period[i]) <= to) {
        endIdx = i;
        break;
      }
    }
  }

  if (startIdx === 0 && endIdx === perf.period.length - 1) {
    return data;
  }

  const slice = <T>(arr: T[] | undefined): T[] | undefined =>
    arr ? arr.slice(startIdx, endIdx + 1) : undefined;

  return {
    ...data,
    performance: {
      ...perf,
      period: slice(perf.period) ?? [],
      return: slice(perf.return),
      benchmark: slice(perf.benchmark),
      best: slice(perf.best),
      worst: slice(perf.worst),
      expected: slice(perf.expected),
    },
  };
}

/**
 * Computes cumulative return from base-100 values.
 * 100 * (last/first - 1).
 */
function cumulativeReturn(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (!first || first === 0) return null;
  return last / first - 1;
}

/**
 * Annualised return assuming the series is roughly monthly samples.
 * Uses the ratio of months / 12 as the period.
 */
function annualisedReturn(
  values: number[],
  periods: string[]
): number | null {
  if (values.length < 2 || periods.length < 2) return null;
  const cum = cumulativeReturn(values);
  if (cum === null) return null;

  const start = new Date(toCalendarDate(periods[0]));
  const end = new Date(toCalendarDate(periods[periods.length - 1]));
  const years =
    (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  if (years <= 0) return cum;
  return Math.pow(1 + cum, 1 / years) - 1;
}

function renderMarkdown(data: PerformanceResponse): string {
  const lines: string[] = [];
  lines.push(`# Rentabilidad`);
  lines.push("");

  const perf = data.performance;
  if (!perf?.period || perf.period.length === 0 || !perf.return) {
    lines.push("_No hay datos de rentabilidad disponibles._");
    return lines.join("\n");
  }

  const { period, return: returnSeries, benchmark } = perf;
  const startDate = toCalendarDate(period[0]);
  const endDate = toCalendarDate(period[period.length - 1]);
  const cum = cumulativeReturn(returnSeries);
  const annual = annualisedReturn(returnSeries, period);

  lines.push(`- **Periodo**: ${startDate} → ${endDate}`);
  lines.push(`- **Puntos en la serie**: ${period.length}`);
  lines.push(`- **Rentabilidad acumulada**: ${formatPercent(cum)}`);
  if (annual !== null) {
    lines.push(`- **Rentabilidad anualizada (estimada)**: ${formatPercent(annual)}`);
  }
  if (data.plan_expected_return !== undefined) {
    lines.push(
      `- **Rentabilidad esperada del plan**: ${formatPercent(
        data.plan_expected_return
      )}`
    );
  }

  if (benchmark && benchmark.length === returnSeries.length) {
    const benchCum = cumulativeReturn(benchmark);
    if (benchCum !== null) {
      lines.push(`- **Benchmark acumulado**: ${formatPercent(benchCum)}`);
      if (cum !== null) {
        const diff = cum - benchCum;
        const sign = diff >= 0 ? "+" : "";
        lines.push(`- **Alpha vs benchmark**: ${sign}${formatPercent(diff)}`);
      }
    }
  }
  lines.push("");

  // Sample a handful of points so the user gets a sense of the curve
  // without dumping the whole series.
  const samples = Math.min(8, period.length);
  const step = Math.max(1, Math.floor(period.length / samples));
  lines.push(`## Muestra de la serie (cada ~${step} puntos, base 100)`);
  lines.push("");
  lines.push("| Fecha | Rentabilidad (base 100) | Var. acum. |");
  lines.push("|---|---:|---:|");
  const base = returnSeries[0] ?? 100;
  for (let i = 0; i < period.length; i += step) {
    const v = returnSeries[i];
    const pct = base ? v / base - 1 : 0;
    lines.push(`| ${toCalendarDate(period[i])} | ${v?.toFixed(2) ?? "—"} | ${formatPercent(pct)} |`);
  }
  // Always include the last point
  if ((period.length - 1) % step !== 0) {
    const last = period.length - 1;
    const v = returnSeries[last];
    const pct = base ? v / base - 1 : 0;
    lines.push(`| ${toCalendarDate(period[last])} | ${v?.toFixed(2)} | ${formatPercent(pct)} |`);
  }
  lines.push("");
  lines.push(
    "_Para la serie completa día a día, llama de nuevo con `response_format: 'json'`._"
  );

  return lines.join("\n");
}

export function registerGetPerformance(server: McpServer): void {
  server.registerTool(
    "indexa_get_performance",
    {
      title: "Get Indexa account performance",
      description: `Retrieve the historical performance series for an Indexa account, with optional date filtering and projection data.

Performance values are returned in **base 100** — a value of 105 at index N means +5% cumulative return since the start of the series. Per Indexa support, returns between two points are computed as: \`100 * (return[end] / return[start] - 1)\`.

Args:
  - account_number (string): Indexa account ID
  - date_from (string, optional): Filter the series to start on or after this date (YYYY-MM-DD)
  - date_to (string, optional): Filter the series to end on or before this date (YYYY-MM-DD)
  - include_projections (boolean, default false): Whether to include best/worst/expected forward projections in the JSON output. These can be large; leave off unless explicitly needed.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

The Markdown format computes and displays:
  - Cumulative return over the period
  - Annualised return (estimated from the date range)
  - Plan expected return (Indexa's own projection)
  - Benchmark comparison and alpha (if benchmark series is present)
  - A sampled subset of the curve as a table (~8 points)

Returns:
  For JSON format, the structure is:
  {
    "plan_expected_return": number,         // e.g. 0.0384 = +3.84%/year expected
    "performance": {
      "period": ["YYYY-MM-DD", ...],        // dates
      "return": [number, ...],              // base-100 actual return series
      "benchmark"?: [number, ...],          // base-100 benchmark series
      "best"?: [number, ...],               // best-case projection (if requested)
      "worst"?: [number, ...],              // worst-case projection
      "expected"?: [number, ...]            // expected projection
    }
  }

Examples:
  - Use when: "What's my YTD return on Indexa?" -> date_from = first day of year
  - Use when: "How has my account performed since I opened it?" -> no dates
  - Use when: "Compare my returns to the benchmark"
  - Don't use when: The user wants the current value (use indexa_get_portfolio)
    or transaction history (use indexa_get_transactions).

Error handling:
  - 404: account not found or no performance data yet (e.g. just opened).
  - 401/403: token invalid.`,
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
        const raw = await apiGet<PerformanceResponse>(
          `/accounts/${encodeURIComponent(params.account_number)}/performance`
        );

        // Apply client-side date filtering since the API may not support
        // server-side filtering on this endpoint.
        let filtered = sliceByDate(raw, params.date_from, params.date_to);

        // Optionally strip projection arrays to keep output compact.
        if (!params.include_projections && filtered.performance) {
          const { best, worst, expected, ...rest } = filtered.performance;
          // intentionally drop best/worst/expected
          void best;
          void worst;
          void expected;
          filtered = { ...filtered, performance: rest };
        }

        const markdown = renderMarkdown(filtered);
        const { text } = renderOutput(
          params.response_format,
          markdown,
          filtered,
          "Use date_from and date_to to narrow the time range, or omit projections."
        );
        return {
          content: [{ type: "text", text }],
          structuredContent: filtered as Record<string, unknown>,
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
