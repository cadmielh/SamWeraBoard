// Teste pentru firestore.rules — izolare între workspace-uri, roluri, câmpuri
// protejate. Rulează cu emulatorul: `npm test` din tests/rules.
import { readFileSync } from 'node:fs'
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing'
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, deleteField, query, where,
} from 'firebase/firestore'

let env

const W1 = 'workspaceAAAAAA1'
const W2 = 'workspaceBBBBBB2'

const ADMIN = 'uAdmin'
const MEMBER = 'uMember'
const VIEWER = 'uViewer'
const OUTSIDER = 'uOutsider' // membru doar în W2
const SUPER = 'uSuper'

// Acces complet (probă/abonament valabil) — fără el cabinetul e în citire (billingOk în firestore.rules).
const FUTURE = new Date(Date.now() + 30 * 86400_000)
const PAST = new Date(Date.now() - 86400_000)
const BILLING_OK = { status: 'trialing', accessUntil: FUTURE }

const ctx = (uid, extra = {}) =>
  env.authenticatedContext(uid, { email: `${uid}@ex.ro`, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...extra }).firestore()
const PASSWORD = { firebase: { sign_in_provider: 'password' } }

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-samwera',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
after(async () => { await env.cleanup() })

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore()
    await setDoc(doc(db, 'workspaces', W1), {
      name: 'W1', ownerId: ADMIN, status: 'active', billing: BILLING_OK,
      members: {
        [ADMIN]: { role: 'admin', email: 'a@ex.ro' },
        [MEMBER]: { role: 'member', email: 'm@ex.ro' },
        [VIEWER]: { role: 'viewer', email: 'v@ex.ro' },
      },
    })
    await setDoc(doc(db, 'workspaces', W2), {
      name: 'W2', ownerId: OUTSIDER, status: 'active', billing: BILLING_OK,
      members: { [OUTSIDER]: { role: 'admin', email: 'o@ex.ro' } },
    })
    await setDoc(doc(db, 'workspaces', W1, 'clienti', 'c1'), { denumire: 'X', createdBy: ADMIN })
    await setDoc(doc(db, 'workspaces', W1, 'clienti', 'c1', 'docGenerations', 'g1'), { templateId: 't' })
    await setDoc(doc(db, 'workspaces', W1, 'auditLog', 'a1'), { action: 'x' })
    await setDoc(doc(db, 'invitations', 'inv1'), { email: 'x@ex.ro', workspaceId: W1, status: 'pending' })
    await setDoc(doc(db, 'users', SUPER), { isSuperAdmin: true })
  })
})

