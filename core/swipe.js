// THE FINGERPRINT SWIPE. Before a personal agent sends data to a middle ground, the person approves it.
// The sample offers two ways, and the person picks one on the agent's page:
//   mimic   a ticked box stands in for the swipe. For trying the sample on any computer.
//   device  a real fingerprint (or face, or the device's PIN) on this phone or laptop, through a passkey: the
//           browser's built-in way to use the device's secure chip. The chip signs only after it has checked the
//           person, and the signature covers exactly this agent and this request, so it cannot be reused.
// The middle ground checks either kind, and writes into the other side's confirmation token which one it was.
// THE DEVICE BELONGS TO THE PERSON: the agent provider names the device's passkey in the person's real person pass, and the
// middle ground accepts a fingerprint only from that passkey. (In the sample, the sample provider does this when the
// passkey is made.)
// ANYONE CAN CHECK IT AGAIN: when the person shares their agent's key with the other side, the middle ground puts the
// device's own signed approval, with the person pass, into the other side's confirmation token. recheck() below checks it
// again later, on any computer, without asking the middle ground.
// ONE SWIPE, ONE SCREEN. The person sees what will go before swiping: one important item on its own, or a short list of
// small ones together, and one swipe approves exactly what is on that screen. An important item (a rule sheet with
// ownSwipe, such as a loan or a sale) needs a swipe of its own. Each item is used once.
// The same file runs on the server and in a web page.
(function (root) {
  const MG = root.MG;
  const subtle = (root.crypto && root.crypto.subtle) || (typeof window === 'undefined' ? require('crypto').webcrypto.subtle : undefined);   // a web page gets it only over https or on localhost
  const FRESH = 2 * 60 * 1000;   // an approval counts for two minutes
  const b64 = buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = s => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0)); };
  const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const bytes = t => new TextEncoder().encode(t);
  const random = () => b64url(((root.crypto && root.crypto.getRandomValues) ? root.crypto : require('crypto').webcrypto).getRandomValues(new Uint8Array(16)));
  const MAX_LIST = 20;
  // What a swipe approves: this agent, at this time, and the list on the screen. Each item on the list is kept as a
  // scrambled code (its request with a random salt), so a request shows the middle ground, and a token shows the other
  // side, only its own item, never the rest of the list.
  const codeOf = async (purpose, salt) => b64url(await subtle.digest('SHA-256', bytes(purpose + '|' + salt)));
  const challenge = async (holder, at, codes) => new Uint8Array(await subtle.digest('SHA-256', bytes('swipe|' + holder + '|' + at + '|' + codes.join(','))));
  // A device signs in the DER format; the browser's and Node's checker want the two numbers side by side.
  function derToRaw(der) {
    let i = 2; const out = new Uint8Array(64);
    for (const at of [0, 32]) {
      i++; const len = der[i++]; let v = der.slice(i, i + len); i += len;
      while (v.length > 32 && v[0] === 0) v = v.slice(1);
      out.set(v, at + 32 - v.length);
    }
    return out;
  }

  MG.swipe = {
    FRESH, MAX_LIST, codeOf, challenge,
    // MIMIC: says only that the person ticked the box, and for how many items.
    mimic(items) { return { how: 'mimic', at: new Date().toISOString(), items: Math.max(1, Number(items) || 1), salt: random() }; },
    // Whether this browser can use a real fingerprint through a passkey.
    async canUseDevice() {
      try { return !!(root.PublicKeyCredential && await root.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
    },
    // DEVICE, step one, done once: make a passkey for this agent on this device. The device asks for the fingerprint.
    async register(name) {
      const c = await navigator.credentials.create({ publicKey: {
        rp: { name: 'AMP sample personal agent' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: name || 'person', displayName: name || 'person' },
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000 } });
      if (!c.response.getPublicKey) throw new Error('This browser cannot hand over the passkey’s public key. Try a newer browser.');
      return { id: b64url(c.rawId), key: b64(c.response.getPublicKey()), alg: c.response.getPublicKeyAlgorithm() };
    },
    // DEVICE, each time: the person swipes once for the list on the screen (one request, or several), and the device
    // signs this agent and that list. Gives one approval per request: { request: approval }.
    async device(passkey, holder, purposes) {
      const list = [].concat(purposes), at = new Date().toISOString(), salts = list.map(random);
      if (!list.length || list.length > MAX_LIST) throw new Error('A list for one swipe holds 1 to ' + MAX_LIST + ' items.');
      const codes = await Promise.all(list.map((p, n) => codeOf(p, salts[n])));
      const a = await navigator.credentials.get({ publicKey: {
        challenge: await challenge(holder, at, codes), allowCredentials: [{ type: 'public-key', id: unb64(passkey.id) }],
        userVerification: 'required', timeout: 60000 } });
      const signed = { how: 'device', at, key: passkey.key, alg: passkey.alg, authData: b64(a.response.authenticatorData), clientData: b64(a.response.clientDataJSON), sig: b64(a.response.signature), codes };
      return Object.fromEntries(list.map((p, n) => [p, { ...signed, salt: salts[n] }]));
    },
    // CHECK, in the middle ground: { ok, how } or { ok: false, why }.
    async check(s, holder, purpose, now) {
      if (!s || typeof s !== 'object') return { ok: false, why: 'the person’s approval (a fingerprint swipe) was not sent' };
      const at = Date.parse(s.at);
      if (!(Math.abs((now || Date.now()) - at) <= FRESH)) return { ok: false, why: 'the person’s approval is not recent' };
      if (s.how === 'mimic') return { ok: true, how: 'mimic', items: Math.max(1, Math.floor(Number(s.items)) || 1) };
      if (s.how !== 'device') return { ok: false, why: 'this kind of approval is not known here' };
      try {
        const codes = Array.isArray(s.codes) ? s.codes.map(String) : [];
        if (!codes.length || codes.length > MAX_LIST) return { ok: false, why: 'the approved list is empty or too long' };
        if (!codes.includes(await codeOf(purpose, String(s.salt)))) return { ok: false, why: 'the swipe approved a different request' };
        const cdBytes = unb64(s.clientData), cd = JSON.parse(new TextDecoder().decode(cdBytes)), ad = unb64(s.authData);
        if (cd.type !== 'webauthn.get') return { ok: false, why: 'the device’s answer is not a sign-in approval' };
        if (cd.challenge !== b64url(await challenge(holder, s.at, codes))) return { ok: false, why: 'the swipe approved a different request' };
        if (!(ad[32] & 0x01) || !(ad[32] & 0x04)) return { ok: false, why: 'the device did not check the person (no fingerprint, face or PIN)' };
        const data = new Uint8Array(ad.length + 32); data.set(ad); data.set(new Uint8Array(await subtle.digest('SHA-256', cdBytes)), ad.length);
        const sig = unb64(s.sig);
        let good = false;
        if (Number(s.alg) === -7) {
          const k = await subtle.importKey('spki', unb64(s.key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
          good = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, derToRaw(sig), data);
        } else if (Number(s.alg) === -257) {
          const k = await subtle.importKey('spki', unb64(s.key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
          good = await subtle.verify('RSASSA-PKCS1-v1_5', k, sig, data);
        } else return { ok: false, why: 'the device used a kind of key this middle ground does not check' };
        return good ? { ok: true, how: 'device', items: codes.length } : { ok: false, why: 'the fingerprint signature does not match' };
      } catch { return { ok: false, why: 'the fingerprint approval could not be read' }; }
    },
    // WHAT NEEDS THE PERSON. Collecting a token or a delivered certificate token runs on its own. Anything that sends the
    // person's data (opening or coming into a room) needs the person's approval. Whether it needs a swipe of its own is
    // set by the rule sheet (ownSwipe), such as a loan or a sale.
    needs(purpose) { return !/^(meet:pickup:|mailbox)/.test(String(purpose)); },
    // Whether the person pass names the passkey this approval came from.
    bound(s, pass) { return !!(s && pass && pass.facts && pass.facts.passkey && pass.facts.passkey === s.key); },
    // What the middle ground copies into the other side's confirmation token: the device's signed approval and the pass.
    proof(s, holder, purpose, pass) { return { how: 'device', holder, purpose, at: s.at, key: s.key, alg: s.alg, authData: s.authData, clientData: s.clientData, sig: s.sig, codes: s.codes, salt: s.salt, pass }; },
    // RECHECK, by anyone who holds such a token: the device signed this agent and this request after checking the person,
    // the person pass names that device's passkey, and the pass itself is good. trust is the same as for certificate tokens.
    async recheck(p, trust) {
      if (!p || p.how !== 'device') return { ok: false, why: 'there is no fingerprint swipe to check' };
      const s = await MG.swipe.check(p, p.holder, p.purpose, Date.parse(p.at));
      if (!s.ok) return s;
      if (!MG.swipe.bound(p, p.pass)) return { ok: false, why: 'the person pass does not name this device’s passkey' };
      const c = await MG.paper.check(p.pass, p.holder, trust, Date.parse(p.at));
      if (!c.good) return { ok: false, why: 'the person pass fails: ' + c.why };
      if (!c.confirmed) return { ok: false, why: 'the person pass comes from a provider this checker cannot confirm' };
      return { ok: true, by: c.by };
    },
    // The words a confirmation token uses for each kind.
    words(how) { return how === 'device' ? 'approved by the person with a fingerprint on the device named in their person pass, checked' : 'approved by the person with a ticked box standing in for a fingerprint (sample only)'; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
