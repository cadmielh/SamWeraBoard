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

const ctx = (uid, extra = {}) =>
  env.authenticatedContext(uid, { email: `${uid}@ex.ro`, email_verified: true, ...extra }).firestore()

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
      name: 'W1', ownerId: ADMIN, status: 'active',
      members: {
        [ADMIN]: { role: 'admin', email: 'a@ex.ro' },
        [MEMBER]: { role: 'member', email: 'm@ex.ro' },
        [VIEWER]: { role: 'viewer', email: 'v@ex.ro' },
      },
    })
    await setDoc(doc(db, 'workspaces', W2), {
      name: 'W2', ownerId: OUTSIDER, status: 'active',
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