// ── Izolare între workspace-uri ──────────────────────────────────────────────
test('membrul își citește clienții', async () => {
  await assertSucceeds(getDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1')))
})
test('un outsider din alt workspace nu citește clienții', async () => {
  await assertFails(getDoc(doc(ctx(OUTSIDER), 'workspaces', W1, 'clienti', 'c1')))
})
test('un outsider nu poate scrie clienți în alt workspace', async () => {
  await assertFails(setDoc(doc(ctx(OUTSIDER), 'workspaces', W1, 'clienti', 'x'), { denumire: 'evil' }))
})
test('utilizator neautentificat nu citește nimic', async () => {
  const db = env.unauthenticatedContext().firestore()
  await assertFails(getDoc(doc(db, 'workspaces', W1, 'clienti', 'c1')))
})
test('e-mail neverificat = fără acces', async () => {
  const db = ctx(MEMBER, { email_verified: false })
  await assertFails(getDoc(doc(db, 'workspaces', W1, 'clienti', 'c1')))
})

// Interogarea exactă folosită de frontend (lib/workspace.ts) la încărcarea workspace-urilor.
test('interogarea „workspace-urile mele” trece de reguli', async () => {
  const q = query(collection(ctx(MEMBER), 'workspaces'), where(`members.${MEMBER}.role`, 'in', ['admin', 'member', 'viewer']))
  const snap = await assertSucceeds(getDocs(q))
  assert.equal(snap.size, 1)
  assert.equal(snap.docs[0].id, W1)
})
test('nu poți lista workspace-urile altora', async () => {
  const q = query(collection(ctx(OUTSIDER), 'workspaces'), where(`members.${MEMBER}.role`, 'in', ['admin', 'member', 'viewer']))
  await assertFails(getDocs(q))
})

// ── Roluri ───────────────────────────────────────────────────────────────────
test('viewer citește, dar nu scrie', async () => {
  await assertSucceeds(getDoc(doc(ctx(VIEWER), 'workspaces', W1, 'clienti', 'c1')))
  await assertFails(setDoc(doc(ctx(VIEWER), 'workspaces', W1, 'clienti', 'n'), { denumire: 'n' }))
  await assertFails(updateDoc(doc(ctx(VIEWER), 'workspaces', W1, 'clienti', 'c1'), { denumire: 'y' }))
})
test('member creează/editează clienți', async () => {
  await assertSucceeds(setDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'n'), { denumire: 'n', createdBy: MEMBER }))
  await assertSucceeds(updateDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1'), { denumire: 'y' }))
})
test('clienții nu se șterg direct din client (doar prin API, cu cascadă)', async () => {
  await assertFails(deleteDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1')))
  await assertFails(deleteDoc(doc(ctx(ADMIN), 'workspaces', W1, 'clienti', 'c1')))
})
test('vault-ul de CNP și cheile nu sunt accesibile din client, nici adminului', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'workspaces', W1, 'clienti', 'c1', 'pii', 'vault'), { persons: { p: 'x' } })
    await setDoc(doc(c.firestore(), 'workspaceKeys', W1), { wrapped: 'x' })
  })
  for (const uid of [ADMIN, MEMBER, VIEWER, SUPER]) {
    await assertFails(getDoc(doc(ctx(uid), 'workspaces', W1, 'clienti', 'c1', 'pii', 'vault')))
    await assertFails(getDoc(doc(ctx(uid), 'workspaceKeys', W1)))
  }
  await assertFails(setDoc(doc(ctx(ADMIN), 'workspaces', W1, 'clienti', 'c1', 'pii', 'vault'), { persons: {} }))
  await assertFails(setDoc(doc(ctx(ADMIN), 'workspaceKeys', W1), { wrapped: 'evil' }))
})
test('createdBy e imutabil', async () => {
  await assertFails(updateDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1'), { createdBy: MEMBER }))
})

// ── Câmpuri protejate pe workspace ───────────────────────────────────────────
test('nimeni nu creează workspace din client', async () => {
  await assertFails(setDoc(doc(ctx('uNew'), 'workspaces', 'workspaceCCCCCC3'), {
    name: 'x', ownerId: 'uNew', members: { uNew: { role: 'admin' } },
  }))
})
test('adminul nu poate modifica members / ownerId / consent', async () => {
  const ref = doc(ctx(ADMIN), 'workspaces', W1)
  await assertFails(updateDoc(ref, { [`members.${MEMBER}.role`]: 'admin' }))
  await assertFails(updateDoc(ref, { [`members.uEvil`]: { role: 'admin' } }))
  await assertFails(updateDoc(ref, { [`members.${ADMIN}`]: deleteField() }))
  await assertFails(updateDoc(ref, { ownerId: MEMBER }))
  await assertFails(updateDoc(ref, { consent: { tos: 'x' } }))
  await assertFails(updateDoc(ref, { features: { x: true } }))
})
test('adminul poate redenumi workspace-ul; memberul nu', async () => {
  await assertSucceeds(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { name: 'Nou' }))
  await assertFails(updateDoc(doc(ctx(MEMBER), 'workspaces', W1), { name: 'Nou' }))
})
test('un utilizator nu se poate adăuga singur ca membru', async () => {
  await assertFails(updateDoc(doc(ctx('uNew'), 'workspaces', W1), { 'members.uNew': { role: 'admin' } }))
})
test('workspace-ul nu se șterge din client', async () => {
  await assertFails(deleteDoc(doc(ctx(ADMIN), 'workspaces', W1)))
})

// ── Invitații ────────────────────────────────────────────────────────────────
test('invitațiile nu sunt accesibile din client (nici măcar invitatului)', async () => {
  const db = ctx('uX', { email: 'x@ex.ro' })
  await assertFails(getDoc(doc(db, 'invitations', 'inv1')))
  await assertFails(setDoc(doc(ctx(ADMIN), 'invitations', 'inv2'), { email: 'v@ex.ro', workspaceId: W1 }))
  await assertFails(updateDoc(doc(db, 'invitations', 'inv1'), { status: 'accepted' }))
  await assertFails(getDoc(doc(db, 'workspaceCreators', 'c1')))
  await assertFails(setDoc(doc(ctx(ADMIN), 'workspaceCreators', 'c1'), { email: 'v@ex.ro' }))
})

