// SHARED BITS FOR THE TRY PAGES. A page plays every person in the workflow on one screen, so the sample can be tried
// alone, or, with ?me=<work ID or name>, only one person's own screen: a personal agent's list, or a business dashboard.
// WHERE EACH HOST IS. By default every host answers on the server that served the page. When they run apart, the page
// is told: ?signin=<address> (the organisations' sign-in), ?owner=<address>, ?middle=<address>.
const Q = new URLSearchParams(location.search);
const HOSTS = { orgs: Q.get('signin') || '', owner: Q.get('owner') || '', middle: Q.get('middle') || '' };
window.UI = {
  q: Q,
  apart: Object.values(HOSTS).some(Boolean),
  // The same page address, for one person: keeps the hosts, adds ?me=.
  linkFor: me => { const q = new URLSearchParams(location.search); q.set('me', me); return location.pathname + '?' + q; },
  esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  money: n => '₹' + Number(n).toLocaleString('en-IN'),
  time: t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  async api(method, url, body) {
    // url starts with the host it belongs to: /orgs/api/..., /owner/api/... or /middle/api/...
    const r = await fetch((HOSTS[url.split('/')[1]] || '').replace(/\/$/, '') + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  },
  // Sign in with a work ID (or a private person's name with their agent's provider). With a passkey, the pass names it.
  async signIn(person) {
    const r = await UI.api('POST', '/orgs/api/sign-in', { org: person.org, id: person.workId || person.person, passkey: person.passkey ? person.passkey.key : null });
    if (!r.pass) throw new Error(r.why);
    person.pass = r.pass;
    return person;
  },
  // THE SWIPE for the list on the screen. With a linked device, the real fingerprint; otherwise the sample's tick.
  async swipe(person, purposes) {
    const holder = await MG.pass.holder(person.pass);
    if (person.passkey) return MG.swipe.device(person.passkey, holder, purposes);
    return Object.fromEntries(purposes.map(p => [p, MG.swipe.mimic(purposes.length)]));
  },
  // Link this device's fingerprint to the person: make a passkey, then sign in again so the pass names it.
  async linkDevice(person) {
    person.passkey = await MG.swipe.register(person.person);
    return UI.signIn(person);
  },
  // The swipe area under a list: a tick stands in for the fingerprint unless a device is linked.
  swipeArea(person, label, id) {
    return '<div class="swipe">' + (person.passkey
      ? '<button class="go" id="' + id + '">' + UI.esc(label) + '</button><span class="how">your own fingerprint, on the device named in your pass</span>'
      : '<label class="tick"><input type="checkbox" id="' + id + '-tick"> I have checked this (a tick stands in for a fingerprint in the sample)</label><button class="go" id="' + id + '">' + UI.esc(label) + '</button>') + '</div>';
  },
  ticked(person, id) {
    if (person.passkey) return true;
    const t = document.getElementById(id + '-tick');
    if (t && t.checked) return true;
    alert('Tick the box first: in the sample it stands in for the fingerprint swipe.');
    return false;
  },
  async deviceButton(person) {
    if (person.passkey) return '<span class="chip ok">fingerprint linked to this pass</span>';
    return (await MG.swipe.canUseDevice()) ? '<button class="small" data-link="1">Use this device’s fingerprint</button>' : '<span class="chip">no fingerprint on this device: a tick stands in</span>';
  },
};
