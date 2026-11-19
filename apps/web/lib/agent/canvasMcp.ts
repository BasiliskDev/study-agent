import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mcpTools, type MCPCallToolResultLike, type MCPClientLike } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { createCanvasMcpServer } from "@study/canvas/mcp";
import { canvasFor, type User } from "../user";

/**
 * Tools the agent takes from the Canvas MCP server. Files are read through the local
 * read_material tool instead (cached PDFs, uploaded to Claude once), so get_file_text and
 * list_files are left out, and list_courses isn't needed inside a single-course run.
 */
const AGENT_MCP_TOOLS = new Set(["get_syllabus", "list_modules", "get_page"]);

/**
 * Connect an MCP client to this user's Canvas MCP server in-process and expose its tools to the
 * tool runner. When hosted, swap InMemoryTransport for a Streamable HTTP transport; nothing else changes.
 */
export async function connectCanvasMcp(user: User) {
  const server = createCanvasMcpServer({ client: canvasFor(user) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "study-agent", version: "0.1.0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  // The MCP SDK's result type also allows a legacy { toolResult } shape that our server never returns.
  const caller: MCPClientLike = {
    callTool: async (params) => (await client.callTool(params)) as MCPCallToolResultLike,
  };
  return {
    tools: mcpTools(
      tools.filter((t) => AGENT_MCP_TOOLS.has(t.name)),
      caller,
    ),
    close: () => client.close(),
  };
}