// ── Audit și istoric ─────────────────────────────────────────────────────────
test('auditLog: doar adminul citește, nimeni nu scrie', async () => {
  await assertSucceeds(getDoc(doc(ctx(ADMIN), 'workspaces', W1, 'auditLog', 'a1')))
  await assertFails(getDoc(doc(ctx(MEMBER), 'workspaces', W1, 'auditLog', 'a1')))
  await assertFails(addDoc(collection(ctx(ADMIN), 'workspaces', W1, 'auditLog'), { action: 'forged' }))
  await assertFails(deleteDoc(doc(ctx(ADMIN), 'workspaces', W1, 'auditLog', 'a1')))
})
test('docGenerations: append-only', async () => {
  const col = collection(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1', 'docGenerations')
  await assertSucceeds(addDoc(col, { templateId: 't2' }))
  await assertFails(updateDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1', 'docGenerations', 'g1'), { templateId: 'z' }))
  await assertFails(deleteDoc(doc(ctx(ADMIN), 'workspaces', W1, 'clienti', 'c1', 'docGenerations', 'g1')))
})

// ── Super admin ──────────────────────────────────────────────────────────────
test('super adminul vede workspace-ul, dar nu datele clienților', async () => {
  const db = ctx(SUPER)
  await assertSucceeds(getDoc(doc(db, 'workspaces', W1)))
  await assertFails(getDoc(doc(db, 'workspaces', W1, 'clienti', 'c1')))
  await assertFails(getDoc(doc(db, 'workspaces', W1, 'auditLog', 'a1')))
})
test('super adminul poate modifica doar features', async () => {
  const ref = doc(ctx(SUPER), 'workspaces', W1)
  await assertSucceeds(updateDoc(ref, { 'features.dosare': true }))
  await assertFails(updateDoc(ref, { name: 'hack' }))
  await assertFails(updateDoc(ref, { [`members.${SUPER}`]: { role: 'admin' } }))
})
test('un utilizator nu se poate face super admin fără grant', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'users', 'uNew'), { isSuperAdmin: false }))
  await assertFails(updateDoc(doc(ctx('uNew'), 'users', 'uNew'), { isSuperAdmin: true }))
})
test('super adminul într-o sesiune cu parolă nu are rolul', async () => {
  await assertSucceeds(getDocs(collection(ctx(SUPER), 'superAdminGrants')))
  await assertFails(getDocs(collection(ctx(SUPER, PASSWORD), 'superAdminGrants')))
})
test('un cabinet programat pentru ștergere nu mai e accesibil membrilor', async () => {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'workspaces', 'wsSters'), { name: 'S', status: 'pendingDeletion', members: { [ADMIN]: { role: 'admin' } }, billing: BILLING_OK })
    await setDoc(doc(c.firestore(), 'workspaces', 'wsSters', 'clienti', 'c1'), { x: 1 })
    await setDoc(doc(c.firestore(), 'accountDeletions', ADMIN), { email: 'x@ex.ro' })
  })
  await assertFails(getDoc(doc(ctx(ADMIN), 'workspaces', 'wsSters', 'clienti', 'c1')))
  await assertFails(setDoc(doc(ctx(ADMIN), 'workspaces', 'wsSters', 'clienti', 'c2'), { x: 1 }))
  await assertFails(getDoc(doc(ctx(ADMIN), 'accountDeletions', ADMIN)))
  await assertFails(getDoc(doc(ctx(SUPER), 'accountDeletions', ADMIN)))
})
test('doar super adminul poate retrage un grant', async () => {
  const ref = db => doc(db, 'superAdminGrants', 'retras_AT_ex_DOT_ro')
  await env.withSecurityRulesDisabled(c => setDoc(ref(c.firestore()), { email: 'retras@ex.ro', used: false }))
  await assertFails(deleteDoc(ref(ctx(ADMIN))))
  await assertFails(deleteDoc(ref(ctx(SUPER, PASSWORD))))
  await assertSucceeds(deleteDoc(ref(ctx(SUPER))))
})
test('un grant de super admin nu se poate folosi sau consuma într-o sesiune cu parolă', async () => {
  const email = 'ugrant@ex.ro'
  const grant = 'ugrant_AT_ex_DOT_ro'
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'users', 'uGrant'), { isSuperAdmin: false })
    await setDoc(doc(c.firestore(), 'superAdminGrants', grant), { email, used: false })
  })
  await assertFails(updateDoc(doc(ctx('uGrant', PASSWORD), 'users', 'uGrant'), { isSuperAdmin: true }))
  await assertFails(updateDoc(doc(ctx('uGrant', PASSWORD), 'superAdminGrants', grant), { used: true }))
  await assertSucceeds(updateDoc(doc(ctx('uGrant', { email }), 'users', 'uGrant'), { isSuperAdmin: true }))
})

