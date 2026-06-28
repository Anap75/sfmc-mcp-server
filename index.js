const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

async function getToken() {
  const res = await fetch(`https://${process.env.SFMC_SUBDOMAIN}.auth.marketingcloudapis.com/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.SFMC_CLIENT_ID,
      client_secret: process.env.SFMC_CLIENT_SECRET
    })
  });
  const data = await res.json();
  return data.access_token;
}

async function sfmcGet(path) {
  const token = await getToken();
  const res = await fetch(`https://${process.env.SFMC_SUBDOMAIN}.rest.marketingcloudapis.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const serverInfo = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
  res.write(`data: ${JSON.stringify(serverInfo)}\n\n`);
  req.on('close', () => res.end());
});

app.post('/mcp', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { method, params, id } = req.body;

  if (method === 'initialize') {
    return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sfmc-server', version: '1.0.0' } } });
  }

  if (method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id, result: { tools: [
      { name: 'get_journeys', description: 'Liste les journeys SFMC', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_dataextensions', description: 'Liste les Data Extensions SFMC', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_assets', description: 'Liste les assets SFMC', inputSchema: { type: 'object', properties: {} } }
    ]}});
  }

  if (method === 'tools/call') {
    try {
      let data;
      if (params.name === 'get_journeys') data = await sfmcGet('/interaction/v1/interactions?$pageSize=50');
      else if (params.name === 'get_dataextensions') data = await sfmcGet('/data/v1/customobjectdata/types/dataextension/collection?$pageSize=50');
      else if (params.name === 'get_assets') data = await sfmcGet('/asset/v1/content/assets?$pageSize=50');
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] } });
    } catch(e) {
      return res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
    }
  }

  res.json({ jsonrpc: '2.0', id, result: {} });
});

app.options('/mcp', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => console.log('MCP Server running'));
