// THE OWNER'S SERVER. The organisation in charge of a process runs its workflow on its own server, the main way a
// workflow runs. In the sample the owner is the motor department, and the workflow is buying and registering a car.
// The details are meant to be shared and kept, as a case file is today: every party of a case sees the case file.
//
// Each party works from its own screen (a personal agent's list, a business dashboard). The server:
//   - runs the workflow its owner published and signed;
//   - opens cases, and tells each person what waits for them, in their role;
//   - accepts an approval only from the right person, in the right role, at the right time, with their own swipe over
//     the exact details; anything else is refused, and the refusal is recorded too;
//   - keeps a log in which each entry holds the fingerprint of the one before, and shows public receipts.
// It is given only open keys and signed documents (see orgs.js): it holds no organisation's secret.
(function (root) {
  const MG = root.MG;
  const text = (v, n) => String(v == null ? '' : v).slice(0, n || 80);

  MG.owner = {
    // trust: each organisation's open key; roleLists: their signed role lists; workflow: the published workflow.
    async create({ trust, roleLists, workflow, allowMimic = true }) {
      const w = workflow, c0 = await MG.flow.check(w, trust[MG.flow.ownerOf(w)]);
      if (!c0.ok) throw new Error('The workflow does not check: ' + c0.why);
      const allows = await MG.flow.roles(roleLists, trust);
      const cases = new Map(), log = MG.log.create(), used = new Set();
      let count = 0;

      const step = id => MG.flow.step(w, id);
      const isPerson = p => w.parties[p] && w.parties[p].is === 'person';
      // The parties of a case this pass belongs to: a person by name, an organisation by its name.
      const partiesOf = (kase, pass) => Object.keys(w.parties).filter(p => isPerson(p)
        ? pass.kind === 'person pass' && kase.parties[p] === pass.person
        : pass.kind === 'role pass' && kase.parties[p] === pass.by);
      const fits = (kase, s, pass) => partiesOf(kase, pass).includes(s.party) && (isPerson(s.party) || (pass.role === s.role && allows(pass.by, pass.role, w.name)));
      const done = (kase, id) => (kase.steps[id] || []).length >= (step(id).count || 1);
      const ready = (kase, s) => (s.after || []).every(a => done(kase, a));
      const approvedBy = (kase, s, pass) => (kase.steps[s.id] || []).some(x => x.by === pass.person && x.org === pass.by);
      // A refusal is recorded, and shown to every party of the case as an alert. forged: the pass itself did not check.
      const refuse = async (why, pass, item, kase, forged) => {
        const claimed = pass && pass.person ? (forged ? 'someone claiming to be ' : '') + MG.pass.words(pass) : 'an unknown sender';
        await MG.log.add(log, { what: 'refusal', workflow: w.id, case: kase ? kase.id : null, step: item && text(item.step, 20), claimed, why });
        if (kase) kase.alerts.push({ at: new Date().toISOString(), claimed, step: item && text(item.step, 20), why });
        return { case: item && text(item.case, 20), step: item && text(item.step, 20), ok: false, why };
      };

      return {
        workflow: w,
        // A person in the role that starts the workflow opens a case, naming the other parties.
        async start(pass, parties) {
          const c = await MG.pass.check(pass, trust);
          if (!c.ok) return await refuse(c.why, pass, null, null, true);
          const first = w.steps.find(s => s.starts);
          if (pass.kind !== 'role pass' || pass.role !== first.role || !allows(pass.by, pass.role, w.name)) return await refuse('only a ' + first.role + ' can open a case', pass);
          const kase = { id: (w.caseLabel || 'CASE') + '-' + String(++count).padStart(4, '0'), opened: new Date().toISOString(), parties: {}, steps: {}, alerts: [] };
          // The opener's own organisation and any party the workflow names (the owner) are filled in; the rest are named.
          for (const p of Object.keys(w.parties)) kase.parties[p] = text(p === first.party ? pass.by : w.parties[p].name || (parties && parties[p]), 60);
          if (Object.values(kase.parties).some(v => !v)) { count--; return { ok: false, why: 'every party of the workflow must be named' }; }
          cases.set(kase.id, kase);
          await MG.log.add(log, { what: 'case opened', workflow: w.id, case: kase.id, by: MG.pass.words(pass), parties: kase.parties });
          return { ok: true, case: kase.id };
        },
        // THE PERSON'S SCREEN: what waits for them in their role, what others have done, and alerts.
        async inbox(pass) {
          const c = await MG.pass.check(pass, trust);
          if (!c.ok) return { ok: false, why: c.why };
          const waiting = [], updates = [], alerts = [];
          for (const kase of cases.values()) {
            if (!partiesOf(kase, pass).length) continue;
            for (const s of w.steps) {
              if (done(kase, s.id)) (kase.steps[s.id] || []).forEach(x => updates.push({ case: kase.id, step: s.id, does: s.does, by: x.by + (x.role ? ', ' + x.role + ', ' + x.org : ''), at: x.at, details: x.details }));
              else if (ready(kase, s) && fits(kase, s, pass) && !approvedBy(kase, s, pass))
                waiting.push({ case: kase.id, step: s.id, does: s.does, kind: s.kind, important: !!s.important, adds: s.adds || null, basis: MG.flow.basis(w, kase, s.id) });
            }
            kase.alerts.forEach(x => alerts.push({ case: kase.id, ...x }));
          }
          updates.sort((a, b) => b.at.localeCompare(a.at));
          return { ok: true, who: MG.pass.words(pass), waiting, updates, alerts };
        },
        // APPROVE a list: one swipe for a short list of small steps, or one important step on its own.
        // items: [{ case, step, details }]; swipes: { purpose: approval } from core/swipe.js
        async approve(pass, items, swipes) {
          items = Array.isArray(items) ? items.slice(0, MG.swipe.MAX_LIST + 1) : [];
          const c = await MG.pass.check(pass, trust);
          if (!c.ok) return { ok: false, results: [await refuse(c.why, pass, items[0], cases.get(items[0] && items[0].case), true)] };
          if (!items.length || items.length > MG.swipe.MAX_LIST) return { ok: false, why: 'one swipe approves 1 to ' + MG.swipe.MAX_LIST + ' items' };
          const holder = await MG.pass.holder(pass), results = [];
          for (const item of items) {
            const kase = cases.get(item.case), s = step(item.step), no = why => results.push({ case: text(item.case, 20), step: text(item.step, 20), ok: false, why });
            if (!kase || !s) { no('no such case or step'); continue; }
            if (!fits(kase, s, pass)) { results.push(await refuse('this is not ' + MG.pass.words(pass) + '’s part: “' + s.does + '” needs ' + (isPerson(s.party) ? w.parties[s.party].title.toLowerCase() : 'a ' + s.role + ' of ' + kase.parties[s.party]), pass, item, kase)); continue; }
            if (s.important && items.length > 1) { results.push(await refuse('“' + s.does + '” is important and needs a screen of its own', pass, item, kase)); continue; }
            if (done(kase, s.id) || approvedBy(kase, s, pass)) { no('already approved'); continue; }
            if (!ready(kase, s)) { no('the steps before it are not done yet'); continue; }
            const details = s.adds ? MG.flow.clean(s, item.details) : {};
            if (!details) { no('fill in ' + Object.keys(s.adds).join(', ')); continue; }
            const basis = MG.flow.basis(w, kase, s.id), purpose = await MG.flow.purpose(kase.id, s.id, details, basis);
            const sw = await MG.flow.checkSwipe({ pass, holder, purpose, swipe: swipes && swipes[purpose], allowMimic, used });
            if (!sw.ok) { results.push(await refuse(sw.why, pass, item, kase)); continue; }
            const sent = swipes[purpose];
            const approval = { step: s.id, kind: s.kind, by: pass.person, ...(pass.role ? { role: pass.role } : {}), org: pass.by, at: new Date().toISOString(), details, how: sw.how,
              // Anyone in the case can check the approval again later: the pass, and the device's own signature.
              pass, swipe: sw.how === 'device' ? { at: sent.at, key: sent.key, alg: sent.alg, authData: sent.authData, clientData: sent.clientData, sig: sent.sig, codes: sent.codes, salt: sent.salt } : { at: sent.at, how: 'mimic' } };
            const r = await MG.log.add(log, { what: 'approval', workflow: w.id, case: kase.id, step: s.id, by: MG.pass.words(pass), details, basis, how: sw.how });
            approval.receipt = r.n;
            (kase.steps[s.id] = kase.steps[s.id] || []).push(approval);
            results.push({ case: kase.id, step: s.id, ok: true, receipt: r.n });
          }
          return { ok: results.every(r => r.ok), results };
        },
        // THE CASE FILE. The data is shown: every party of the case sees all of it, with every approval, and its own
        // copy of the log entries, to check against the public receipts.
        async file(pass, id) {
          const c = await MG.pass.check(pass, trust);
          if (!c.ok) return { ok: false, why: c.why };
          const kase = cases.get(id);
          if (!kase || !partiesOf(kase, pass).length) return { ok: false, why: 'only the parties of a case see its file' };
          return { ok: true, workflow: { id: w.id, title: w.title, owner: w.owner }, case: {
            id: kase.id, opened: kase.opened, parties: kase.parties, alerts: kase.alerts,
            steps: w.steps.map(s => ({ id: s.id, does: s.does, party: s.party, role: s.role || null, kind: s.kind, important: !!s.important,
              state: done(kase, s.id) ? 'done' : ready(kase, s) ? 'waiting' : 'later', approvals: kase.steps[s.id] || [] })) },
            entries: log.entries.filter(e => e.case === kase.id) };
        },
        // PUBLIC RECEIPTS: only fingerprints, each holding the fingerprint of the one before.
        receipts() { return { ok: true, workflow: w.id, owner: w.owner, receipts: log.receipts }; },
      };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
