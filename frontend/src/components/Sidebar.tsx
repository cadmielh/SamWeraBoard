import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import type { User } from 'firebase/auth'
import type { Workspace } from '../types'
import ThemeToggleSwitch from './ThemeToggleSwitch'

interface Props {
  user: User
  activeWorkspace: Workspace | null
  workspaces: Workspace[]
  userRole: 'admin' | 'member' | null
  isSuperAdmin: boolean
  onSignOut: () => void
  onWorkspaceChange: (w: Workspace) => void
  onWorkspaceCreate: (name: string) => Promise<void>
  onWorkspaceRename: (workspaceId: string, newName: string) => Promise<void>
}

function IconClients() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.2" cy="6.5" r="2.7" />
      <path d="M2.2 17c0-3.3 2.2-5.8 5-5.8s5 2.5 5 5.8" />
      <circle cx="14.5" cy="7.3" r="2.1" />
      <path d="M12.7 11.6c1.9.4 3.4 2.4 3.6 5" />
    </svg>
  )
}
function IconDosare() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.2 2.5h5.1l3.5 3.5v10.3a1 1 0 0 1-1 1H6.2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M11.3 2.5v3.2a.6.6 0 0 0 .6.6h3.2" />
      <path d="M7.5 10.3h5M7.5 13h5" />
    </svg>
  )
}
function IconSarcini() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.6" y="2.6" width="14.8" height="14.8" rx="3.2" />
      <path d="M6.3 10.2l2.2 2.2 4.6-5" />
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
      <circle cx="7.5" cy="6.5" r="3" />
      <path d="M2 17c0-3.6 2.5-6.3 5.5-6.3c.9 0 1.7.2 2.5.7" />
      <circle cx="14.5" cy="14" r="3.3" />
      <path d="M13 14l1 1 2-2.2" />
    </svg>
  )
}
function IconSettings() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="5.8" />
      <circle cx="10" cy="10" r="2.3" />
      <path d="M10 1.8v2.4M10 15.8v2.4M18.2 10h-2.4M4.2 10H1.8M15.6 4.4l-1.7 1.7M6.1 13.9l-1.7 1.7M15.6 15.6l-1.7-1.7M6.1 6.1 4.4 4.4" />
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
function IconSidebarToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'scaleX(-1)' : undefined }}>
      <rect x="2.5" y="3" width="15" height="14" rx="2.2" />
      <path d="M7.8 3v14" />
      <path d="M12 8l2 2-2 2" />
    </svg>
  )
}
function IconShield() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.2l6.2 2.4v4.6c0 4.1-2.6 7.3-6.2 8.6c-3.6-1.3-6.2-4.5-6.2-8.6V4.6L10 2.2Z" />
      <path d="M7.3 10.1l1.9 1.9 3.5-3.9" />
    </svg>
  )
}
function IconSignOut() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H4.5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1H8" />
      <path d="M13 6.5l3.5 3.5-3.5 3.5" />
      <path d="M16.5 10H8" />
    </svg>
  )
}

const COLLAPSE_KEY = 'samwera-sidebar-collapsed'

export default function Sidebar({ user, activeWorkspace, workspaces, userRole, isSuperAdmin, onSignOut, onWorkspaceChange, onWorkspaceCreate, onWorkspaceRename }: Props) {
  const initials = (user.displayName ?? user.email ?? '?')[0].toUpperCase()

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [menuOpen, setMenuOpen] = useState(false)
  const [action, setAction] = useState<'idle' | 'rename' | 'create'>('idle')
  const [inputVal, setInputVal] = useState('')
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      if (next) closeAll()
      return next
    })
  }

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
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      {/* Logo + restrângere meniu, pe același rând, butonul cât mai în dreapta */}
      <div className="sidebar-logo">
        {!collapsed && <span className="sidebar-logo-text">SamWera<b>Board</b></span>}
        <button
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? 'Extinde meniul' : 'Restrânge meniul'}
          aria-label={collapsed ? 'Extinde meniul' : 'Restrânge meniul'}
        >
          <IconSidebarToggle collapsed={collapsed} />
        </button>
      </div>

      {/* Comutator light/dark */}
      <div className="sidebar-theme-row">
        <ThemeToggleSwitch />
      </div>

      {/* Workspace selector */}
      {activeWorkspace && !collapsed && (
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
        {!collapsed && <div className="sidebar-section">Meniu</div>}

        <NavLink to="/" end title="Clienți" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconClients />
          <span className="sidebar-nav-label">Clienți</span>
        </NavLink>

        <NavLink to="/dosare" title="Dosare" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconDosare />
          <span className="sidebar-nav-label">Dosare</span>
        </NavLink>

        <NavLink to="/sarcini" title="Sarcini" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconSarcini />
          <span className="sidebar-nav-label">Sarcini</span>
        </NavLink>

        <NavLink to="/extragere" title="Generare Documente" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconExtract />
          <span className="sidebar-nav-label">Generare Documente</span>
        </NavLink>

        <NavLink to="/setari" title="Setări" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconSettings />
          <span className="sidebar-nav-label">Setări</span>
        </NavLink>

        {userRole === 'admin' && (
          <div style={{ marginTop: isSuperAdmin ? 0 : 'auto' }}>
            {!collapsed && <div className="sidebar-section">Administrare</div>}
            <NavLink to="/utilizatori" title="Utilizatori" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
              <IconUsers />
              <span className="sidebar-nav-label">Utilizatori</span>
            </NavLink>
          </div>
        )}

        {isSuperAdmin && (
          <div style={{ marginTop: userRole === 'admin' ? 0 : 'auto' }}>
            {!collapsed && <div className="sidebar-section">Super admin</div>}
            <NavLink to="/super-admin" title="Super admin" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
              <IconShield />
              <span className="sidebar-nav-label">Super admin</span>
            </NavLink>
          </div>
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
          {!collapsed && (
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.displayName ?? 'Utilizator'}</div>
              <div className="sidebar-user-email">{user.email}</div>
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm btn-full" onClick={onSignOut} title="Deconectare">
          {collapsed ? <IconSignOut /> : 'Deconectare'}
        </button>
      </div>
    </aside>
  )
}
