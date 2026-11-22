// Checks that only the right person, in the right role, with their own swipe, can approve each part, that every
// approval and refusal is recorded, and that a sealed tender's bids never leave the middle ground.
// Run with:  npm test
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
globalThis.MG = {};
const ROOT = path.join(__dirname, '..');
for (const f of ['core/stamp.js', 'core/swipe.js', 'core/workflow.js', 'server/orgs.js', 'server/owner.js', 'server/middle.js']) require(path.join(ROOT, f));
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'workflows', f), 'utf8'));
const TEMPLATES = [read('car-registration.json'), read('bridge-tender.json')];
let done = 0; const ok = name => { done++; console.log('ok  ' + name); };

// The sample's stand-in for a fingerprint: the person ticked the box for the list on the screen.
const tick = list => Object.fromEntries(list.map(p => [p, MG.swipe.mimic(list.length)]));
// A real device, played by a key made here, signing the way a phone's secure chip signs a passkey approval.
const wc = require('crypto').webcrypto;
const b64 = u => Buffer.from(u).toString('base64'), b64url = u => Buffer.from(u).toString('base64url');
const sha = async x => new Uint8Array(await wc.subtle.digest('SHA-256', typeof x === 'string' ? new TextEncoder().encode(x) : x));
const der = raw => { const int = v => { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; v = v.slice(i); return v[0] & 0x80 ? [0, ...v] : [...v]; }; const r = int(raw.slice(0, 32)), s = int(raw.slice(32)); return Uint8Array.from([0x30, r.length + s.length + 4, 2, r.length, ...r, 2, s.length, ...s]); };
async function chip() {
  const k = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']), key = b64(new Uint8Array(await wc.subtle.exportKey('spki', k.publicKey)));
  return { key, async swipe(holder, list) {
    const at = new Date().toISOString(), salts = list.map((_, n) => 'salt' + n + Math.random());
    const codes = await Promise.all(list.map((p, n) => MG.swipe.codeOf(p, salts[n]))), ch = b64url(await MG.swipe.challenge(holder, at, codes));
    const cd = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: ch, origin: 'http://localhost:8800' }));
    const ad = new Uint8Array(37); ad.set(await sha('localhost')); ad[32] = 5;
    const data = new Uint8Array(ad.length + 32); data.set(ad); data.set(await sha(cd), ad.length);
    const sig = der(new Uint8Array(await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, data)));
    return Object.fromEntries(list.map((p, n) => [p, { how: 'device', at, key, alg: -7, authData: b64(ad), clientData: b64(cd), sig: b64(sig), codes, salt: salts[n] }]));
  } };
}

async function setup(opts = {}) {
  const orgs = await MG.orgs.create(TEMPLATES);
  const owner = await MG.owner.create({ trust: orgs.trust, roleLists: orgs.roleLists, workflow: orgs.workflows['car-registration'], ...opts });
  const sign = async (org, id, passkey) => (await orgs.signIn(org, id, passkey)).pass;
  const P = { meera: await sign('Sunrise Motors', 'SM-104'), arjun: await sign('Lotus Insurance', 'LI-220'), kavya: await sign('Northbank', 'NB-311'),
    anita: await sign('Motor Department', 'MD-017'), ravi: await sign('Sample agent provider', 'Ravi Kumar') };
  // One person's screen: approve a list of waiting steps, with the details they add, under one swipe.
  const approve = async (pass, picks, how) => {
    const box = await owner.inbox(pass), items = [], purposes = [];
    for (const [step, typed] of picks) {
      const w = box.waiting.find(x => x.step === step) || { case: 'CAR-0001', step, basis: {} }, s = MG.flow.step(owner.workflow, step);
      const details = s.adds ? MG.flow.clean(s, typed) || typed : {};
      items.push({ case: w.case, step, details });
      purposes.push(await MG.flow.purpose(w.case, step, details, w.basis));
    }
    return owner.approve(pass, items, how ? await how(await MG.pass.holder(pass), purposes) : tick(purposes));
  };
  return { orgs, owner, P, sign, approve };
}
const PARTIES = { buyer: 'Ravi Kumar', insurer: 'Lotus Insurance', bank: 'Northbank' };

