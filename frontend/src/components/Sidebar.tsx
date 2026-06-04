import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import type { User } from 'firebase/auth'
import type { Workspace } from '../types'

interface Props {
  user: User
  activeWorkspace: Workspace | null
  workspaces: Workspace[]
  userRole: 'admin' | 'member' | null
  onSignOut: () => void
  onWorkspaceChange: (w: Workspace) => void
  onWorkspaceCreate: (name: string) => Promise<void>
  onWorkspaceRename: (workspaceId: string, newName: string) => Promise<void>
}

function IconClients() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d="M2 7h16M6 3v4M14 3v4" />
    </svg>
  )
}
function IconExtract() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="12" height="16" rx="2" />
      <path d="M7 7h6M7 10h4M7 13h5" />
    </svg>
  )
}
function IconUsers() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="7" r="3" />
      <path d="M2 17c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M14 5c1.7 0 3 1.3 3 3s-1.3 3-3 3M18 17c0-2.2-1.3-4.1-3-4.9" />
    </svg>
  )
}
function IconChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 7l3.5 3.5L11 3" />
    </svg>
  )
}

export default function Sidebar({ user, activeWorkspace, workspaces, userRole, onSignOut, onWorkspaceChange, onWorkspaceCreate, onWorkspaceRename }: Props) {
  const initials = (user.displayName ?? user.email ?? '?')[0].toUpperCase()

  const [menuOpen, setMenuOpen] = useState(false)
  const [action, setAction] = useState<'idle' | 'rename' | 'create'>('idle')
  const [inputVal, setInputVal] = useState('')
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpen && action === 'idle') return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        closeAll()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen, action])

  useEffect(() => {
    if (action !== 'idle') {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [action])

  function closeAll() {
    setMenuOpen(false)
    setAction('idle')
    setInputVal('')
  }

  function openAction(a: 'rename' | 'create') {
    if (a === 'rename') setInputVal(activeWorkspace?.name ?? '')
    else setInputVal('')
    setAction(a)
    setMenuOpen(false)
  }

  async function handleSubmit() {
    if (!inputVal.trim()) return
    setSaving(true)
    try {
      if (action === 'rename' && activeWorkspace) {
        await onWorkspaceRename(activeWorkspace.id, inputVal.trim())
      } else if (action === 'create') {
        await onWorkspaceCreate(inputVal.trim())
      }
      closeAll()
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <span>SamWera<b>Board</b></span>
      </div>

      {/* Workspace selector */}
      {activeWorkspace && (
        <div className="sidebar-ws" ref={containerRef}>
          <div className="sidebar-ws-label">Spațiu de lucru</div>

          {/* Trigger button */}
          <button
            className="sidebar-ws-btn"
            onClick={() => { if (action !== 'idle') { closeAll(); return } setMenuOpen(o => !o) }}
            aria-expanded={menuOpen}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeWorkspace.name}
            </span>
            <span style={{ flexShrink: 0, color: 'var(--s400)', transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
              <IconChevron />
            </span>
          </button>

          {/* Dropdown menu */}
          {menuOpen && action === 'idle' && (
            <div className="ws-dropdown">
              {workspaces.map(w => (
                <button
                  key={w.id}
                  className={'ws-dropdown-item' + (w.id === activeWorkspace.id ? ' ws-dropdown-item--active' : '')}
                  onClick={() => { onWorkspaceChange(w); closeAll() }}
                >
                  <span className="ws-dropdown-item__check">
                    {w.id === activeWorkspace.id && <IconCheck />}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                </button>
              ))}

              <hr className="ws-dropdown-sep" />

              {userRole === 'admin' && (
                <button className="ws-dropdown-item" onClick={() => openAction('rename')}>
                  <span className="ws-dropdown-item__check" />
                  <span>Redenumire spațiu curent...</span>
                </button>
              )}
              <button className="ws-dropdown-item" onClick={() => openAction('create')}>
                <span className="ws-dropdown-item__check" />
                <span>Spațiu de lucru nou...</span>
              </button>
            </div>
          )}

          {/* Inline rename / create form */}
          {action !== 'idle' && (
            <div className="ws-inline-form">
              <div style={{ fontSize: '.72rem', color: 'var(--s400)', marginBottom: '.35rem', fontWeight: 600 }}>
                {action === 'rename' ? 'Redenumire spațiu' : 'Spațiu de lucru nou'}
              </div>
              <input
                ref={inputRef}
                className="field-input"
                style={{ fontSize: '.8125rem', padding: '.4rem .6rem' }}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSubmit(); if (e.key === 'Escape') closeAll() }}
                placeholder={action === 'rename' ? 'Nume nou...' : 'Numele cabinetului...'}
              />
              <div style={{ display: 'flex', gap: '.375rem', marginTop: '.4rem' }}>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1, fontSize: '.78rem' }}
                  onClick={handleSubmit}
                  disabled={!inputVal.trim() || saving}
                >
                  {saving ? <span className="spin" /> : (action === 'rename' ? 'Salvează' : 'Creează')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '.78rem' }}
                  onClick={closeAll}
                  disabled={saving}
                >
                  Anulează
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-section">Meniu</div>

        <NavLink to="/" end className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconClients />
          Clienți
        </NavLink>

        <NavLink to="/extragere" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconExtract />
          Extragere buletin
        </NavLink>

        {userRole === 'admin' && (
          <>
            <div className="sidebar-section" style={{ marginTop: '.5rem' }}>Administrare</div>
            <NavLink to="/utilizatori" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
              <IconUsers />
              Utilizatori
            </NavLink>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          {user.photoURL ? (
            <img src={user.photoURL} alt="" />
          ) : (
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--p100)', color: 'var(--p600)', fontSize: '.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {initials}
            </div>
          )}
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{user.displayName ?? 'Utilizator'}</div>
            <div className="sidebar-user-email">{user.email}</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm btn-full" onClick={onSignOut}>
          Deconectare
        </button>
      </div>
    </aside>
  )
}
