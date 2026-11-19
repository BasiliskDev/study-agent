#!/usr/bin/env node
/**
 * Canvas MCP server over stdio, for Claude Code / Claude Desktop.
 *
 *   claude mcp add canvas -e CANVAS_BASE_URL=https://school.instructure.com -e CANVAS_TOKEN=... \
 *     -- npx tsx /path/to/study-agent/packages/canvas/src/bin.ts
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCanvasMcpServer } from "./mcp.ts";

const baseUrl = process.env.CANVAS_BASE_URL;
const token = process.env.CANVAS_TOKEN;
if (!baseUrl || !token) {
  console.error("Set CANVAS_BASE_URL and CANVAS_TOKEN.");
  process.exit(1);
}

const server = createCanvasMcpServer({ baseUrl, token });
await server.connect(new StdioServerTransport());
console.error(`canvas MCP server running for ${baseUrl}`);
