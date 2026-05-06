/**
 * Tool: indexa_get_account
 *
 * Retrieves the basic, static information of an Indexa account: type
 * (mutual/pension), risk profile, holders, status, funding state.
 *
 * For the actual investment composition and value, use indexa_get_portfolio.
 * For historical returns, use indexa_get_performance.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet, handleApiError } from "../services/client.js";
import { renderOutput } from "../services/format.js";
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

interface AccountResponse {
  account_number: string;
  account_type?: "personal" | "company" | "minor";
  funding: "total" | "partial" | "no";
  size?: "small" | "medium" | "large";
  currency: string;
  status: string;
  type: "mutual" | "pension";
  platform_code: string;
  profile?: {
    id: string;
    type: "mutual" | "pension";
    investment: number;
    selected_risk: number;
    is_outdated: boolean;
    needs_to_be_updated: boolean;
    risk?: { tolerance: number; capacity: number; total: number };
  };
  holders?: Array<{
    full_name: string;
    document: string;
    document_type_code: string;
    type: "BEN" | "MAIN";
    percentage?: number;
  }>;
  preferences?: unknown[];
}

function renderMarkdown(data: AccountResponse): string {
  const lines: string[] = [];
  const typeLabel =
    data.type === "mutual" ? "Cartera de fondos" : "Plan de pensiones";
  lines.push(`# Cuenta ${data.account_number} — ${typeLabel}`);
  lines.push("");
  lines.push(`- **Estado**: ${data.status}`);
  lines.push(`- **Tipo de titularidad**: ${data.account_type ?? "—"}`);
  lines.push(`- **Moneda**: ${data.currency}`);
  lines.push(`- **Financiación**: ${data.funding}`);
  if (data.size) lines.push(`- **Tamaño**: ${data.size}`);
  lines.push(`- **Plataforma**: ${data.platform_code}`);
  lines.push("");

  if (data.profile) {
    lines.push(`## Perfil de inversión`);
    lines.push("");
    lines.push(`- **Riesgo seleccionado**: ${data.profile.selected_risk}/10`);
    if (data.profile.risk) {
      lines.push(
        `- **Tolerancia al riesgo**: ${data.profile.risk.tolerance}/10`
      );
      lines.push(
        `- **Capacidad de riesgo**: ${data.profile.risk.capacity}/10`
      );
      lines.push(`- **Riesgo total (perfil)**: ${data.profile.risk.total}/10`);
    }
    lines.push(`- **Inversión inicial declarada**: ${data.profile.investment}€`);
    if (data.profile.is_outdated) {
      lines.push(`- ⚠️ El perfil está marcado como _outdated_.`);
    }
    if (data.profile.needs_to_be_updated) {
      lines.push(`- ⚠️ El perfil necesita actualizarse.`);
    }
    lines.push("");
  }

  const holders = data.holders ?? [];
  if (holders.length > 0) {
    lines.push(`## Titulares (${holders.length})`);
    lines.push("");
    for (const h of holders) {
      const role = h.type === "MAIN" ? "Titular principal" : "Beneficiario";
      const pct = h.percentage !== undefined ? ` — ${h.percentage}%` : "";
      lines.push(
        `- **${h.full_name}** (${h.document_type_code} ${h.document}) — ${role}${pct}`
      );
    }
  }

  return lines.join("\n");
}

export function registerGetAccount(server: McpServer): void {
  server.registerTool(
    "indexa_get_account",
    {
      title: "Get Indexa account details",
      description: `Retrieve static information about a single Indexa account: product type (cartera de fondos / plan de pensiones), risk profile (1-10), holders, account status, funding state and currency.

This tool does NOT return the current portfolio value, holdings, or performance — for those use indexa_get_portfolio and indexa_get_performance.

Args:
  - account_number (string): Indexa account ID, obtained from indexa_get_me
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format, the raw response from GET /accounts/{account_number}:
  {
    "account_number": string,
    "account_type": "personal" | "company" | "minor",
    "type": "mutual" | "pension",
    "currency": string,                    // typically "EUR"
    "status": string,                      // "active", "pending-contract", etc.
    "funding": "total" | "partial" | "no",
    "profile": {
      "selected_risk": 1-10,               // user-selected risk level
      "risk": {
        "tolerance": 1-10,                 // questionnaire-derived
        "capacity": 1-10,
        "total": 1-10                      // = min(tolerance, capacity)
      },
      "is_outdated": boolean,
      "needs_to_be_updated": boolean
    },
    "holders": [...],                      // titulares con nombre y DNI
    "platform_code": string
  }

Examples:
  - Use when: "What's my risk profile on account NK1NUTP1?"
  - Use when: "Is my pension account active?"
  - Don't use when: The user wants the current portfolio value (use
    indexa_get_portfolio) or returns (use indexa_get_performance).

Error handling:
  - 404: account_number does not exist or you don't have access to it.
  - 401/403: token invalid or revoked.`,
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
        const data = await apiGet<AccountResponse>(
          `/accounts/${encodeURIComponent(params.account_number)}`
        );
        const markdown = renderMarkdown(data);
        const { text } = renderOutput(params.response_format, markdown, data);
        return {
          content: [{ type: "text", text }],
          structuredContent: data as unknown as Record<string, unknown>,
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
