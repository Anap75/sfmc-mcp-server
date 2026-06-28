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

app.get('/health', (req, res) => res.json({ status: 'ok', subdomain: process.env.SFMC_SUBDOMAIN }));
app.get('/journeys', async (req, res) => { try { res.json(await sfmcGet('/interaction/v1/interactions?$pageSize=50')); } catch(e) { res.status(500).json({ error: e.message }); }});
app.get('/dataextensions', async (req, res) => { try { res.json(await sfmcGet('/data/v1/customobjectdata/types/dataextension/collection?$pageSize=50')); } catch(e) { res.status(500).json({ error: e.message }); }});
app.get('/assets', async (req, res) => { try { res.json(await sfmcGet('/asset/v1/content/assets?$pageSize=50')); } catch(e) { res.status(500).json({ error: e.message }); }});

app.listen(process.env.PORT || 3000, () => console.log('Server running'));
