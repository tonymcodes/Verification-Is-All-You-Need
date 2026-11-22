// ANOTHER POSSIBILITY: A WORKFLOW IN AN AGENT MIDDLEGROUND. The details stay hidden: they are seen only inside the
// middle ground, under the workflow's published rules, and each party takes back a confirmation token.
// The sample is a sealed tender. A city works office invites bids to build a bridge:
//   1. each company's authorised signatory submits a sealed bid with their own swipe; nobody can read it;
//   2. at the deadline the published rules check each company's eligibility and score each bid;
//   3. the evaluation committee (three officers in their roles) sees the scores, never the prices or the accounts,
//      and two of the three approve the result with their own swipes;
//   4. the winner and its price are announced, each company gets a confirmation token with its own score, and the
//      bids are wiped. Nobody else's price or accounts ever leave the middle ground.
(function (root) {
  const MG = root.MG;
  const TENDER = 'TENDER-1';

  MG.middle = {
    // trust: each organisation's open key; roleLists: their signed role lists; workflow: the tender, published by the office.
    // The middle ground holds no organisation's secret, only its own stamp key for the tokens it writes.
    async create({ trust, roleLists, workflow, allowMimic = true, name = 'Sample middle ground' }) {
      const me = await MG.stamp.newKey(), w = workflow, c0 = await MG.flow.check(w, trust[MG.flow.ownerOf(w)]);
      if (!c0.ok) throw new Error('The workflow does not check: ' + c0.why);
      const allows0 = await MG.flow.roles(roleLists, trust), allows = (org, role) => allows0(org, role, w.name);
      const bidStep = MG.flow.step(w, 'bid'), resultStep = MG.flow.step(w, 'result'), R = w.rules;
      const log = MG.log.create(), used = new Set(), bids = new Map(), tokens = new Map();
      let state = 'open', scores = null, winner = null, approvals = [], result = null;

      const sign = async t => { t.stamp = await MG.stamp.make(me.secret, MG.wordsOf(t)); return t; };
      const asBidder = p => p.kind === 'role pass' && p.role === bidStep.role && allows(p.by, p.role);
      const asCommittee = p => p.kind === 'role pass' && p.by === w.parties.office.name && p.role === resultStep.role && allows(p.by, p.role);
      const refuse = async (why, pass) => { await MG.log.add(log, { what: 'refusal', workflow: w.id, claimed: pass && pass.person ? MG.pass.words(pass) : 'an unknown sender', why }); return { ok: false, why }; };
      const check = async pass => { const c = await MG.pass.check(pass, trust); return c.ok ? null : await refuse(c.why, pass); };

      // THE PUBLISHED RULES, run inside the middle ground at the deadline.
      function score() {
        const E = R.eligible, list = [...bids.entries()].map(([company, b]) => {
          const d = b.details, reasons = [];
          if (d.turnover < E.turnoverAtLeast) reasons.push('turnover below ₹' + E.turnoverAtLeast + ' crore');
          if (d.licence.toLowerCase() !== E.licence.toLowerCase()) reasons.push('licence is not ' + E.licence);
          if (d.projects < E.projectsAtLeast) reasons.push('fewer than ' + E.projectsAtLeast + ' similar projects');
          return { company, eligible: !reasons.length, reasons, price: d.price, projects: d.projects };
        });
        const ok = list.filter(x => x.eligible), lowest = Math.min(...ok.map(x => x.price));
        for (const x of list) x.score = x.eligible ? Math.round(70 * lowest / x.price + Math.min(30, 6 * x.projects)) : 0;
        list.sort((a, b) => b.score - a.score);
        list.forEach((x, i) => { x.rank = x.eligible ? i + 1 : null; });
        // What leaves the rules: no price, no turnover, no licence, no project count.
        return list.map(({ company, eligible, reasons, score, rank }) => ({ company, eligible, reasons, score, rank }));
      }

      return {
        workflow: w, key: me.open, name,
        // PUBLIC: what anyone sees. While the tender is open, only how many sealed bids it holds.
        status() {
          return { ok: true, title: w.title, workflow: w.id, owner: w.owner, state, sealedBids: bids.size, rules: R,
            result: result && { winner: result.winner, price: result.price, approvedBy: result.approvedBy }, receipts: log.receipts };
        },
        // 1. A company's authorised signatory submits a sealed bid, with their own swipe.
        async bid(pass, details, swipes) {
          const bad = await check(pass); if (bad) return bad;
          if (!asBidder(pass)) return await refuse('only a company’s ' + bidStep.role + ' can submit a bid', pass);
          if (state !== 'open') return { ok: false, why: 'the tender is closed' };
          if (bids.has(pass.by)) return { ok: false, why: pass.by + ' has already submitted its bid' };
          const d = MG.flow.clean(bidStep, details);
          if (!d) return { ok: false, why: 'fill in ' + Object.keys(bidStep.adds).join(', ') };
          const purpose = await MG.flow.purpose(TENDER, 'bid', d, {});
          const sw = await MG.flow.checkSwipe({ pass, holder: await MG.pass.holder(pass), purpose, swipe: swipes && swipes[purpose], allowMimic, used });
          if (!sw.ok) return await refuse(sw.why, pass);
          bids.set(pass.by, { details: d, by: MG.pass.words(pass), at: new Date().toISOString(), how: sw.how });
          const r = await MG.log.add(log, { what: 'sealed bid', workflow: w.id, company: pass.by, bid: await MG.stamp.mark(MG.wordsOf(d)) });
          return { ok: true, receipt: r.n, token: await sign({ kind: 'confirmation token', by: name, workflow: w.id, for: pass.by,
            says: 'Your sealed bid was received and is held unread until the deadline.', at: new Date().toISOString(), approvedBy: MG.pass.words(pass), how: MG.flow.howWords(sw.how) }) };
        },
        // 2. The deadline passes (in the sample, a committee member presses it). The rules score the bids.
        async close(pass) {
          const bad = await check(pass); if (bad) return bad;
          if (!asCommittee(pass)) return await refuse('only the evaluation committee closes the tender', pass);
          if (state !== 'open') return { ok: false, why: 'the tender is already closed' };
          if (bids.size < 2) return { ok: false, why: 'the sample needs at least two bids' };
          state = 'closed'; scores = score();
          const top = scores.find(x => x.rank === 1);
          if (!top) { state = 'open'; scores = null; return { ok: false, why: 'no bid is eligible' }; }
          winner = top.company;
          await MG.log.add(log, { what: 'deadline: bids scored by the rules', workflow: w.id, scores: await MG.stamp.mark(MG.wordsOf(scores)) });
          return { ok: true };
        },
        // 3. The committee sees the scores, never the prices or the accounts.
        async view(pass) {
          const bad = await check(pass); if (bad) return bad;
          if (!asCommittee(pass)) return await refuse('only the evaluation committee sees the scores', pass);
          if (!scores) return { ok: false, why: 'the bids stay sealed until the deadline' };
          return { ok: true, scores, winner, approvedBy: approvals.map(a => a.by), needs: resultStep.count, state };
        },
        async approve(pass, swipes) {
          const bad = await check(pass); if (bad) return bad;
          if (!asCommittee(pass)) return await refuse('only the evaluation committee approves the result', pass);
          if (state !== 'closed') return { ok: false, why: state === 'open' ? 'the tender is still open' : 'the result is already approved' };
          if (approvals.some(a => a.person === pass.person)) return { ok: false, why: 'already approved by ' + pass.person };
          const purpose = await MG.flow.purpose(TENDER, 'result', { winner }, { scores });
          const sw = await MG.flow.checkSwipe({ pass, holder: await MG.pass.holder(pass), purpose, swipe: swipes && swipes[purpose], allowMimic, used });
          if (!sw.ok) return await refuse(sw.why, pass);
          approvals.push({ person: pass.person, by: MG.pass.words(pass), at: new Date().toISOString(), how: sw.how });
          await MG.log.add(log, { what: 'result approved', workflow: w.id, by: MG.pass.words(pass), how: sw.how });
          if (approvals.length >= resultStep.count) {
            // 4. The result is announced, each company's token is signed, and the bids are wiped.
            result = { winner, price: bids.get(winner).details.price, approvedBy: approvals.map(a => a.by), at: new Date().toISOString() };
            for (const x of scores) tokens.set(x.company, await sign({ kind: 'confirmation token', by: name, key: me.open, workflow: w.id, tender: w.title, for: x.company,
              yourScore: x.score, yourRank: x.rank, eligible: x.eligible, reasons: x.reasons, of: scores.length,
              winner: result.winner, winningPrice: result.price, approvedBy: result.approvedBy, at: result.at }));
            bids.clear(); state = 'decided';
            await MG.log.add(log, { what: 'result announced; bids wiped', workflow: w.id, winner: result.winner });
          }
          return { ok: true, approvals: approvals.length, needs: resultStep.count, decided: state === 'decided' };
        },
        // Each company takes back its own confirmation token, and nothing about the others.
        async token(pass) {
          const bad = await check(pass); if (bad) return bad;
          if (!asBidder(pass)) return { ok: false, why: 'only a bidding company’s ' + bidStep.role + ' takes back its token' };
          const t = tokens.get(pass.by);
          return t ? { ok: true, token: t } : { ok: false, why: bids.has(pass.by) ? 'the bid is sealed; the result is not out yet' : pass.by + ' has not bid' };
        },
        // What the middle ground holds right now, for the sample's page.
        holds() { return { bids: bids.size, readable: 'by nobody: only the published rules read them, at the deadline', wiped: state === 'decided' }; },
      };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
