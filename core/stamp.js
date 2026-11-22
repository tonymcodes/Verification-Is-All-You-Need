// STAMPS. A stamp proves who made a token and that nobody changed it since.
// It is the same kind of signature a website's https certificate uses. Nothing more is needed.
// Whoever makes a token keeps a secret key and gives everyone the matching open key.
// The same file runs on the server and in a web page.
(function (root) {
  const MG = root.MG;
  const subtle = (root.crypto && root.crypto.subtle) || (typeof window === 'undefined' ? require('crypto').webcrypto.subtle : undefined);   // a web page gets it only over https or on localhost
  const toText = buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
  const toBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const bytes = t => new TextEncoder().encode(t);

  MG.stamp = {
    // A new pair: the secret key stays with its owner, the open key is given to everyone.
    async newKey() {
      const k = await subtle.generateKey('Ed25519', false, ['sign', 'verify']);
      return { secret: k.privateKey, open: toText(await subtle.exportKey('raw', k.publicKey)) };
    },
    // A LASTING KEY. A host keeps its stamp key outside the code and hands it in at start, so its tokens stay checkable
    // after a restart. Make the text once with:  node server.js new-key
    async newText() { const k = await subtle.generateKey('Ed25519', true, ['sign', 'verify']); return toText(await subtle.exportKey('pkcs8', k.privateKey)); },
    async load(text) {
      const secret = await subtle.importKey('pkcs8', toBytes(text), 'Ed25519', true, ['sign']);
      const x = (await subtle.exportKey('jwk', secret)).x.replace(/-/g, '+').replace(/_/g, '/');
      return { secret, open: x + '='.repeat((4 - x.length % 4) % 4) };
    },
    // A KEY ID: the first 16 characters of the fingerprint of an open key. Every token names the key id of its maker,
    // so a receiver can ask the maker's address for exactly that key.
    async keyId(open) { return [...new Uint8Array(await subtle.digest('SHA-256', bytes(String(open))))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16); },
    // A one-way mark of a text. The text cannot be worked back from the mark.
    async mark(text) { return toText(await subtle.digest('SHA-256', bytes(text))); },
    async make(secret, text) { return toText(await subtle.sign('Ed25519', secret, bytes(text))); },
    async check(open, text, stamp) {
      try {
        const k = await subtle.importKey('raw', toBytes(open), 'Ed25519', false, ['verify']);
        return await subtle.verify('Ed25519', k, toBytes(stamp), bytes(text));
      } catch { return false; }
    },
  };

  // The exact words of a token that the stamp covers: every field except the stamp, in a fixed order.
  MG.wordsOf = function wordsOf(v) {
    if (Array.isArray(v)) return '[' + v.map(wordsOf).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => k !== 'stamp').map(k => JSON.stringify(k) + ':' + wordsOf(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  };
})(typeof window !== 'undefined' ? window : globalThis);