async function workflows() {
  const orgs = await MG.orgs.create(TEMPLATES), owner = orgs.owner('Motor Department'), w = orgs.workflows['car-registration'];
  assert.strictEqual(w.owner, 'Motor Department', 'the party marked "owns" publishes it');
  assert.deepStrictEqual(await MG.flow.check(w, owner.open), { ok: true });
  const changed = { ...w, steps: w.steps.filter(s => s.id !== 'policy') };
  assert.match((await MG.flow.check(changed, owner.open)).why, /changed/);
  const copied = await MG.flow.publish({ ...orgs.owner('Northbank'), name: 'Motor Department' }, read('car-registration.json'));
  assert.match((await MG.flow.check(copied, owner.open)).why, /not published by its owner/);
  await assert.rejects(MG.owner.create({ trust: orgs.trust, roleLists: orgs.roleLists, workflow: changed }), /does not check/, 'a server will not run a changed workflow');
  ok('a published workflow checks; a changed copy or one signed by someone else does not');
}

async function passes() {
  const orgs = await MG.orgs.create();
  const p = (await orgs.signIn('Northbank', 'NB-311')).pass;
  assert.strictEqual(p.role, 'Loan officer');
  assert((await MG.pass.check(p, orgs.trust)).ok);
  assert.match((await orgs.signIn('Northbank', 'NB-999')).why, /not in Northbank/);
  const fake = await MG.pass.issue({ name: 'Northbank', secret: (await MG.stamp.newKey()).secret }, { person: 'Kavya Iyer', role: 'Loan officer' });
  assert.match((await MG.pass.check(fake, orgs.trust)).why, /not signed by Northbank/);
  const unknown = await MG.pass.issue({ name: 'Nortbank Ltd', secret: (await MG.stamp.newKey()).secret }, { person: 'X', role: 'Loan officer' });
  assert.match((await MG.pass.check(unknown, orgs.trust)).why, /not known here/);
  const old = { ...p, goodUntil: new Date(Date.now() - 1000).toISOString() };
  assert.match((await MG.pass.check(old, orgs.trust)).why, /not signed|run out/);
  ok('sign in with a work ID gives a role pass; a forged or unknown organisation’s pass is refused');
}

async function carPurchase() {
  const { owner, P, approve } = await setup();
  assert((await owner.start(P.meera, PARTIES)).ok);
  assert.match((await owner.start(P.kavya, PARTIES)).why, /only a Sales manager/);
  assert((await approve(P.meera, [['price', { car: 'Hatchback, blue', price: '9,20,000' }]])).ok);
  // The buyer sees two steps. The small one can go in a list; the important one needs a screen of its own.
  let box = await owner.inbox(P.ravi);
  assert.deepStrictEqual(box.waiting.map(x => x.step).sort(), ['order', 'share']);
  assert.deepStrictEqual(box.waiting.find(x => x.step === 'order').basis, { price: { car: 'Hatchback, blue', price: 920000 } });
  let r = await approve(P.ravi, [['order', {}], ['share', {}]]);
  assert(!r.results[0].ok && /screen of its own/.test(r.results[0].why) && r.results[1].ok);
  assert((await approve(P.ravi, [['order', {}]])).ok);
  assert((await approve(P.arjun, [['policy', { policy: 'LI-7781', premium: 24500 }]])).ok);
  assert((await approve(P.kavya, [['loan', { loan: 700000, years: '5' }]])).ok);
  assert((await approve(P.ravi, [['accept', {}]])).ok);
  assert((await approve(P.kavya, [['pay', {}]])).ok);
  assert((await approve(P.anita, [['register', { number: 'KL-07-CX-4410' }]])).ok);
  const f = await owner.file(P.ravi, 'CAR-0001');
  assert(f.case.steps.every(s => s.state === 'done'));
  assert.strictEqual(f.case.steps.find(s => s.id === 'register').approvals[0].role, 'Registration officer');
  ok('a car purchase: five parties, eight steps, each approved by the right person in the right role');
  // THE DATA IS SHOWN to every party of the case, and to nobody else.
  for (const p of [P.meera, P.arjun, P.kavya, P.anita]) assert((await owner.file(p, 'CAR-0001')).ok);
  const outsider = await setup();
  assert.match((await owner.file(await outsider.orgs.signIn('Sunrise Motors', 'SM-104').then(x => x.pass), 'CAR-0001')).why, /not signed|parties/);
  ok('every party sees the whole case file; others do not');
  // THE LOG: chained public receipts; each party's copy of an entry matches its receipt.
  const rec = await owner.receipts();
  assert((await MG.log.verify(rec.receipts)).ok);
  for (const e of f.entries) assert(await MG.log.matches(e, rec.receipts[e.n - 1]));
  assert(!JSON.stringify(rec.receipts).includes('Hatchback') && !JSON.stringify(rec.receipts).includes('920000'));
  const cut = rec.receipts.filter(x => x.n !== 3);
  assert.match((await MG.log.verify(cut)).why, /does not follow/);
  const edited = rec.receipts.map(x => x.n === 2 ? { ...x, what: 'edited' } : x);
  assert.match((await MG.log.verify(edited)).why, /changed/);
  assert(!await MG.log.matches({ ...f.entries[1], details: { car: 'Saloon', price: 1 } }, rec.receipts[f.entries[1].n - 1]));
  ok('public receipts show only fingerprints; removing or changing an entry breaks the chain');
}

