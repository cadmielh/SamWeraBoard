import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../AppContext'
import { planSummary } from '../lib/billing'
import { preloadRoute } from '../routes'
import { isPlainClick, withViewTransition } from '../lib/viewTransition'
import { IconClients, IconDosare, IconExtract, IconMore, IconSarcini } from './NavIcons'

/** Pe „Mai mult” stau și Setările și Super admin: fila rămâne aprinsă cât timp ești pe una din ele. */
const MORE_PATHS = ['/mai-mult', '/setari', '/super-admin', '/workspace/setup']

/**
 * Bara de navigare de jos, doar pe telefon (styles/mobile.css o ascunde pe ecrane late, unde e bara laterală).
 * Generarea de documente, acțiunea principală a aplicației, stă în centru, la îndemâna degetului mare.
 */
export default function MobileTabBar() {
  const { billing, userRole } = useApp()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // Planul cere atenție (probă pe final, plată eșuată, citire): un punct pe „Mai mult”, unde e indicatorul.
  const plan = planSummary(billing)
  const planAlert = userRole === 'admin' && plan.tone !== 'ok'

  // Pagina începe să se descarce la atingere, înainte de ridicarea degetului.
  const navProps = (path: string) => ({
    onPointerDown: () => preloadRoute(path),
    onClick: (e: React.MouseEvent) => {
      if (!isPlainClick(e)) return
      e.preventDefault()
      if (pathname === path) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
      withViewTransition(() => navigate(path))
    },
  })
  const cls = ({ isActive }: { isActive: boolean }) => 'tabbar-item' + (isActive ? ' active' : '')
  const moreActive = MORE_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))

  return (
    <nav className="tabbar" aria-label="Navigare principală">
      <NavLink to="/" end className={cls} {...navProps('/')}>
        <IconClients /><span>Clienți</span>
      </NavLink>
      <NavLink to="/dosare" className={cls} {...navProps('/dosare')}>
        <IconDosare /><span>Dosare</span>
      </NavLink>
      <NavLink to="/extragere" className={({ isActive }) => cls({ isActive }) + ' tabbar-item--main'} {...navProps('/extragere')}>
        <span className="tabbar-main-icon"><IconExtract /></span><span>Generare</span>
      </NavLink>
      <NavLink to="/sarcini" className={cls} {...navProps('/sarcini')}>
        <IconSarcini /><span>Sarcini</span>
      </NavLink>
      <NavLink to="/mai-mult" className={() => cls({ isActive: moreActive })} {...navProps('/mai-mult')}>
        <span className="tabbar-icon-wrap">
          <IconMore />
          {planAlert && <span className={`tabbar-dot tabbar-dot--${plan.tone}`} aria-label="Planul cere atenție" />}
        </span>
        <span>Mai mult</span>
      </NavLink>
    </nav>
  )
}
