const http = require('http');
const https = require('https');
const { URL } = require('url');
const clients = new Set();

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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'sfmc-mcp-server' }));
    return;
  }

  if (url.pathname === '/oauth/token' && req.method === 'POST') {
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

  if (url.pathname === '/sse') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    const host = req.headers.host;
    const endpoint = `https://${host}/messages`;
    res.write(`event: endpoint\ndata: ${endpoint}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch(e) {
        res.writeHead(400); res.end(); return;
      }
      let response;
      if (msg.method === 'initialize') {
        response = { jsonrpc: '2.0', id: msg.id, result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sfmc', version: '1.0.0' }
        }};
      } else if (msg.method === 'tools/list') {
        response = { jsonrpc: '2.0', id: msg.id, result: { tools: [
          { name: 'get_journeys', description: 'Liste les journeys SFMC', inputSchema: { type: 'object', properties: {} } },
          { name: 'get_dataextensions', description: 'Liste les Data Extensions SFMC', inputSchema: { type: 'object', properties: {} } }
        ]}};
      } else if (msg.method === 'tools/call') {
        try {
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
              res.on('end', () => {
                try { resolve(JSON.parse(d)); } catch(e) { reject(new Error('API parse error: ' + d)); }
              });
            });
            r.on('error', reject);
            r.end();
          });
          response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] }};
        } catch(e) {
          response = { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: e.message }};
        }
      } else {
        response = { jsonrpc: '2.0', id: msg.id, result: {} };
      }
      for (const client of clients) {
        client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      }
      res.writeHead(200);
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(process.env.PORT || 3000, () => console.log('MCP Server running'));
