// THE ORGANISATIONS, mocked for the sample. In real use each one runs its own sign-in (its work ID system, as today),
// keeps its own staff directory, and publishes a signed list of its roles and the workflows each role may act in.
// Here they all live in one file so the sample runs with one sign-in server. All names are made up.
//
// Signing in: a person signs in with their work ID (the sample asks for nothing else), and may name the passkey of
// their own device. The organisation then signs a role pass: "this person holds this role here, and approves with this
// passkey". From then on their own fingerprint swipe is linked to that role.
//
// What the organisations publish, for the servers that run workflows (open keys and signed documents only, no secret):
//   keys        each organisation's open key
//   roleLists   each organisation's signed list of roles, and the workflows each role may act in
//   workflows   each workflow, published and signed by the organisation that owns it (the party marked "owns")
(function (root) {
  const MG = root.MG;
  const ORGS = [
    { name: 'Sunrise Motors', is: 'car showroom', staff: [{ workId: 'SM-104', person: 'Meera Shah', role: 'Sales manager' }],
      roles: { 'Sales manager': ['car-registration'] } },
    { name: 'Lotus Insurance', is: 'insurer', staff: [{ workId: 'LI-220', person: 'Arjun Rao', role: 'Underwriter' }],
      roles: { Underwriter: ['car-registration'] } },
    { name: 'Northbank', is: 'bank', staff: [{ workId: 'NB-311', person: 'Kavya Iyer', role: 'Loan officer' }],
      roles: { 'Loan officer': ['car-registration'] } },
    { name: 'Motor Department', is: 'government office', staff: [{ workId: 'MD-017', person: 'Anita Das', role: 'Registration officer' }],
      roles: { 'Registration officer': ['car-registration'] } },
    { name: 'City Works Office', is: 'government office', staff: [
        { workId: 'CW-01', person: 'Farah Khan', role: 'Evaluation committee member' },
        { workId: 'CW-02', person: 'Joseph Mathai', role: 'Evaluation committee member' },
        { workId: 'CW-03', person: 'Lin Wei', role: 'Evaluation committee member' }],
      roles: { 'Evaluation committee member': ['bridge-tender'] } },
    { name: 'Harbour Build', is: 'construction company', staff: [{ workId: 'HB-9', person: 'Sam Okafor', role: 'Authorised signatory' }],
      roles: { 'Authorised signatory': ['bridge-tender'] } },
    { name: 'Ridge Constructions', is: 'construction company', staff: [{ workId: 'RC-4', person: 'Nisha Pillai', role: 'Authorised signatory' }],
      roles: { 'Authorised signatory': ['bridge-tender'] } },
    { name: 'Delta Works', is: 'construction company', staff: [{ workId: 'DW-2', person: 'Omar Siddiqui', role: 'Authorised signatory' }],
      roles: { 'Authorised signatory': ['bridge-tender'] } },
    // A personal agent's provider: it gives private people a person pass, as in Part 1 (AMP).
    { name: 'Sample agent provider', is: 'personal agent provider', people: ['Ravi Kumar'] },
  ];

  MG.orgs = {
    // templates: the workflow templates (plain JSON) the organisations publish.
    async create(templates) {
      const all = {}, keys = {}, roleLists = {}, workflows = {};
      for (const o of ORGS) { all[o.name] = { ...o, key: await MG.stamp.newKey() }; keys[o.name] = all[o.name].key.open; }
      for (const o of Object.values(all)) if (o.roles) {
        const l = { kind: 'role list', by: o.name, is: o.is, key: o.key.open, roles: o.roles };
        l.stamp = await MG.stamp.make(o.key.secret, MG.wordsOf(l)); roleLists[o.name] = l;
      }
      const secretOf = name => { const o = all[name]; return { name: o.name, secret: o.key.secret, open: o.key.open }; };
      for (const t of templates || []) workflows[t.name] = await MG.flow.publish(secretOf(MG.flow.ownerOf(t)), t);
      return {
        trust: keys, roleLists, workflows,
        // Who can sign in, for the sample's pages.
        people() { return Object.values(all).flatMap(o => o.staff ? o.staff.map(s => ({ ...s, org: o.name, is: o.is })) : o.people.map(p => ({ person: p, org: o.name, is: o.is }))); },
        // Sign in with a work ID (or, for a private person, their name with their agent's provider).
        async signIn(orgName, id, passkey) {
          const o = all[orgName];
          if (!o) return { why: 'no organisation by that name here' };
          if (o.staff) {
            const s = o.staff.find(x => x.workId === id);
            if (!s) return { why: 'that work ID is not in ' + o.name + '’s directory' };
            return { pass: await MG.pass.issue(secretOf(orgName), { person: s.person, workId: s.workId, role: s.role, passkey }) };
          }
          if (!o.people.includes(id)) return { why: 'that person has no agent with ' + o.name };
          return { pass: await MG.pass.issue(secretOf(orgName), { person: id, passkey }) };
        },
        // An organisation's own signing key, for the sample's checks only (publishing a copy under another name).
        owner: secretOf,
      };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