async function refusals() {
  const { orgs, owner, P, approve } = await setup();
  await owner.start(P.meera, PARTIES);
  await approve(P.meera, [['price', { car: 'Hatchback', price: 920000 }]]);
  // A real employee, the wrong part.
  let r = await approve(P.meera, [['share', {}]]);
  assert(!r.ok && /not Meera Shah, Sales manager, Sunrise Motors’s part/.test(r.results[0].why));
  // A stranger with a pass that only claims to be Northbank's.
  const fake = await MG.pass.issue({ name: 'Northbank', secret: (await MG.stamp.newKey()).secret }, { person: 'Kavya Iyer', role: 'Loan officer' });
  r = await owner.approve(fake, [{ case: 'CAR-0001', step: 'loan', details: { loan: 900000, years: '5' } }], {});
  assert(!r.ok && /not signed by Northbank/.test(r.results[0].why));
  // Before its time.
  r = await approve(P.kavya, [['pay', {}]]);
  assert(/not done yet/.test(r.results[0].why));
  // A swipe for other details: the buyer saw one price, the request carries another.
  const box = await owner.inbox(P.ravi), w = box.waiting.find(x => x.step === 'order');
  const shown = await MG.flow.purpose(w.case, 'order', {}, w.basis), other = await MG.flow.purpose(w.case, 'order', {}, { price: { car: 'Hatchback', price: 1 } });
  r = await owner.approve(P.ravi, [{ case: w.case, step: 'order', details: {} }], { [shown]: undefined, [other]: MG.swipe.mimic(1) });
  assert(!r.ok && /not sent|different/.test(r.results[0].why));
  // Every refusal is in the log and shown to the parties as an alert.
  const f = await owner.file(P.ravi, 'CAR-0001');
  assert(f.case.alerts.length >= 3 && f.case.alerts.some(a => /not signed by Northbank/.test(a.why)));
  assert((await owner.receipts()).receipts.filter(x => x.what === 'refusal').length >= 3);
  ok('the wrong role, a forged pass, a step before its time and a swipe for other details are refused and recorded');
}

async function fingerprints() {
  const phone = await chip(), other = await chip();
  const { owner, P, sign, approve } = await setup();
  const meera = await sign('Sunrise Motors', 'SM-104', phone.key);
  await owner.start(meera, PARTIES);
  let r = await approve(meera, [['price', { car: 'Hatchback', price: 920000 }]]);
  assert(!r.ok && /fingerprint on their own device/.test(r.results[0].why));
  r = await approve(meera, [['price', { car: 'Hatchback', price: 920000 }]], other.swipe);
  assert(!r.ok && /device the pass does not name/.test(r.results[0].why));
  r = await approve(meera, [['price', { car: 'Hatchback', price: 920000 }]], phone.swipe);
  assert(r.ok);
  // Anyone in the case can check the approval again later: the pass, and the device's own signature.
  const a = (await owner.file(P.ravi, 'CAR-0001')).case.steps[0].approvals[0];
  const purpose = await MG.flow.purpose('CAR-0001', 'price', a.details, {});
  assert((await MG.swipe.check({ how: 'device', ...a.swipe }, await MG.pass.holder(a.pass), purpose, Date.parse(a.swipe.at))).ok && a.swipe.key === a.pass.passkey);
  // A pass that names no device cannot carry a fingerprint, and with MIMIC=off a tick counts for nothing.
  r = await approve(P.ravi, [['share', {}]], phone.swipe);
  assert(/names no device/.test(r.results[0].why));
  const strict = await setup({ allowMimic: false });
  await strict.owner.start(strict.P.meera, PARTIES);
  assert(/only when trying the sample/.test((await strict.approve(strict.P.meera, [['price', { car: 'X', price: 1 }]])).results[0].why));
  // The same approval cannot be used twice.
  const used = new Set(), pass = P.ravi, holder = await MG.pass.holder(pass), sw = MG.swipe.mimic(1);
  assert((await MG.flow.checkSwipe({ pass, holder, purpose: 'p', swipe: sw, allowMimic: true, used })).ok);
  assert(/already used/.test((await MG.flow.checkSwipe({ pass, holder, purpose: 'p', swipe: sw, allowMimic: true, used })).why));
  ok('a fingerprint counts only from the device named in the pass, can be checked again, and is used once');
}

