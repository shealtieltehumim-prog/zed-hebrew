'use strict';
const assert = require('node:assert');
const http = require('node:http');
const { createServer, _resetCache } = require('./server.js');

const NAME = 'Zed-Hebrew-Setup-x86_64.exe';
const releases = [
  { tag_name: 'build-15', draft: false, assets: [{ name: 'zed-hebrew-windows-x64.zip', browser_download_url: 'x', size: 1 }] },
  { tag_name: 'build-16', draft: false, assets: [{ name: NAME, browser_download_url: 'https://dl/16', size: 5 }] },
  { tag_name: 'build-17', draft: false, assets: [{ name: NAME, browser_download_url: 'https://dl/17', size: 5 }] },
  { tag_name: 'build-18', draft: true, assets: [{ name: NAME, browser_download_url: 'https://dl/18', size: 5 }] },
  { tag_name: 'v1', draft: false, assets: [{ name: NAME, browser_download_url: 'https://dl/v1', size: 5 }] },
];
const fakeFetch = async (url) => {
  if (String(url).includes('api.github.com')) return { ok: true, status: 200, json: async () => releases };
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('HELLO')); c.close(); } });
  return { ok: true, status: 200, body, headers: new Headers({ 'content-length': '5' }) };
};

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ port, path, headers: { host: 'updates.example', 'x-forwarded-proto': 'https' } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  const server = createServer(fakeFetch).listen(0);
  const port = server.address().port;
  const q = '?os=windows&arch=x86_64&asset=zed';

  let r = await get(port, '/health');
  assert.equal(r.status, 200);

  r = await get(port, `/releases/dev/latest/asset${q}`);
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { version: '0.0.17', url: `https://updates.example/download/17/${NAME}` });

  process.env.BLOCKED_BUILDS = '17';
  r = await get(port, `/releases/dev/latest/asset${q}`);
  assert.equal(JSON.parse(r.body).version, '0.0.16', 'blocked build must not be offered');

  process.env.BLOCKED_BUILDS = '';
  process.env.PIN_BUILD = '16';
  r = await get(port, `/releases/dev/latest/asset${q}`);
  assert.equal(JSON.parse(r.body).version, '0.0.16', 'pin wins');
  process.env.PIN_BUILD = '99';
  r = await get(port, `/releases/dev/latest/asset${q}`);
  assert.equal(r.status, 404, 'pin to a missing build offers nothing');
  delete process.env.PIN_BUILD;

  r = await get(port, '/releases/dev/latest/asset?os=macos&arch=aarch64&asset=zed');
  assert.equal(r.status, 404);

  r = await get(port, `/releases/dev/0.0.16/asset${q}`);
  assert.equal(JSON.parse(r.body).version, '0.0.16');

  r = await get(port, `/download/17/${NAME}`);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'HELLO');
  r = await get(port, `/download/18/${NAME}`);
  assert.equal(r.status, 404, 'drafts are not downloadable');
  r = await get(port, '/download/17/evil.exe');
  assert.equal(r.status, 404);

  server.close();
  console.log('all server tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