// ── Istoric extrageri: fără date personale ────────────────────────────────────
test('extrageri: se scriu doar metadate; câmpurile personale sunt refuzate', async () => {
  const col = collection(ctx('uNew'), 'users', 'uNew', 'extractions')
  await assertSucceeds(addDoc(col, { createdAt: new Date(), sourceFile: 'ci.jpg', expireAt: new Date() }))
  await assertFails(addDoc(col, { createdAt: new Date(), sourceFile: 'ci.jpg', fields: { cnp: '1800101221144' } }))
  await assertFails(addDoc(col, { createdAt: new Date(), sourceFile: 'ci.jpg', cnp: '1800101221144' }))
})
test('extrageri: nu se pot actualiza cu date personale și nu sunt vizibile altora', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'users', 'uNew', 'extractions', 'e1'), { sourceFile: 'x' }))
  await assertFails(updateDoc(doc(ctx('uNew'), 'users', 'uNew', 'extractions', 'e1'), { fields: { cnp: '1' } }))
  await assertFails(getDoc(doc(ctx('uOther'), 'users', 'uNew', 'extractions', 'e1')))
  await assertSucceeds(getDoc(doc(ctx('uNew'), 'users', 'uNew', 'extractions', 'e1')))
  await assertSucceeds(deleteDoc(doc(ctx('uNew'), 'users', 'uNew', 'extractions', 'e1')))
})

// ── Contoare de limitare: doar server ─────────────────────────────────────────
test('rateLimits nu e accesibil din client (nici citire, nici scriere, nici adminilor)', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'rateLimits', 'abc'), { count: 1 }))
  for (const uid of [ADMIN, MEMBER, VIEWER, SUPER]) {
    await assertFails(getDoc(doc(ctx(uid), 'rateLimits', 'abc')))
    await assertFails(setDoc(doc(ctx(uid), 'rateLimits', 'abc'), { count: 0 }))
  }
})

// ── Abonament: după expirare cabinetul e în citire + export ──────────────────
const expire = (billing = { status: 'expired', accessUntil: PAST }) =>
  env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'workspaces', W1), { billing }))