async function tender() {
  const orgs = await MG.orgs.create(TEMPLATES), mg = await MG.middle.create({ trust: orgs.trust, roleLists: orgs.roleLists, workflow: orgs.workflows['bridge-tender'] });
  const pass = async (org, id) => (await orgs.signIn(org, id)).pass;
  const B = { hb: await pass('Harbour Build', 'HB-9'), rc: await pass('Ridge Constructions', 'RC-4'), dw: await pass('Delta Works', 'DW-2') };
  const C = [await pass('City Works Office', 'CW-01'), await pass('City Works Office', 'CW-02'), await pass('City Works Office', 'CW-03')];
  const BIDS = { hb: { price: 48.5, turnover: 213.7, licence: 'Class A', projects: 4 }, rc: { price: 45.2, turnover: 164.3, licence: 'Class A', projects: 2 }, dw: { price: 41.7, turnover: 87.9, licence: 'Class A', projects: 3 } };
  const bid = async k => { const d = MG.flow.clean(MG.flow.step(mg.workflow, 'bid'), BIDS[k]), p = await MG.flow.purpose('TENDER-1', 'bid', d, {}); return mg.bid(B[k], BIDS[k], tick([p])); };
  const approve = async c => { const v = await mg.view(c), p = await MG.flow.purpose('TENDER-1', 'result', { winner: v.winner }, { scores: v.scores }); return mg.approve(c, tick([p])); };
  // Values that must never leave, except the winner's price once announced. Times and signatures are left out of the search.
  const plain = x => JSON.stringify(x, (k, v) => ['at', 'stamp', 'key', 'receipts'].includes(k) ? undefined : v);
  const never = (what, x, allow = []) => { const s = plain(x); for (const v of ['48.5', '45.2', '41.7', '213.7', '164.3', '87.9'].filter(v => !allow.includes(v))) assert(!s.includes(v), what + ' leaked ' + v); };

  for (const k of ['hb', 'rc', 'dw']) assert((await bid(k)).ok);
  assert.match((await bid('hb')).why, /already submitted/);
  assert.match((await mg.bid(C[0], BIDS.hb, {})).why, /only a company’s Authorised signatory/);
  never('the public status', mg.status());
  assert.strictEqual(mg.status().sealedBids, 3);
  assert.match((await mg.view(C[0])).why, /sealed until the deadline/);
  assert.match((await mg.close(B.hb)).why, /only the evaluation committee/);
  ok('a sealed tender: three bids, each with its signatory’s swipe; nobody can read them before the deadline');

  assert((await mg.close(C[0])).ok);
  const v = await mg.view(C[1]);
  never('the committee’s view', v);
  assert.deepStrictEqual(v.scores.map(x => [x.company, x.score, x.eligible]), [['Harbour Build', 89, true], ['Ridge Constructions', 82, true], ['Delta Works', 0, false]]);
  assert.match(v.scores[2].reasons[0], /turnover below/);
  assert.match((await mg.view(B.rc)).why, /only the evaluation committee/);
  ok('at the deadline the published rules score the bids; the committee sees scores, never prices or accounts');

  let r = await approve(C[0]);
  assert(r.ok && !r.decided);
  assert.match((await approve(C[0])).why, /already approved/);
  assert.match((await mg.token(B.rc)).why, /not out yet/);
  r = await approve(C[2]);
  assert(r.decided);
  assert.deepStrictEqual([mg.status().result.winner, mg.status().result.price], ['Harbour Build', 48.5]);
  never('the public result', mg.status(), ['48.5']);
  for (const k of ['hb', 'rc', 'dw']) {
    const t = (await mg.token(B[k])).token;
    assert.strictEqual(t.for, B[k].by);
    assert(await MG.stamp.check(mg.key, MG.wordsOf(t), t.stamp));
    never(B[k].by + '’s token', t, ['48.5']);
  }
  assert.strictEqual((await mg.token(B.dw)).token.eligible, false);
  assert.strictEqual(mg.holds().bids, 0);
  ok('two of three approve; each company takes back only its own score; the bids are wiped');
}

