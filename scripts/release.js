'use strict';

/*
 * Cut a GitHub release for the current version and upload the Windows installer.
 *
 *   npm run release              build, then create release v<version> + upload exe
 *   npm run release -- --no-build   skip `npm run dist` (use the existing installer)
 *   npm run release -- --notes notes.md   use a custom release-notes file
 *   npm run release -- --draft           create the release as a draft
 *
 * Authentication: reuses the GitHub token already stored by Git Credential
 * Manager (the one your `git push` uses), so no token or `gh` CLI is required.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function fail(msg) {
  console.error('\n✗ ' + msg);
  process.exit(1);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8', ...opts }).trim();
}

// ---- parse args ----------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const doBuild = !flag('--no-build');
const isDraft = flag('--draft');
const isPrerelease = flag('--prerelease');
const notesFile = opt('--notes');

// ---- read project metadata ----------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;
const tag = `v${version}`;
const productName = (pkg.build && pkg.build.productName) || pkg.name;

// Resolve owner/repo from the git "origin" remote.
function parseRepo(url) {
  const m = url.match(/github\.com[:/]+([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (!m) fail(`Could not parse GitHub owner/repo from origin URL: ${url}`);
  return { owner: m[1], repo: m[2] };
}
let originUrl;
try {
  originUrl = run('git remote get-url origin');
} catch {
  fail('No "origin" git remote found.');
}
const { owner, repo } = parseRepo(originUrl);

console.log(`Releasing ${productName} ${tag}  ->  ${owner}/${repo}`);

// ---- sanity checks -------------------------------------------------------
const branch = run('git rev-parse --abbrev-ref HEAD');
const dirty = run('git status --porcelain');
if (dirty) {
  console.warn('! Working tree has uncommitted changes; they will NOT be included in the release commit.');
}

// Make sure the commit being released exists on the remote.
console.log(`Pushing ${branch} to origin…`);
try {
  execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: 'inherit' });
} catch {
  fail('git push failed — resolve that first, then re-run.');
}
const sha = run('git rev-parse HEAD');

// ---- build the installer -------------------------------------------------
if (doBuild) {
  console.log('Building installer (npm run dist)…');
  execSync('npm run dist', { cwd: ROOT, stdio: 'inherit' });
} else {
  console.log('Skipping build (--no-build).');
}

// Locate the built installer.
const expected = path.join(ROOT, 'dist', `${productName} Setup ${version}.exe`);
let assetPath = expected;
if (!fs.existsSync(assetPath)) {
  const found = fs.existsSync(path.join(ROOT, 'dist'))
    ? fs.readdirSync(path.join(ROOT, 'dist')).find((f) => /Setup .*\.exe$/.test(f))
    : null;
  if (!found) fail(`Installer not found. Expected: ${expected}`);
  assetPath = path.join(ROOT, 'dist', found);
}
const assetName = `${productName.replace(/\s+/g, '')}-Setup-${version}.exe`;
const sizeMB = (fs.statSync(assetPath).size / 1048576).toFixed(1);
console.log(`Installer: ${path.basename(assetPath)} (${sizeMB} MB) -> upload as ${assetName}`);

// ---- release notes -------------------------------------------------------
let notes;
if (notesFile) {
  notes = fs.readFileSync(path.resolve(ROOT, notesFile), 'utf-8');
} else if (fs.existsSync(path.join(ROOT, 'RELEASE_NOTES.md'))) {
  notes = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf-8');
} else {
  notes = [
    pkg.description || `${productName} ${tag}`,
    '',
    '## Install',
    `1. Download **${assetName}** below.`,
    '2. Run it. Because the app isn\'t code-signed, Windows SmartScreen may show a',
    '   *"Windows protected your PC"* prompt — click **More info → Run anyway**.',
    '3. Follow the installer; it adds Start Menu and desktop shortcuts.',
    '',
    '_Windows 64-bit. Unsigned build — the SmartScreen warning on first run is normal._'
  ].join('\n');
}

// ---- GitHub token from Git Credential Manager ----------------------------
function githubToken() {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf-8'
  });
  const m = out.match(/^password=(.*)$/m);
  if (!m) fail('Could not obtain a GitHub token from Git Credential Manager. Try `git push` once to sign in.');
  return m[1];
}
const token = githubToken();

const api = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': `${repo}-release-script`
};

// ---- create release + upload asset --------------------------------------
(async () => {
  const existing = await fetch(`${api}/repos/${owner}/${repo}/releases/tags/${tag}`, { headers });
  if (existing.ok) {
    const e = await existing.json();
    fail(`A release for ${tag} already exists: ${e.html_url}\nBump "version" in package.json (or delete that release) and re-run.`);
  }

  console.log(`Creating release ${tag}…`);
  const createRes = await fetch(`${api}/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: sha,
      name: `${productName} ${tag}`,
      body: notes,
      draft: isDraft,
      prerelease: isPrerelease
    })
  });
  const rel = await createRes.json();
  if (!createRes.ok) fail(`Create failed (${createRes.status}): ${JSON.stringify(rel)}`);
  console.log(`  release id ${rel.id}`);

  console.log(`Uploading ${assetName} (${sizeMB} MB)…`);
  const file = fs.readFileSync(assetPath);
  const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(assetName)}`;
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/octet-stream' },
    body: file
  });
  const asset = await upRes.json();
  if (!upRes.ok) fail(`Upload failed (${upRes.status}): ${JSON.stringify(asset)}`);

  console.log('\n✓ Release published');
  console.log(`  ${rel.html_url}`);
  console.log(`  download: ${asset.browser_download_url}`);
})().catch((e) => fail(e.message));