test('cabinet expirat: citirea și interogările de export merg', async () => {
  await expire()
  await assertSucceeds(getDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1')))
  await assertSucceeds(getDocs(collection(ctx(VIEWER), 'workspaces', W1, 'clienti')))
  await assertSucceeds(getDocs(collection(ctx(ADMIN), 'workspaces', W1, 'clienti', 'c1', 'docGenerations')))
})
test('cabinet expirat: nu se creează și nu se modifică nimic, nici de admin', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore()
    await setDoc(doc(db, 'workspaces', W1, 'dosare', 'd1'), { t: 1, createdBy: ADMIN })
    await setDoc(doc(db, 'workspaces', W1, 'sarcini', 's1'), { t: 1, createdBy: ADMIN })
    await setDoc(doc(db, 'workspaces', W1, 'docTemplates', 't1'), { t: 1 })
  })
  await expire()
  for (const uid of [ADMIN, MEMBER]) {
    const db = ctx(uid)
    await assertFails(setDoc(doc(db, 'workspaces', W1, 'clienti', 'n'), { denumire: 'n', createdBy: uid }))
    await assertFails(updateDoc(doc(db, 'workspaces', W1, 'clienti', 'c1'), { denumire: 'Y' }))
    await assertFails(addDoc(collection(db, 'workspaces', W1, 'clienti', 'c1', 'docGenerations'), { templateId: 't' }))
    for (const [coll, id] of [['dosare', 'd1'], ['sarcini', 's1'], ['docTemplates', 't1']]) {
      await assertFails(setDoc(doc(db, 'workspaces', W1, coll, 'nou'), { t: 1, createdBy: uid }))
      await assertFails(updateDoc(doc(db, 'workspaces', W1, coll, id), { t: 2 }))
      await assertFails(deleteDoc(doc(db, 'workspaces', W1, coll, id)))
    }
  }
})
test('cabinet expirat: adminul poate încă redenumi cabinetul', async () => {
  await expire()
  await assertSucceeds(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { name: 'Nou' }))
})
test('workspace fără câmpul billing: scrierile sunt refuzate (fail closed)', async () => {
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'workspaces', W1), { billing: deleteField() }))
  await assertFails(setDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'n'), { denumire: 'n', createdBy: MEMBER }))
  await assertSucceeds(getDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'c1')))
})
test('accessUntil de alt tip decât timestamp nu dă acces', async () => {
  await expire({ status: 'active', accessUntil: '2999-01-01' })
  await assertFails(setDoc(doc(ctx(MEMBER), 'workspaces', W1, 'clienti', 'n'), { denumire: 'n', createdBy: MEMBER }))
})
test('nici adminul, nici super adminul nu pot scrie billing', async () => {
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { 'billing.accessUntil': new Date(2999, 0, 1) }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { billing: deleteField() }))
  await assertFails(updateDoc(doc(ctx(SUPER), 'workspaces', W1), { 'billing.accessUntil': new Date(2999, 0, 1) }))
})
test('membrii văd starea abonamentului pe documentul cabinetului', async () => {
  const snap = await assertSucceeds(getDoc(doc(ctx(VIEWER), 'workspaces', W1)))
  assert.equal(snap.data().billing.status, 'trialing')
})
test('billingAccounts / stripeEvents / trialClaims nu sunt accesibile din client', async () => {
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore()
    await setDoc(doc(db, 'billingAccounts', W1), { stripeCustomerId: 'cus_x' })
    await setDoc(doc(db, 'billingAccounts', W1, 'invoices', 'in_1'), { amount: 20000 })
    await setDoc(doc(db, 'stripeEvents', 'evt_1'), { status: 'done' })
    await setDoc(doc(db, 'trialClaims', 'abc'), { kind: 'email' })
  })
  for (const uid of [ADMIN, MEMBER, SUPER]) {
    const db = ctx(uid)
    for (const path of [['billingAccounts', W1], ['billingAccounts', W1, 'invoices', 'in_1'], ['stripeEvents', 'evt_1'], ['trialClaims', 'abc']]) {
      await assertFails(getDoc(doc(db, ...path)))
      await assertFails(setDoc(doc(db, ...path), { x: 1 }))
    }
  }
})

