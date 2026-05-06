/**
 * Tool: indexa_get_transactions
 *
 * Retrieves the transaction history for an Indexa account: contributions,
 * withdrawals, fund subscriptions and redemptions, fees charged, etc.
 *
 * The endpoint is GET /accounts/{account_number}/transactions. The
 * exact response shape is not documented in the public RAML, so we
 * present it permissively: we know the response is an array of
 * transaction objects with at least a date and amount.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/client.js";
import { formatEur, renderOutput } from "../services/format.js";
import {
  accountNumberSchema,
  isoDateSchema,
  responseFormatSchema,
} from "../schemas/common.js";

const InputSchema = z
  .object({
    account_number: accountNumberSchema,
    date_from: isoDateSchema.optional(),
    date_to: isoDateSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe("Maximum transactions to return after date filtering."),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of transactions to skip after date filtering."),
    response_format: responseFormatSchema,
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface Transaction {
  date?: string;
  amount?: number;
  type?: string;
  description?: string;
  instrument?: { name?: string; identifier?: string };
  [key: string]: unknown;
}

type TransactionsResponse = Transaction[] | { transactions?: Transaction[] };

function extractTransactions(
  raw: TransactionsResponse
): Transaction[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.transactions)) {
    return raw.transactions;
  }
  return [];
}

function inDateWindow(
  txDate: string | undefined,
  from?: string,
  to?: string
): boolean {
  if (!txDate) return true;
  const d = txDate.slice(0, 10); // strip time portion if present
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function renderMarkdown(
  txs: Transaction[],
  total: number,
  offset: number
): string {
  const lines: string[] = [];
  lines.push(`# Movimientos`);
  lines.push("");
  lines.push(
    `Mostrando ${txs.length} de ${total} (offset ${offset}).`
  );
  lines.push("");
  if (txs.length === 0) {
    lines.push("_No hay movimientos en el rango seleccionado._");
    return lines.join("\n");
  }

  lines.push("| Fecha | Tipo | Importe | Concepto |");
  lines.push("|---|---|---:|---|");
  for (const tx of txs) {
    const date = tx.date?.slice(0, 10) ?? "—";
    const type = tx.type ?? "—";
    const amt = formatEur(tx.amount);
    const desc =
      tx.description ??
      tx.instrument?.name ??
      (tx.instrument?.identifier ? `ISIN ${tx.instrument.identifier}` : "—");
    lines.push(`| ${date} | ${type} | ${amt} | ${desc} |`);
  }

  return lines.join("\n");
}

export function registerGetTransactions(server: McpServer): void {
  server.registerTool(
    "indexa_get_transactions",
    {
      title: "Get Indexa account transactions",
      description: `Retrieve the transaction history for an Indexa account: contributions (aportaciones), withdrawals (retiradas), fund subscriptions and redemptions, dividend reinvestments, fees charged, etc.

Use this for questions about money in/out of the account or specific operations on a date.

Args:
  - account_number (string): Indexa account ID
  - date_from (string, optional): Lower date bound (YYYY-MM-DD)
  - date_to (string, optional): Upper date bound (YYYY-MM-DD)
  - limit (number, default 50, max 500): Maximum transactions to return
  - offset (number, default 0): Pagination offset
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format, an array of transaction objects. The exact shape is not
  fully published in the Indexa RAML, but transactions typically include:
  {
    "date": "YYYY-MM-DD",
    "amount": number,                    // EUR; positive = into account
    "type": string,                      // e.g. "contribution", "subscription", "redemption", "fee"
    "description": string,
    "instrument"?: {
      "name": string,
      "identifier": string                // ISIN
    }
  }

Examples:
  - Use when: "How much have I contributed to Indexa this year?"
  - Use when: "Show my last 20 movements on account NK1NUTP1"
  - Use when: "Did I get charged fees in March?"

Error handling:
  - 404: endpoint not available for this account type or status.
  - 401/403: token invalid.

Note: Date filtering and pagination are applied client-side after the
API responds. For very active accounts with many years of history, narrow
the date_from / date_to window to keep responses fast and within limits.`,
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
        const raw = await apiGet<TransactionsResponse>(
          `/accounts/${encodeURIComponent(params.account_number)}/transactions`
        );
        const all = extractTransactions(raw);

        const filtered = all.filter((tx) =>
          inDateWindow(tx.date, params.date_from, params.date_to)
        );
        const total = filtered.length;
        const page = filtered.slice(
          params.offset,
          params.offset + params.limit
        );
        const hasMore = total > params.offset + page.length;

        const structured = {
          total,
          count: page.length,
          offset: params.offset,
          transactions: page,
          has_more: hasMore,
          ...(hasMore ? { next_offset: params.offset + page.length } : {}),
        };

        const markdown = renderMarkdown(page, total, params.offset);
        const { text } = renderOutput(
          params.response_format,
          markdown,
          structured,
          "Narrow the date_from / date_to window or reduce 'limit'."
        );
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
