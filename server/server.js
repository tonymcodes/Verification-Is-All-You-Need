// THE SAMPLE SERVER. It runs the three hosts of the sample, all together or each on its own:
//   node server/server.js                                 all three on one computer, port 8800 (npm start)
//   node server/server.js sign-in 8801                    the organisations' sign-in (mocked): work ID in, role pass out
//   node server/server.js owner 8802 <sign-in address>    the owner's server: the motor department runs the car purchase
//   node server/server.js middle 8803 <sign-in address>   an Agent Middleground: a sealed tender runs there
// In real use each is a separate server, run by a separate organisation. Each also hands out the try pages, so a page
// can be opened from any of them; on its own, the owner's and the middle ground's server open their page at "/".
// Settings:  MIMIC=off  only real fingerprints count;  TLS_CERT and TLS_KEY  speak https (needed on other machines:
// a browser lets a page make and check signatures only over https, or on localhost);  PORT  instead of the port above.
// Needs only Node 18 or newer. No packages to install.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path');
globalThis.MG = globalThis.MG || {};
for (const f of ['core/stamp.js', 'core/swipe.js', 'core/workflow.js', 'server/orgs.js', 'server/owner.js', 'server/middle.js']) require(path.join(__dirname, '..', f));
const ROOT = path.join(__dirname, '..'), args = process.argv.slice(2);
const PART = ['sign-in', 'owner', 'middle'].includes(args[0]) ? args[0] : 'all';
const PORT = Number(PART === 'all' ? args[0] : args[1]) || Number(process.env.PORT) || 8800;
const SIGN_IN = (args[2] || '').replace(/\/$/, '');
const allowMimic = process.env.MIMIC !== 'off';
const TLS = process.env.TLS_CERT && process.env.TLS_KEY ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) } : null;
const template = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', f), 'utf8'));
const runs = part => PART === 'all' || PART === part;

// What the organisations publish: open keys, signed role lists and signed workflows. The owner's server and the middle
// ground read it from the sign-in server when they run on their own. (In real use each organisation publishes its own,
// on its own https address.)
let orgs, owner, middle, published;
async function setUp() {
  if (runs('sign-in')) {
    orgs = await MG.orgs.create([template('car-registration.json'), template('bridge-tender.json')]);
    published = { keys: orgs.trust, roleLists: orgs.roleLists, workflows: orgs.workflows };
  } else {
    if (!SIGN_IN) throw new Error('Give the address of the sign-in server, such as: node server/server.js ' + PART + ' ' + PORT + ' http://localhost:8801');
    published = await (await fetch(SIGN_IN + '/orgs/api/published')).json();
  }
  if (runs('owner')) await freshOwner();
  if (runs('middle')) await freshMiddle();
}
const freshOwner = async () => { owner = await MG.owner.create({ trust: published.keys, roleLists: published.roleLists, workflow: published.workflows['car-registration'], allowMimic }); };
const freshMiddle = async () => { middle = await MG.middle.create({ trust: published.keys, roleLists: published.roleLists, workflow: published.workflows['bridge-tender'], allowMimic }); };

const ROUTES = {
  'sign-in': {
    'GET /orgs/api/people': () => ({ ok: true, people: orgs.people() }),
    'GET /orgs/api/published': () => ({ ok: true, ...published }),
    'GET /orgs/api/keys': () => ({ ok: true, keys: orgs.trust }),
    'POST /orgs/api/sign-in': b => orgs.signIn(b.org, b.id, b.passkey || null),
  },
  owner: {
    'GET /owner/api/workflow': () => ({ ok: true, workflow: owner.workflow }),
    'POST /owner/api/start': b => owner.start(b.pass, b.parties),
    'POST /owner/api/inbox': b => owner.inbox(b.pass),
    'POST /owner/api/approve': b => owner.approve(b.pass, b.items, b.swipes),
    'POST /owner/api/file': b => owner.file(b.pass, b.case),
    'GET /owner/api/receipts': () => owner.receipts(),
    'POST /owner/api/start-again': async () => { await freshOwner(); return { ok: true }; },
  },
  middle: {
    'GET /middle/api/status': () => ({ ...middle.status(), holds: middle.holds(), key: middle.key, name: middle.name }),
    'GET /middle/api/workflow': () => ({ ok: true, workflow: middle.workflow }),
    'POST /middle/api/bid': b => middle.bid(b.pass, b.details, b.swipes),
    'POST /middle/api/close': b => middle.close(b.pass),
    'POST /middle/api/view': b => middle.view(b.pass),
    'POST /middle/api/approve': b => middle.approve(b.pass, b.swipes),
    'POST /middle/api/token': b => middle.token(b.pass),
    'POST /middle/api/start-again': async () => { await freshMiddle(); return { ok: true }; },
  },
};
const routes = Object.assign({ 'GET /api/about': () => ({ ok: true, part: PART, allowMimic, signIn: SIGN_IN || null }) }, ...Object.keys(ROUTES).filter(runs).map(p => ROUTES[p]));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
// Every answer may be read by a page from another server (each part can run on its own address).
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' }); res.end(body); };
// "/" opens the page for this part: all samples, the car purchase on the owner's server, the tender in the middle ground.
// Run on its own, the page is told where the sign-in server is.
const front = () => PART === 'owner' ? '/pages/car.html?signin=' + encodeURIComponent(SIGN_IN) : PART === 'middle' ? '/pages/tender.html?signin=' + encodeURIComponent(SIGN_IN) : PART === 'sign-in' ? '/orgs/api/people' : '/pages/index.html';

async function answer(req, res) {
  const url = decodeURIComponent(req.url.split('?')[0]), route = routes[req.method + ' ' + url];
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (route) {
    let raw = '';
    req.on('data', d => { raw += d; if (raw.length > 65536) req.destroy(); });
    req.on('end', async () => {
      try { send(res, 200, JSON.stringify(await route(raw ? JSON.parse(raw) : {}))); }
      catch (e) { send(res, 400, JSON.stringify({ ok: false, why: 'the request could not be read' })); }
    });
    return;
  }
  if (req.method !== 'GET') return send(res, 404, JSON.stringify({ ok: false, why: 'no such address here' }));
  if (url === '/') { res.writeHead(302, { Location: front() }); return res.end(); }
  const file = path.normalize(path.join(ROOT, url));
  const inside = ['pages', 'core', 'workflows'].some(d => file.startsWith(path.join(ROOT, d) + path.sep));
  if (!inside || !TYPES[path.extname(file)] || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
  send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)]);
}
const server = TLS ? https.createServer(TLS, answer) : http.createServer(answer);

if (require.main === module) setUp().then(() => server.listen(PORT, () => {
  const at = (TLS ? 'https' : 'http') + '://localhost:' + PORT;
  console.log({ all: 'Verified workflows sample, all three hosts: ', 'sign-in': 'The organisations’ sign-in: ', owner: 'The owner’s server (the car purchase): ', middle: 'The middle ground (the sealed tender): ' }[PART] + at);
  if (PART === 'all') console.log('  the car purchase:   ' + at + '/pages/car.html\n  the sealed tender:  ' + at + '/pages/tender.html');
  if (!allowMimic) console.log('  MIMIC=off: only real fingerprints count');
})).catch(e => { console.error(e.message); process.exit(1); });
module.exports = { server, setUp, routes };