// ── Șabloane proprii (fișierul și livrarea se scriu doar prin server, templates_api.py) ──
const TPL = { name: 'Act', type: 'docx', fileBase64: 'UEsDBA==', fileName: 'act.docx', placeholders: [], createdBy: MEMBER }
async function seedTemplate() {
  await env.withSecurityRulesDisabled(async c => {
    await setDoc(doc(c.firestore(), 'workspaces', W1, 'docTemplates', 't1'), { ...TPL, revision: 2, sourceKey: 'hotarare_aga' })
  })
}
const GDOC = { name: 'Act', type: 'gdoc', docId: 'abc', outputNameTemplate: 'Act', createdBy: MEMBER }
test('șabloane: membrul creează un șablon Google Docs; vizualizatorul și un outsider nu', async () => {
  await assertSucceeds(setDoc(doc(ctx(MEMBER), 'workspaces', W1, 'docTemplates', 'n'), GDOC))
  await assertFails(setDoc(doc(ctx(VIEWER), 'workspaces', W1, 'docTemplates', 'n2'), GDOC))
  await assertFails(setDoc(doc(ctx(OUTSIDER), 'workspaces', W1, 'docTemplates', 'n3'), GDOC))
})
test('șabloane: un .docx nu se creează din browser, doar prin server (verificarea fișierului)', async () => {
  const db = ctx(MEMBER)
  await assertFails(setDoc(doc(db, 'workspaces', W1, 'docTemplates', 'x'), TPL))
  await assertFails(setDoc(doc(db, 'workspaces', W1, 'docTemplates', 'x'), { ...GDOC, fileBase64: 'UEsDBA==' }))
  await assertFails(setDoc(doc(db, 'workspaces', W1, 'docTemplates', 'x'), { ...GDOC, type: 'docx' }))
})
test('șabloane: la creare nu se pot pune câmpuri scrise de server', async () => {
  const db = ctx(MEMBER)
  for (const extra of [{ delivery: { by: SUPER } }, { revision: 5 }, { updatedBy: MEMBER }, { updatedAt: new Date() }]) {
    await assertFails(setDoc(doc(db, 'workspaces', W1, 'docTemplates', 'x'), { ...GDOC, ...extra }))
  }
})
test('șabloane: din browser se redenumesc, dar fișierul, sourceKey și revizia nu se schimbă', async () => {
  await seedTemplate()
  const ref = doc(ctx(MEMBER), 'workspaces', W1, 'docTemplates', 't1')
  await assertSucceeds(updateDoc(ref, { name: 'Nou', description: 'd', outputNameTemplate: 'o.docx', tipTemplate: 'PJ' }))
  for (const patch of [{ fileBase64: 'UEsDBB==' }, { placeholders: ['{{X}}'] }, { sourceKey: 'anexa1_inregistrare_fiscala' },
    { revision: 3 }, { delivery: { by: MEMBER } }, { createdBy: ADMIN }]) {
    await assertFails(updateDoc(ref, patch))
  }
  await assertSucceeds(deleteDoc(ref))
})
test('șabloane: editarea din browser validează valorile câmpurilor schimbate', async () => {
  await seedTemplate()
  const ref = doc(ctx(MEMBER), 'workspaces', W1, 'docTemplates', 't1')
  for (const patch of [{ name: '' }, { name: 'x'.repeat(201) }, { name: 5 }, { description: 'x'.repeat(1001) },
    { outputNameTemplate: 'x'.repeat(301) }, { tipTemplate: 'SRL' }, { tipTemplate: null }]) {
    await assertFails(updateDoc(ref, patch))
  }
  await assertSucceeds(updateDoc(ref, { tipTemplate: 'universal', description: '' }))
  await assertFails(updateDoc(doc(ctx(VIEWER), 'workspaces', W1, 'docTemplates', 't1'), { name: 'Alt nume' }))
})
test('templateOrder: doar adminul îl schimbă, ca listă de cel mult 500', async () => {
  await assertSucceeds(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateOrder: ['b:act_constitutiv', 't:t1'] }))
  await assertFails(updateDoc(doc(ctx(MEMBER), 'workspaces', W1), { templateOrder: [] }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateOrder: 'b:act_constitutiv' }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateOrder: Array.from({ length: 501 }, (_, i) => `t:${i}`) }))
})
test('templateFolders/templateFolderOf: doar adminul le schimbă, ca listă și hartă, cu limite', async () => {
  const folders = [{ id: 'f1', name: 'Contracte' }]
  await assertSucceeds(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateFolders: folders, templateFolderOf: { 't:t1': 'f1' } }))
  await assertFails(updateDoc(doc(ctx(MEMBER), 'workspaces', W1), { templateFolders: folders, templateFolderOf: {} }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateFolders: 'Contracte' }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateFolderOf: ['t:t1'] }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { templateFolders: Array.from({ length: 101 }, (_, i) => ({ id: `f${i}`, name: 'x' })) }))
})
test('hiddenBuiltins: doar adminul îl schimbă, ca listă de cel mult 50', async () => {
  await assertSucceeds(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { hiddenBuiltins: ['act_constitutiv'] }))
  await assertFails(updateDoc(doc(ctx(MEMBER), 'workspaces', W1), { hiddenBuiltins: [] }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { hiddenBuiltins: 'act_constitutiv' }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { hiddenBuiltins: Array.from({ length: 51 }, (_, i) => `k${i}`) }))
  await assertFails(updateDoc(doc(ctx(ADMIN), 'workspaces', W1), { hiddenBuiltins: [], members: {} }))
})
