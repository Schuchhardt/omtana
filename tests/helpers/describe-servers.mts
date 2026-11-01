/**
 * Imprime lo que publican los dos servidores MCP (`tools/list`) como JSON.
 *
 * Corre aparte, con `--conditions=react-server`, porque los servidores
 * importan módulos marcados "server-only" (lo mismo que hacen los scripts del
 * CLI). Lo usa tests/mcp-servers.test.mts.
 */
import { describeTools } from "../../src/lib/mcp/protocol";
import { userServer } from "../../src/lib/mcp/user-server";
import { adminServer } from "../../src/lib/mcp/admin-server";

const describe = (server: typeof userServer | typeof adminServer) => ({
  name: server.name,
  instructions: server.instructions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: describeTools(server as any),
});

process.stdout.write(JSON.stringify({ user: describe(userServer), admin: describe(adminServer) }));
