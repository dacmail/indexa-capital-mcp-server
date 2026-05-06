#!/usr/bin/env node
/**
 * Indexa Capital MCP server (read-only).
 *
 * Connects an MCP-compatible client (e.g. Claude Desktop) to the
 * Indexa Capital REST API for monitoring investment accounts. Only
 * GET endpoints are exposed — no transfers, contributions, or
 * withdrawals can be initiated through this server.
 *
 * Authentication: requires INDEXA_API_TOKEN env var. Generate it from
 * the Indexa private area at Configuración de usuario > Aplicaciones.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerGetMe } from "./tools/get_me.js";
import { registerGetAccount } from "./tools/get_account.js";
import { registerGetPortfolio } from "./tools/get_portfolio.js";
import { registerGetPerformance } from "./tools/get_performance.js";
import { registerGetTransactions } from "./tools/get_transactions.js";
import { registerGetFees } from "./tools/get_fees.js";
import { registerPortfolioSummary } from "./tools/portfolio_summary.js";

const server = new McpServer({
  name: "indexa-capital-mcp-server",
  version: "0.1.0",
});

// Register all tools.
registerGetMe(server);
registerGetAccount(server);
registerGetPortfolio(server);
registerGetPerformance(server);
registerGetTransactions(server);
registerGetFees(server);
registerPortfolioSummary(server);

async function main(): Promise<void> {
  // Validate the token is present before connecting transport so we
  // fail fast with a clear error in the client logs.
  if (!process.env.INDEXA_API_TOKEN || process.env.INDEXA_API_TOKEN.trim() === "") {
    console.error(
      "ERROR: INDEXA_API_TOKEN environment variable is required.\n" +
        "Generate a token in the Indexa private area at " +
        "Configuración de usuario > Aplicaciones, then add it to the " +
        "MCP server's env config."
    );
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdio servers MUST log to stderr only (stdout carries MCP frames).
  console.error("indexa-capital-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});
