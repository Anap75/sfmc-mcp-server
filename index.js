const http = require('http');
const https = require('https');
const { URL } = require('url');

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const body = JSON.stringify({
    grant_type: 'client_credentials',
    client_id: process.env.SFMC_CLIENT_ID,
    client_secret: process.env.SFMC_CLIENT_SECRET
  });
  return new Promise((resolve, reject) => {
    const req = https.request(`https://${process.env.SFMC_SUBDOMAIN}.auth.marketingcloudapis.com/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          cachedToken = parsed.access_token;
          tokenExpiry = Date.now() + (parsed.expires_in || 1080) * 1000 - 60000;
          resolve(cachedToken);
        } catch(e) { reject(new Error('Token parse error: ' + d)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function handleMCP(msg) {
  if (msg.method === 'initialize') {
    return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sfmc', version: '1.0.0' } };
  }
  if (msg.method === 'tools/list') {
    return { tools: [
      { name: 'get_dataextensions', description: 'Liste les Data Extensions SFMC', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_journeys', description: 'Liste les journeys SFMC', inputSchema: { type: 'object', properties: {} } }
    ]};
  }
  if (msg.method === 'tools/call') {
    const token = await getToken();
    const path = msg.params.name === 'get_journeys'
      ? '/interaction/v1/interactions?$pageSize=20'
      : '/data/v1/customobjectdata/types/dataextension/collection?$pageSize=20';
    const data = await new Promise((resolve, reject) => {
      const r = https.request(`https://${process.env.SFMC_SUBDOMAIN}.rest.marketingcloudapis.com${path}`, {
        headers: { Authorization: `Bearer ${token}` }
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d)); } });
      });
      r.on('error', reject);
      r.end();
    });
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  }
  return {};
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, Mcp-Session-Id');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'sfmc-mcp-server' }));
    return;
  }

  // OAuth authorize — redirige vers claude.ai avec le code
  if (url.pathname === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const codeChallenge = url.searchParams.get('code_challenge');
    if (redirectUri) {
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set('code', 'sfmc_token_' + Date.now());
      if (state) callbackUrl.searchParams.set('state', state);
      res.writeHead(302, { Location: callbackUrl.toString() });
      res.end();
    } else {
      res.writeHead(400);
      res.end('Missing redirect_uri');
    }
    return;
  }

  // OAuth token exchange
  if (url.pathname === '/token' && req.method === 'POST') {
    try {
      const token = await getToken();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: token, token_type: 'Bearer', expires_in: 1080 }));
    } catch(e) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // MCP Streamable HTTP
  if (url.pathname === '/mcp' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      try {
        const msg = JSON.parse(body);
        const result = await handleMCP(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: e.message } }));
      }
    });
    return;
  }

  // SSE legacy
  if (url.pathname === '/sse') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    res.write(`event: endpoint\ndata: https://${req.headers.host}/mcp\n\n`);
    req.on('close', () => {});
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(process.env.PORT || 3000, () => console.log('MCP Server running'));
