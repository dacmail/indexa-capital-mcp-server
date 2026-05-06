/**
 * Tool: indexa_get_fees
 *
 * Retrieves the management fees charged by Indexa for an account.
 * The endpoint returns one record per quarter with:
 *   - fees: net management fee in EUR
 *   - vat: VAT applied
 *   - amount: the asset base used to compute the fee
 *   - average_fee: effective fee in basis points
 *   - document: link to the fee invoice PDF
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
    response_format: responseFormatSchema,
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface FeeRecord {
  account_number: string;
  date_from: string;
  date_to: string;
  fees: number;
  vat: number;
  amount: number;
  average_fee: number;
  document?: { showName?: string; show_name?: string; created_at?: string };
}

function inDateWindow(
  fromQuarter: string,
  toQuarter: string,
  filterFrom?: string,
  filterTo?: string
): boolean {
  if (filterTo && fromQuarter > filterTo) return false;
  if (filterFrom && toQuarter < filterFrom) return false;
  return true;
}

function renderMarkdown(records: FeeRecord[]): string {
  const lines: string[] = [];
  lines.push(`# Comisiones de gestión`);
  lines.push("");

  if (records.length === 0) {
    lines.push("_No hay registros de comisiones en el rango seleccionado._");
    return lines.join("\n");
  }

  const totalFees = records.reduce((s, r) => s + (r.fees ?? 0), 0);
  const totalVat = records.reduce((s, r) => s + (r.vat ?? 0), 0);
  lines.push(`- **Periodos**: ${records.length}`);
  lines.push(`- **Total comisiones**: ${formatEur(totalFees)}`);
  lines.push(`- **Total IVA**: ${formatEur(totalVat)}`);
  lines.push(
    `- **Total con IVA**: ${formatEur(totalFees + totalVat)}`
  );
  lines.push("");

  lines.push("| Trimestre | Base | Comisión | IVA | Tasa media |");
  lines.push("|---|---:|---:|---:|---:|");
  // Sort newest first
  const sorted = [...records].sort((a, b) =>
    b.date_from.localeCompare(a.date_from)
  );
  for (const r of sorted) {
    const tasa =
      r.average_fee !== undefined && r.average_fee !== null
        ? `${r.average_fee.toFixed(4)}%`
        : "—";
    lines.push(
      `| ${r.date_from} → ${r.date_to} | ${formatEur(r.amount)} | ${formatEur(
        r.fees
      )} | ${formatEur(r.vat)} | ${tasa} |`
    );
  }

  return lines.join("\n");
}

export function registerGetFees(server: McpServer): void {
  server.registerTool(
    "indexa_get_fees",
    {
      title: "Get Indexa management fees",
      description: `Retrieve the management fees charged by Indexa Capital on an account. Indexa bills quarterly, and this endpoint returns one record per quarter, including the asset base used, the net fee, VAT, the effective fee rate, and a link to the invoice PDF.

Args:
  - account_number (string): Indexa account ID
  - date_from (string, optional): Filter to quarters that end on or after this date (YYYY-MM-DD)
  - date_to (string, optional): Filter to quarters that start on or before this date (YYYY-MM-DD)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format, an array of fee records:
  [
    {
      "account_number": string,
      "date_from": "YYYY-MM-DD",          // start of the billing quarter
      "date_to": "YYYY-MM-DD",            // end of the billing quarter
      "fees": number,                      // net management fee in EUR
      "vat": number,                       // VAT applied in EUR
      "amount": number,                    // asset base used
      "average_fee": number,               // effective fee rate (e.g. 1.95 = 1.95 bps avg)
      "document": {                        // invoice PDF metadata
        "showName": string,
        "show_name": string,
        "created_at": "YYYY-MM-DD HH:mm:ss"
      }
    }
  ]

The Markdown format computes total fees and total VAT for the filtered range.

Examples:
  - Use when: "How much did Indexa charge me in fees last year?"
  - Use when: "What's my effective fee rate on my pension account?"
  - Use when: "List all fee invoices since 2023"

Error handling:
  - 404: account not found or no fees yet (e.g. very recently opened).
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
        const raw = await apiGet<FeeRecord[]>(
          `/accounts/${encodeURIComponent(params.account_number)}/fees`
        );
        const all = Array.isArray(raw) ? raw : [];
        const filtered = all.filter((r) =>
          inDateWindow(
            r.date_from,
            r.date_to,
            params.date_from,
            params.date_to
          )
        );

        const markdown = renderMarkdown(filtered);
        const { text } = renderOutput(
          params.response_format,
          markdown,
          filtered
        );
        return {
          content: [{ type: "text", text }],
          structuredContent: { fees: filtered, count: filtered.length },
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
