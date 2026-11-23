'use strict';
// Update server for the Hebrew Zed build.
// It speaks the small part of Zed's cloud protocol that the editor's auto-updater uses:
//   GET /releases/dev/latest/asset?os=windows&arch=x86_64&asset=zed
//   -> { "version": "0.0.<build>", "url": "<installer url>" }
// Builds come from the GitHub releases of the repo (tags build-<N> with the installer attached).
// The installer itself is streamed through this server, so the editor only ever talks to it.

const http = require('node:http');
const { Readable } = require('node:stream');

const REPO = process.env.GITHUB_REPO || 'shealtieltehumim-prog/zed-hebrew';
const ASSET_NAME = process.env.ASSET_NAME || 'Zed-Hebrew-Setup-x86_64.exe';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const CACHE_MS = Number(process.env.CACHE_MS || 120000);
const PORT = Number(process.env.PORT || 8080);

// Rollout controls (Railway variables, no redeploy of the editor needed):
//   BLOCKED_BUILDS="15,16"  builds that must never be offered
//   PIN_BUILD="17"          offer exactly this build instead of the newest one
function numberList(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

let cache = { at: 0, builds: [] };

function githubHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'zed-hebrew-update-server' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function loadBuilds(fetchImpl = fetch) {
  if (Date.now() - cache.at < CACHE_MS && cache.builds.length) return cache.builds;
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases?per_page=50`, {
      headers: githubHeaders(),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const releases = await response.json();
    const builds = [];
    for (const release of releases) {
      const match = /^build-(\d+)$/.exec(release.tag_name || '');
      if (!match || release.draft) continue;
      const asset = (release.assets || []).find((a) => a.name === ASSET_NAME);
      if (!asset) continue;
      builds.push({ number: Number(match[1]), downloadUrl: asset.browser_download_url, size: asset.size });
    }
    builds.sort((a, b) => b.number - a.number);
    cache = { at: Date.now(), builds };
  } catch (error) {
    console.error('failed to refresh releases:', error.message);
    if (!cache.builds.length) throw error;
  }
  return cache.builds;
}

function offeredBuild(builds) {
  const blocked = numberList(process.env.BLOCKED_BUILDS);
  const allowed = builds.filter((b) => !blocked.has(b.number));
  const pinned = Number(process.env.PIN_BUILD || 0);
  if (pinned) return allowed.find((b) => b.number === pinned) || null;
  return allowed[0] || null;
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto.split(',')[0]}://${req.headers.host}`;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

async function handle(req, res, fetchImpl = fetch) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (path === '/health') return sendJson(res, 200, { ok: true });

  // Editor update check. Accepts both "latest" and a specific version "0.0.<build>".
  const check = /^\/releases\/dev\/([^/]+)\/asset$/.exec(path);
  if (check) {
    const os = url.searchParams.get('os');
    const arch = url.searchParams.get('arch');
    if (os !== 'windows' || arch !== 'x86_64') return sendJson(res, 404, { error: 'no build for this platform' });
    const builds = await loadBuilds(fetchImpl);
    let build;
    if (check[1] === 'latest') {
      build = offeredBuild(builds);
    } else {
      const wanted = Number(check[1].split('.').pop());
      build = builds.find((b) => b.number === wanted) || null;
    }
    if (!build) return sendJson(res, 404, { error: 'no release available' });
    return sendJson(res, 200, {
      version: `0.0.${build.number}`,
      url: `${baseUrl(req)}/download/${build.number}/${ASSET_NAME}`,
    });
  }

  const download = /^\/download\/(\d+)\/([^/]+)$/.exec(path);
  if (download) {
    if (download[2] !== ASSET_NAME) return sendJson(res, 404, { error: 'unknown file' });
    const builds = await loadBuilds(fetchImpl);
    const build = builds.find((b) => b.number === Number(download[1]));
    if (!build) return sendJson(res, 404, { error: 'unknown build' });
    const upstream = await fetchImpl(build.downloadUrl, { headers: { 'User-Agent': 'zed-hebrew-update-server' }, redirect: 'follow' });
    if (!upstream.ok || !upstream.body) return sendJson(res, 502, { error: `GitHub answered ${upstream.status}` });
    const headers = { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' };
    const length = upstream.headers.get('content-length');
    if (length) headers['Content-Length'] = length;
    res.writeHead(200, headers);
    Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    return undefined;
  }

  if (path === '/' || path === '/status') {
    const builds = await loadBuilds(fetchImpl).catch(() => []);
    const offered = offeredBuild(builds);
    return sendJson(res, 200, {
      service: 'zed-hebrew-update-server',
      offered: offered ? offered.number : null,
      available: builds.map((b) => b.number),
      blocked: [...numberList(process.env.BLOCKED_BUILDS)],
      pinned: Number(process.env.PIN_BUILD || 0) || null,
    });
  }

  return sendJson(res, 404, { error: 'not found' });
}

function createServer(fetchImpl = fetch) {
  return http.createServer((req, res) => {
    handle(req, res, fetchImpl).catch((error) => {
      console.error('request failed:', error.message);
      if (!res.headersSent) sendJson(res, 502, { error: 'upstream failure' });
      else res.destroy();
    });
  });
}

module.exports = { createServer, offeredBuild, numberList, _resetCache: () => { cache = { at: 0, builds: [] }; } };

if (require.main === module) {
  createServer().listen(PORT, '0.0.0.0', () => console.log(`update server listening on ${PORT}`));
}
