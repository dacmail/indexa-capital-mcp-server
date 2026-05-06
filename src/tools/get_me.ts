/**
 * Tool: indexa_get_me
 *
 * Retrieves the authenticated user's profile and the list of accounts
 * they have access to. This is the entry point — every other tool
 * needs an account_number from here.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ResponseFormat } from "../constants.js";
import { apiGet, handleApiError } from "../services/client.js";
import { renderOutput } from "../services/format.js";
import { responseFormatSchema } from "../schemas/common.js";

const InputSchema = z
  .object({
    response_format: responseFormatSchema,
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

interface AccountSummary {
  account_number: string;
  status: string;
  type: "mutual" | "pension";
  "@path": string;
}

interface AccountRelation {
  account_number: string;
  relation: "owner" | "auth" | "guest";
}

interface MeResponse {
  username: string;
  email: string;
  name?: string;
  surname?: string;
  phone?: string;
  document?: string;
  document_type?: string;
  roles: string[];
  is_activated: boolean;
  phone_activated: boolean;
  email_activated: boolean;
  source?: string;
  affiliate_fee?: number;
  profiles?: string[];
  accounts?: AccountSummary[];
  accounts_relations?: AccountRelation[];
  person?: { name?: string };
}

function renderMarkdown(data: MeResponse): string {
  const lines: string[] = [];
  lines.push(`# Indexa Capital — Cuenta de usuario`);
  lines.push("");
  lines.push(`- **Email**: ${data.email}`);
  if (data.name || data.surname) {
    lines.push(
      `- **Nombre**: ${[data.name, data.surname].filter(Boolean).join(" ")}`
    );
  }
  if (data.document) {
    lines.push(
      `- **Documento**: ${data.document}${
        data.document_type ? ` (${data.document_type})` : ""
      }`
    );
  }
  if (data.phone) lines.push(`- **Teléfono**: ${data.phone}`);
  lines.push(
    `- **Estado**: ${data.is_activated ? "activo" : "pendiente de activación"}`
  );
  lines.push("");

  const accounts = data.accounts ?? [];
  if (accounts.length === 0) {
    lines.push("## Cuentas");
    lines.push("");
    lines.push("_Este usuario no tiene cuentas asociadas._");
    return lines.join("\n");
  }

  lines.push(`## Cuentas (${accounts.length})`);
  lines.push("");
  for (const account of accounts) {
    const relation = data.accounts_relations?.find(
      (r) => r.account_number === account.account_number
    )?.relation;
    const typeLabel =
      account.type === "mutual" ? "Cartera de fondos" : "Plan de pensiones";
    lines.push(`### ${account.account_number} — ${typeLabel}`);
    lines.push(`- **Estado**: ${account.status}`);
    if (relation) lines.push(`- **Relación**: ${relation}`);
    lines.push("");
  }

  return lines.join("\n");
}

export function registerGetMe(server: McpServer): void {
  server.registerTool(
    "indexa_get_me",
    {
      title: "Get current Indexa user",
      description: `Retrieve the authenticated user's profile and the list of all Indexa Capital accounts they own or have access to.

This is the entry point of the API: every other tool requires an \`account_number\`, and this tool is how you discover them. The token in INDEXA_API_TOKEN identifies the user, so no input is required.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format, the raw response from GET /users/me:
  {
    "username": string,
    "email": string,
    "name"?: string,
    "surname"?: string,
    "document": string,
    "document_type": string,
    "roles": string[],
    "is_activated": boolean,
    "accounts": [
      {
        "account_number": string,   // e.g. "NK1NUTP1" — pass to other tools
        "status": string,           // "active", "pending-contract", etc.
        "type": "mutual" | "pension"
      }
    ],
    "accounts_relations": [
      { "account_number": string, "relation": "owner" | "auth" | "guest" }
    ]
  }

Examples:
  - Use when: User asks "what accounts do I have at Indexa?" or any question
    that mentions Indexa investments without specifying an account.
  - Use when: You need an account_number to call any other indexa_* tool.
  - Don't use when: The user already gave you an account_number.

Error handling:
  - 401/403: token is invalid or revoked. Regenerate it in the Indexa
    private area at Configuración de usuario > Aplicaciones.`,
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
        const data = await apiGet<MeResponse>("/users/me");
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
