const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const SUBDOMAIN = process.env.SFMC_SUBDOMAIN;
const CLIENT_ID = process.env.SFMC_CLIENT_ID;
const CLIENT_SECRET = process.env.SFMC_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  const res = await fetch(`https://${SUBDOMAIN}.auth.marketingcloudapis.com/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  });
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function sfmcGet(path) {
  const token = await getToken();
  const res = await fetch(`https://${SUBDOMAIN}.rest.marketingcloudapis.com${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/emails', async (req, res) => {
  try {
    const data = await sfmcGet('/asset/v1/content/assets?$filter=assetType.id eq 96&$pageSize=50');
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/dataextensions', async (req, res) => {
  try {
    const data = await sfmcGet('/data/v1/customobjectdata/types/dataextension/collection?$pageSize=50');
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/journeys', async (req, res) => {
  try {
    const data = await sfmcGet('/interaction/v1/interactions?$pageSize=50');
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/assets', async (req, res) => {
  try {
    const data = await sfmcGet('/asset/v1/content/assets?$pageSize=50');
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SFMC MCP Server running on port ${PORT}`));
