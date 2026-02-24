import { createDeepSeek } from '@ai-sdk/deepseek'
import { createMCPClient } from '@ai-sdk/mcp';
import { Experimental_StdioMCPTransport as StdioClientTransport } from '@ai-sdk/mcp/mcp-stdio';

const mcpClient = await createMCPClient({
  transport: new StdioClientTransport({
    command: 'node',
    // TODO
    args: ['/Users/fengshaokang/Public/Private/ai-party/packages/mcp/dist/index.mjs'],
  }),
});

async function getMCPTools() {
  return await mcpClient.tools()
}

function getModel() {
  const api_key = process.env['DEEPSEEK_API_KEY']
  if (!api_key) throw new Error('DEEPSEEK_API_KEY env var is not set')
  return createDeepSeek({ apiKey: api_key })('deepseek-chat')
}
