# Verification Is All You Need

Sample code for the paper *Verification Is All You Need*, Part 2 of the
[Agent Middleground Protocol (AMP)](https://github.com/tonymcodes/Agent-Middleground-Protocol) papers.

- **Read the paper,** *Verification Is All You Need*: [paper/paper.pdf](paper/paper.pdf), or the
  [web version](https://tonymcodes.github.io/Verification-Is-All-You-Need/paper/).

**Why.** Two reasons.

1. **Processes need to be ready for the AI agent era.** Most of today's processes, on the personal,
   business and government side, are digitised only on the surface: forms, portals and emails, with
   the work still moved by hand between people and organisations. They can become far more efficient
   if the information and the approvals flow through one **workflow template**, shared by every party.
2. **Fakes will multiply with AI.** Spam, fake invoices, fake officials and fake documents already
   cost a great deal, and AI makes them cheap at any scale. Today's systems try to catch the
   fraudsters, but fraudsters change identities and carry on. This turns the focus around: confirm
   the **genuine** cases, by verification from the authorised people. Anything without it stands
   out, and that is very hard for a scammer to fake.

**The idea.** A workflow is published as rules: who takes part, what passes between them, and who
approves each part. The authorised people in each organisation, and the private people involved,
are the **humans in the loop**. Each verifies and approves their own part with their own
fingerprint swipe, linked to the role they signed in to with their work ID. Every approval is
signed over the exact details and recorded.

## Try it

It needs only [Node](https://nodejs.org) 18 or newer. There is nothing to install.

```
git clone https://github.com/tonymcodes/Verification-Is-All-You-Need
cd Verification-Is-All-You-Need
npm start
```

Then open <http://localhost:8800>. Two samples:

| Sample | Where the workflow runs | What it shows |
|---|---|---|
| [Buying a car with insurance and a loan](pages/car.html) | **On the owner's server**, the main way. The motor department runs it. | Five parties and eight steps, each approved by the right person in the right role. **The data is shown:** every party of the case sees the case file. A stranger with a copied name is refused, and the refusal is recorded. |
| [A sealed tender to build a bridge](pages/tender.html) | **In an Agent Middleground**, another possibility. | Sealed bids, scored by published rules; two of three officers approve the result. **The data stays hidden:** each company takes back only its own score. |

Each page plays every person on one screen, so you can try it alone. Under the list of people,
a link opens **one person's own screen**, the way they would see it on their own phone or desk:
Ravi's personal agent, or the loan officer's dashboard (`?me=` and a work ID or name).

A ticked box stands in for the fingerprint, so the sample works on any computer. Press **Use
this device's fingerprint** to link a real one (a passkey: fingerprint, face or the device's PIN).
The organisation then signs a new pass that names that device, and from then on only that
fingerprint approves for that person. Run with `MIMIC=off` to turn the ticked box off.

`npm test` runs the checks: the right person, role and time for every step; refusals for the
wrong role, a forged pass, a step before its time, a swipe for other details and a reused
approval; the log's chain; that no sealed bid leaves the middle ground; and the three hosts
running apart.

## Three ways to run it

The sample has three hosts: **the organisations' sign-in** (mocked together: work ID in, role pass
out), **the owner's server** (the car purchase) and **a middle ground** (the tender). Each serves
the pages too.

**1. All on one computer, one program.** `npm start`, then http://localhost:8800 (above).

**2. Each host on its own, on one computer.** In three terminals:

```
node server/server.js sign-in 8801
node server/server.js owner 8802 http://localhost:8801
node server/server.js middle 8803 http://localhost:8801
```

The owner's server and the middle ground read the organisations' open keys, signed role lists and
signed workflows from the sign-in server, and trust nothing else. Open http://localhost:8802 for
the car purchase and http://localhost:8803 for the tender: each page is told where the sign-in is.
Then open one person's own screen in another browser window, from the links under the list.

**3. Each host on its own machine, over the internet.** A browser lets a page make and check
signatures only over **https**, or on the same computer (localhost), so each host speaks https.
On each server, with a certificate for its address (a free one comes from Let's Encrypt):

```
TLS_CERT=/path/fullchain.pem TLS_KEY=/path/privkey.pem node server/server.js sign-in 443
TLS_CERT=... TLS_KEY=... node server/server.js owner 443 https://signin.example.com
TLS_CERT=... TLS_KEY=... node server/server.js middle 443 https://signin.example.com
```

Open https://owner.example.com on a desk, and one person's screen on a phone, such as
`https://owner.example.com/pages/car.html?signin=https://signin.example.com&me=Ravi%20Kumar`.
A page can also be served by any one host and pointed at the others with `?signin=`, `?owner=` and
`?middle=`. On a home network without a web address, make a test certificate for the computer's
network address (see the [AMP README](https://github.com/tonymcodes/Agent-Middleground-Protocol#three-ways-to-run-it)),
accept the browser's warning on each device, and start the owner's server and the middle ground
with `NODE_EXTRA_CA_CERTS=cert.pem` so they trust the sign-in server's test certificate. The phone's
real fingerprint (a passkey) needs a certificate the phone trusts.

On Windows PowerShell, set each setting first, such as `$env:TLS_CERT = "C:\path\cert.pem"`, then run
the command without it.

## What is in this repo

| Folder | What it is |
|---|---|
| [`core/workflow.js`](core/workflow.js) | **The core.** Workflows (published, signed, identified by a fingerprint of their content), role passes, who may act, approvals over the exact details, and the chained log with public receipts. |
| [`core/stamp.js`](core/stamp.js), [`core/swipe.js`](core/swipe.js) | Signatures and the fingerprint swipe, the same files as in the AMP repo. |
| [`workflows/`](workflows/) | The two workflow templates, as plain JSON: a car purchase and a sealed tender. Copy one to make your own. |
| [`server/owner.js`](server/owner.js) | **The owner's server.** Runs a workflow, shows each person what waits for them in their role, accepts only the right approvals, keeps the log. |
| [`server/middle.js`](server/middle.js) | **A workflow in a middle ground.** The sealed tender: bids are held unread, the rules score them, the committee approves, each company gets its own token. |
| [`server/orgs.js`](server/orgs.js) | The organisations, mocked: their sign-in with a work ID, their staff, their signed role lists, and the workflows they publish. |
| [`server/server.js`](server/server.js) | Runs the three hosts, together or each on its own, and hands out the pages. |
| [`pages/`](pages/) | The try pages. |
| [`test/`](test/) | The checks. |
| [`paper/`](paper/) | The paper, as a web page and a PDF. |

## How an approval works

1. **Sign in.** A person signs in to their organisation with their work ID, as today. The
   organisation signs a **role pass**: this person holds this role here, and approves with the
   passkey of this device. A private person gets a person pass from their agent's provider.
2. **See the part.** The workflow's server tells each person what waits for them in their role,
   with the details they are approving and the details it rests on.
3. **Swipe.** One swipe approves a short list of small items, and an important item gets a screen
   of its own. The swipe is signed over the case, the step, the details and what they rest on.
4. **Checks.** The server accepts it only if the pass is signed by a known organisation, the role
   may act in this workflow, the step's turn has come, the fingerprint comes from the device the pass
   names, and the approval has not been used before. Anything else is refused and recorded.
5. **Records.** Each approval goes into the owner's log. Each entry holds the fingerprint of the
   one before, and the public receipts show only fingerprints. Every party keeps a copy of its
   entries and can match them to the receipts. Anyone in the case can check an approval again
   later, on their own computer.

## Not in the sample

The sample keeps everything in memory, and one sign-in server plays every organisation. A real
deployment adds each organisation's real sign-in and directory, each publishing its own keys and
role list on its own address, lasting keys, stored logs, and certificate tokens (Part 1) for facts
such as a company's turnover. Every name in the sample is made up.

## Licence

The code is under the [Apache License 2.0](LICENSE): anyone may use it, change it, and build open,
closed or commercial versions, keeping the copyright and the [NOTICE](NOTICE) that credit the
original work. The paper in [`paper/`](paper/) is under [CC BY 4.0](paper/LICENSE): share and
adapt it freely, with credit to Tony Mathew. The Nunito font in `paper/fonts/` is under the SIL
Open Font License. To cite this work, see [CITATION.cff](CITATION.cff).

## Author

Tony Mathew ([@tonymcodes](https://github.com/tonymcodes)). Questions and ideas are welcome in
this repo's issues and discussions.
