import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import type { User } from 'firebase/auth'
import type { Workspace } from '../types'
import ThemeToggleSwitch from './ThemeToggleSwitch'
import LogoMark from './LogoMark'
import { planSummary } from '../lib/billing'
import { useApp } from '../AppContext'
import { preloadRoute } from '../routes'
import { isPlainClick, withViewTransition } from '../lib/viewTransition'
import BtnLabel from './BtnLabel'
import { GhidIntrare } from './GhidPornire'
import { IconClients, IconDosare, IconSarcini, IconExtract, IconSettings, IconShield, IconSignOut } from './NavIcons'

interface Props {
  user: User
  activeWorkspace: Workspace | null
  workspaces: Workspace[]
  userRole: 'admin' | 'member' | 'viewer' | null
  isSuperAdmin: boolean
  onSignOut: () => void
  onWorkspaceChange: (w: Workspace) => void
  onWorkspaceRename: (workspaceId: string, newName: string) => Promise<void>
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

const COLLAPSE_KEY = 'samwera-sidebar-collapsed'



const LEGAL_LINKS: [string, string][] = [
  ['/termeni', 'Termeni'],
  ['/confidentialitate', 'Confidențialitate'],
  ['/dpa', 'DPA'],
  ['/sub-imputerniciti', 'Sub-împuterniciți'],
  ['/securitate', 'Securitate'],
]

export default function Sidebar({ user, activeWorkspace, workspaces, userRole, isSuperAdmin, onSignOut, onWorkspaceChange, onWorkspaceRename }: Props) {
  // Starea planului (probă, credite, abonament): indicator jos în meniu, pentru administratori.
  const { billing } = useApp()
  const plan = planSummary(billing)
  const navigate = useNavigate()
  // Legăturile din meniu: pagina începe să se descarce când mouse-ul (sau focusul) ajunge pe ea,
  // iar la clic schimbarea de pagină trece printr-o tranziție scurtă a browserului.
  const navProps = (path: string) => ({
    onMouseEnter: () => preloadRoute(path),
    onFocus: () => preloadRoute(path),
    onClick: (e: React.MouseEvent) => {
      if (!isPlainClick(e)) return
      e.preventDefault()
      withViewTransition(() => navigate(path))
    },
  })
  const initials = (user.displayName ?? user.email ?? '?')[0].toUpperCase()

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [menuOpen, setMenuOpen] = useState(false)
  const [action, setAction] = useState<'idle' | 'rename'>('idle')
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

  function openAction(a: 'rename') {
    setInputVal(activeWorkspace?.name ?? '')
    setAction(a)
    setMenuOpen(false)
  }

  async function handleSubmit() {
    if (!inputVal.trim()) return
    setSaving(true)
    try {
      if (action === 'rename' && activeWorkspace) {
        await onWorkspaceRename(activeWorkspace.id, inputVal.trim())
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
        <LogoMark size={24} className="sidebar-logo-mark" />
        {!collapsed && <span className="sidebar-logo-text">Cabin<b>io</b></span>}
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
              <button className="ws-dropdown-item" onClick={() => { setMenuOpen(false); navigate('/workspace/setup?nou=1') }}>
                <span className="ws-dropdown-item__check" />
                <span>Spațiu de lucru nou...</span>
              </button>
            </div>
          )}

          {/* Inline rename / create form */}
          {action !== 'idle' && (
            <div className="ws-inline-form">
              <div style={{ fontSize: '.72rem', color: 'var(--s400)', marginBottom: '.35rem', fontWeight: 600 }}>
                Redenumire spațiu
              </div>
              <input
                ref={inputRef}
                className="field-input"
                style={{ fontSize: '.8125rem', padding: '.4rem .6rem' }}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSubmit(); if (e.key === 'Escape') closeAll() }}
                placeholder="Nume nou..."
              />
              <div style={{ display: 'flex', gap: '.375rem', marginTop: '.4rem' }}>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1, fontSize: '.78rem' }}
                  onClick={handleSubmit}
                  disabled={!inputVal.trim() || saving}
                >
                  <BtnLabel busy={saving}>Salvează</BtnLabel>
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

        <NavLink to="/" end {...navProps('/')} title="Clienți" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconClients />
          <span className="sidebar-nav-label">Clienți</span>
        </NavLink>

        <NavLink to="/dosare" {...navProps('/dosare')} title="Dosare" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconDosare />
          <span className="sidebar-nav-label">Dosare</span>
        </NavLink>

        <NavLink to="/sarcini" {...navProps('/sarcini')} title="Sarcini" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconSarcini />
          <span className="sidebar-nav-label">Sarcini</span>
        </NavLink>

        <NavLink to="/extragere" {...navProps('/extragere')} title="Generare Documente" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconExtract />
          <span className="sidebar-nav-label">Generare Documente</span>
        </NavLink>

        <NavLink to="/setari" {...navProps('/setari')} title="Setări" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
          <IconSettings />
          <span className="sidebar-nav-label">Setări</span>
        </NavLink>

        {isSuperAdmin && (
          <div style={{ marginTop: 'auto' }}>
            {!collapsed && <div className="sidebar-section">Super admin</div>}
            <NavLink to="/super-admin" {...navProps('/super-admin')} title="Super admin" className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}>
              <IconShield />
              <span className="sidebar-nav-label">Super admin</span>
            </NavLink>
          </div>
        )}
      </nav>

      <GhidIntrare />

      {/* Starea planului: duce la Setări › Plan și credite. */}
      {userRole === 'admin' && activeWorkspace && (
        <NavLink to="/setari/plan" {...navProps('/setari/plan')} title={`${plan.label} · ${plan.sub}`}
          className={`sidebar-plan${plan.tone === 'ok' ? '' : ` sidebar-plan--${plan.tone}`}`}>
          <span className="sidebar-plan-dot" aria-hidden />
          <span className="sidebar-plan-text"><strong>{plan.label}</strong><span>{plan.sub}</span></span>
        </NavLink>
      )}

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
        {/* Documentele legale rămân accesibile oricând, nu doar la acceptare. Se deschid în filă nouă,
            ca să nu se piardă ce e completat în aplicație. */}
        {!collapsed && (
          <nav className="sidebar-legal" aria-label="Documente legale">
            {LEGAL_LINKS.map(([href, label]) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
            ))}
          </nav>
        )}
      </div>
    </aside>
  )
}