async function overHttp() {
  const { server, setUp } = require(path.join(ROOT, 'server', 'server.js'));
  await setUp();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const call = (method, url, body) => new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method, headers: { 'Content-Type': 'application/json' } }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res({ code: r.statusCode, s })); });
    req.on('error', rej); req.end(body ? JSON.stringify(body) : undefined);
  });
  const pass = JSON.parse((await call('POST', '/orgs/api/sign-in', { org: 'Sunrise Motors', id: 'SM-104' })).s).pass;
  assert(JSON.parse((await call('POST', '/owner/api/start', { pass, parties: PARTIES })).s).ok);
  assert.strictEqual((await call('GET', '/')).code, 302, 'the front door leads to the samples');
  for (const page of ['/pages/index.html', '/pages/car.html', '/pages/tender.html', '/pages/ui.js', '/core/workflow.js']) assert.strictEqual((await call('GET', page)).code, 200, page);
  assert.strictEqual((await call('GET', '/server/orgs.js')).code, 404);
  assert.strictEqual((await call('GET', '/../package.json')).code, 404);
  server.close();
  ok('the server answers, hands out the pages, and nothing outside them');
}

// THE THREE HOSTS APART: the sign-in, the owner's server and the middle ground, each its own server on its own port,
// as on separate machines. The owner's server and the middle ground read the published keys, role lists and workflows
// from the sign-in server; a page on any of them can call the others.
async function apart() {
  const { spawn } = require('child_process'), kids = [];
  const up = (...a) => new Promise((go, fail) => { const c = spawn(process.execPath, ['server/server.js', ...a], { cwd: ROOT }); kids.push(c); c.stdout.once('data', () => go(c)); c.once('exit', n => fail(new Error('server ' + a.join(' ') + ' stopped: ' + n))); });
  try {
    await up('sign-in', '8821'); await up('owner', '8822', 'http://localhost:8821'); await up('middle', '8823', 'http://localhost:8821');
    const post = (port, url, body) => fetch('http://localhost:' + port + url, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
    const sign = async (org, id) => (await post(8821, '/orgs/api/sign-in', { org, id })).pass;
    const meera = await sign('Sunrise Motors', 'SM-104'), ravi = await sign('Sample agent provider', 'Ravi Kumar');
    const opened = await post(8822, '/owner/api/start', { pass: meera, parties: PARTIES });
    assert(opened.ok, 'the owner’s server trusts the passes the sign-in server signed');
    const w = (await (await fetch('http://localhost:8822/owner/api/workflow')).json()).workflow, s = MG.flow.step(w, 'price'), d = MG.flow.clean(s, { car: 'Hatchback', price: '920000' });
    const purpose = await MG.flow.purpose(opened.case, 'price', d, {});
    assert((await post(8822, '/owner/api/approve', { pass: meera, items: [{ case: opened.case, step: 'price', details: d }], swipes: tick([purpose]) })).ok);
    assert.deepStrictEqual((await post(8822, '/owner/api/inbox', { pass: ravi })).waiting.map(x => x.step).sort(), ['order', 'share']);
    const hb = await sign('Harbour Build', 'HB-9'), bid = { price: 48.5, turnover: 213.7, licence: 'Class A', projects: 4 }, bp = await MG.flow.purpose('TENDER-1', 'bid', MG.flow.clean({ adds: { price: 'amount', turnover: 'amount', licence: 'text', projects: 'amount' } }, bid), {});
    assert((await post(8823, '/middle/api/bid', { pass: hb, details: bid, swipes: tick([bp]) })).ok, 'the middle ground trusts them too');
    assert.strictEqual((await fetch('http://localhost:8822/orgs/api/sign-in', { method: 'POST', body: '{}' })).status, 404, 'each server answers only for its own part');
    const front = await fetch('http://localhost:8822/', { redirect: 'manual' });
    assert.strictEqual(front.headers.get('location'), '/pages/car.html?signin=' + encodeURIComponent('http://localhost:8821'), 'the owner’s server opens its page, told where the sign-in is');
    assert.strictEqual((await fetch('http://localhost:8823/middle/api/status')).headers.get('access-control-allow-origin'), '*', 'a page on another server may call it');
    ok('the three hosts apart: sign-in, owner’s server and middle ground on their own servers, each trusting what the organisations published');
  } finally { for (const k of kids) k.kill(); }
}

(async () => {
  for (const t of [workflows, passes, carPurchase, refusals, fingerprints, tender, overHttp, apart]) await t();
  console.log('\nAll ' + done + ' checks passed.');
})().catch(e => { console.error(e); process.exit(1); });
