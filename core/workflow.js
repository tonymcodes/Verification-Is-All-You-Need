// WORKFLOWS WITH HUMANS IN THE LOOP. The small core shared by the owner's server, the middle ground and the pages.
//
//   workflow   Published rules for a process that crosses people and organisations: the parties, the steps, who
//              approves each step, and what each step adds. Its owner signs it. Its id is a fingerprint of its
//              content, so it can be copied and adapted like a template, and a changed copy never passes as the original.
//   role pass  An organisation's signed note, made when a person signs in with their work ID: "this person holds this
//              role here, and approves with the passkey of this device". A private person gets a person pass the same
//              way from their personal agent's provider.
//   approval   One step of one case, approved by the person in that role with their own fingerprint swipe. The swipe
//              is signed over the exact details: the step, the case, what the step adds, and what it rests on.
//   log        Every approval and refusal is written down. Each entry holds the fingerprint of the one before, so an
//              entry cannot be removed or changed without breaking the chain. The public sees only fingerprints.
//
// The fingerprint swipe itself is core/swipe.js and the signatures are core/stamp.js, both copied unchanged from the
// Agent Middleground Protocol (AMP) repo. The same file runs on the server and in a web page.
(function (root) {
  const MG = root.MG;
  const DAY = 86400000;
  const text = (v, n) => String(v == null ? '' : v).slice(0, n || 120);
  const hex = async t => {
    const subtle = (root.crypto && root.crypto.subtle) || (typeof window === 'undefined' ? require('crypto').webcrypto.subtle : undefined);   // a web page gets it only over https or on localhost
    return [...new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
  };

  MG.flow = {
    // A WORKFLOW'S ID: a fingerprint of everything in it except its id and its stamp.
    async id(w) { const { id, stamp, ...rest } = w; return 'wf-' + (await hex(MG.wordsOf(rest))).slice(0, 16); },
    // The owner publishes a workflow: it names itself, adds its open key and signs.
    async publish(owner, w) {
      const out = { ...w, owner: owner.name, ownerKey: owner.open };
      out.id = await MG.flow.id(out);
      out.stamp = await MG.stamp.make(owner.secret, MG.wordsOf(out));
      return out;
    },
    // Anyone checks a published workflow against the owner's key they already know.
    async check(w, ownerKey) {
      if (!w || !w.stamp) return { ok: false, why: 'it is not a published workflow' };
      if (w.id !== await MG.flow.id(w)) return { ok: false, why: 'the workflow was changed after it was published' };
      if (ownerKey && w.ownerKey !== ownerKey) return { ok: false, why: 'the workflow was not published by its owner' };
      return await MG.stamp.check(w.ownerKey, MG.wordsOf(w), w.stamp) ? { ok: true } : { ok: false, why: 'the owner’s signature does not match' };
    },
    // WHO MAY ACT: which roles each organisation allows in which workflow, read from its signed role list. A list whose
    // signature does not match the organisation's open key is ignored. Gives allows(org, role, workflowName).
    async roles(roleLists, trust) {
      const ok = {};
      for (const [org, l] of Object.entries(roleLists || {})) if (trust[org] && l.by === org && await MG.stamp.check(trust[org], MG.wordsOf(l), l.stamp)) ok[org] = l.roles;
      return (org, role, name) => !!(ok[org] && ok[org][role] && ok[org][role].includes(name));
    },
    // The organisation that owns a workflow: the party marked "owns", with its name.
    ownerOf(w) { const p = Object.values(w.parties || {}).find(x => x.owns); return p && p.name; },
    step(w, id) { return (w.steps || []).find(s => s.id === id); },
    // Everything a step rests on: the steps it comes after, and the ones they come after, in workflow order.
    before(w, id) {
      const seen = new Set(), walk = s => (MG.flow.step(w, s).after || []).forEach(a => { if (!seen.has(a)) { seen.add(a); walk(a); } });
      walk(id);
      return w.steps.map(s => s.id).filter(s => seen.has(s));
    },
    // The details a person sees and signs when they approve a step: what the earlier steps added.
    basis(w, kase, id) {
      const out = {};
      for (const s of MG.flow.before(w, id)) { const a = kase.steps[s]; if (a && a[0]) out[s] = a[0].details; }
      return out;
    },
    // What a swipe approves, written as one line. It covers the case, the step, the details and the basis.
    async purpose(caseId, stepId, details, basis) {
      return 'approve:' + caseId + ':' + stepId + ':' + (await hex(MG.wordsOf({ details: details || {}, basis: basis || {} }))).slice(0, 32);
    },
    // What a step adds, cleaned: only the fields the workflow names, as short text or as numbers.
    clean(step, details) {
      const out = {};
      for (const [k, kind] of Object.entries(step.adds || {})) {
        const v = details && details[k];
        if (v == null || String(v).trim() === '') return null;
        if (kind === 'amount') { const n = Number(String(v).replace(/[, ]/g, '')); if (!(n >= 0) || !isFinite(n)) return null; out[k] = n; }
        else out[k] = text(v).trim();
      }
      return out;
    },
  };

  MG.pass = {
    // An organisation (or a personal agent's provider) signs a pass for one person.
    // fields: { person, workId?, role?, passkey? }. A role pass names a role; a person pass names none.
    async issue(org, fields, days) {
      const now = Date.now();
      const p = { kind: fields.role ? 'role pass' : 'person pass', by: org.name, person: text(fields.person, 80),
        ...(fields.workId ? { workId: text(fields.workId, 40) } : {}), ...(fields.role ? { role: text(fields.role, 60) } : {}),
        passkey: fields.passkey || null, issued: new Date(now).toISOString(), goodUntil: new Date(now + (days || 1) * DAY).toISOString() };
      p.stamp = await MG.stamp.make(org.secret, MG.wordsOf(p));
      return p;
    },
    // trust: { 'Northbank': openKey, ... }, the organisations this checker knows.
    async check(p, trust, now) {
      if (!p || typeof p !== 'object' || !p.stamp) return { ok: false, why: 'no pass was shown' };
      const key = trust && trust[p.by];
      if (!key) return { ok: false, why: 'the pass comes from “' + text(p.by, 60) + '”, which is not known here' };
      if (!await MG.stamp.check(key, MG.wordsOf(p), p.stamp)) return { ok: false, why: 'the pass is not signed by ' + text(p.by, 60) + ' (a copied name or a forged pass)' };
      if (Date.parse(p.goodUntil) < (now || Date.now())) return { ok: false, why: 'the pass has run out; sign in again' };
      return { ok: true };
    },
    // Who a swipe is for: a fingerprint of the whole pass, so a swipe for one pass cannot be used with another.
    async holder(p) { return 'pass-' + (await hex(MG.wordsOf(p))).slice(0, 32); },
    words(p) { return p.role ? p.person + ', ' + p.role + ', ' + p.by : p.person + ' (as themselves)'; },
  };

  // THE PERSON'S OWN SWIPE, checked for one item of a list. used: a Set of items already approved once.
  //   allowMimic  whether a ticked box may stand in for the fingerprint (only when trying the sample)
  MG.flow.checkSwipe = async function ({ pass, holder, purpose, swipe, allowMimic, used, now }) {
    const s = await MG.swipe.check(swipe, holder, purpose, now);
    if (!s.ok) return { ok: false, why: s.why };
    if (pass.passkey) {
      if (s.how !== 'device') return { ok: false, why: 'this person approves with the fingerprint on their own device, named in their pass' };
      if (swipe.key !== pass.passkey) return { ok: false, why: 'the fingerprint came from a device the pass does not name' };
    } else if (s.how === 'device') return { ok: false, why: 'the pass names no device, so a fingerprint cannot be matched to this person' };
    else if (!allowMimic) return { ok: false, why: 'a ticked box stands in for a fingerprint only when trying the sample' };
    const mark = holder + '|' + swipe.at + '|' + (swipe.salt || '') + '|' + purpose;
    if (used.has(mark)) return { ok: false, why: 'this approval was already used once' };
    used.add(mark);
    return { ok: true, how: s.how };
  };
  MG.flow.howWords = how => how === 'device' ? 'own fingerprint, on the device named in the pass' : 'a ticked box standing in for a fingerprint (sample only)';

  // THE LOG. The full entries stay with the owner (and each party keeps its own copy of its part).
  // The public receipts show only fingerprints: the entry's, and the receipt's before it.
  MG.log = {
    create() { return { entries: [], receipts: [] }; },
    async add(log, entry) {
      const n = log.entries.length + 1, at = new Date().toISOString();
      const e = { n, at, ...entry };
      const prev = n > 1 ? log.receipts[n - 2].mark : 'start';
      const r = { n, at, what: entry.what, workflow: entry.workflow, entry: await hex(MG.wordsOf(e)), prev };
      r.mark = await hex(MG.wordsOf(r));
      log.entries.push(e); log.receipts.push(r);
      return r;
    },
    // Anyone checks the chain of public receipts; a holder of an entry checks it against its receipt.
    async verify(receipts) {
      let prev = 'start';
      for (const r of receipts) {
        const { mark, ...rest } = r;
        if (r.prev !== prev) return { ok: false, why: 'receipt ' + r.n + ' does not follow the one before' };
        if (mark !== await hex(MG.wordsOf(rest))) return { ok: false, why: 'receipt ' + r.n + ' was changed' };
        prev = mark;
      }
      return { ok: true, count: receipts.length, head: prev };
    },
    async matches(entry, receipt) { return !!receipt && receipt.entry === await hex(MG.wordsOf(entry)); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
