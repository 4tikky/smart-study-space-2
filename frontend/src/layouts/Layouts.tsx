import { Activity, BookOpen, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, FileClock, Image, Layers3, LayoutDashboard, Menu, ScanLine, Settings2, ShieldCheck, SwitchCamera, Video, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button, Logo } from '../components/ui'
import { useData } from '../hooks/useData'
import type { Occupancy } from '../types'
import { browserMode } from '../services/runtime'
import { supabase } from '../services/supabase'
import { useAuth } from '../components/Auth'

export const operatorLinks = [
  { to: '/operator', name: 'Ringkasan', icon: LayoutDashboard },
  { to: '/operator/live', name: 'Pemantauan Langsung', icon: Video },
  { to: '/operator/image', name: 'Deteksi Gambar', icon: Image },
  { to: '/operator/video', name: 'Deteksi Video', icon: ScanLine },
  { to: '/operator/history', name: 'Riwayat Deteksi', icon: FileClock },
  { to: '/operator/analytics', name: 'Analitik', icon: ChartNoAxesCombined },
  { to: '/operator/model', name: 'Informasi Model', icon: Layers3 },
  { to: '/operator/settings', name: 'Pengaturan', icon: Settings2 },
]

export function StudentLayout() {
  const state = useData<Occupancy>('/api/occupancy', 5000)
  const [menu, setMenu] = useState(false)
  const location = useLocation()
  const onFloors = location.hash === '#lantai' || location.pathname.startsWith('/lantai/')
  useEffect(() => {
    if (location.hash === '#lantai') requestAnimationFrame(() => document.getElementById('lantai')?.scrollIntoView({ behavior: 'smooth' }))
    else window.scrollTo(0, 0)
  }, [location])
  return <>
    <a className="skip-link" href="#main">Langsung ke konten</a>
    <header className="student-header">
      <div className="student-nav wrap">
        <Link to="/" className="logo-link" aria-label="Smart Study Space, beranda"><Logo /></Link>
        <nav className={menu ? 'student-links open' : 'student-links'} aria-label="Navigasi mahasiswa">
          <Link to="/" className={!onFloors ? 'active' : ''} onClick={() => setMenu(false)}><LayoutDashboard size={17} /> Beranda</Link>
          <Link to="/#lantai" className={onFloors ? 'active' : ''} onClick={() => setMenu(false)}><Layers3 size={17} /> Daftar lantai</Link>
        </nav>
        <div className="student-nav-actions">
          <span className={'system-status ' + (state.data ? 'system-online' : '')}><i />{state.data ? 'Sistem aktif' : state.loading ? 'Memeriksa sistem' : 'Sistem offline'}</span>
          <Button asChild variant="outline" className="role-button"><Link to="/operator" title={browserMode ? 'Masuk sebagai operator' : 'Beralih ke operator · Mode demo'}><SwitchCamera size={17} /><span>Mode operator</span></Link></Button>
          <Button variant="ghost" size="icon" className="student-menu" onClick={() => setMenu(!menu)} aria-label={menu ? 'Tutup menu' : 'Buka menu'} aria-expanded={menu}>{menu ? <X size={21} /> : <Menu size={21} />}</Button>
        </div>
      </div>
    </header>
    <main className="student-main wrap" id="main"><Outlet context={state} /></main>
    <footer className="student-footer"><div className="wrap"><span><BookOpen size={17} /> Perpustakaan Universitas Diponegoro</span><span><ShieldCheck size={17} /> Ketersediaan ditampilkan tanpa rekaman kamera</span></div></footer>
  </>
}

export function OperatorLayout() {
  const auth = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  const { pathname } = useLocation()
  const current = operatorLinks.find(link => link.to === pathname)
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return <div className={'operator-layout' + (collapsed ? ' sidebar-collapsed' : '')}>
    <a className="skip-link" href="#main">Langsung ke konten</a>
    {mobile && <button className="sidebar-backdrop" onClick={() => setMobile(false)} aria-label="Tutup navigasi" />}
    <aside className={'operator-sidebar' + (mobile ? ' mobile-open' : '')}>
      <Link className="logo-link" to="/operator" onClick={() => setMobile(false)}><Logo /></Link>
      <div className="sidebar-label">Ruang kerja</div>
      <nav aria-label="Navigasi operator">{operatorLinks.map(({ to, name, icon: Icon }) =>
        <NavLink key={to} to={to} end={to === '/operator'} title={name} aria-label={name} onClick={() => setMobile(false)}>
          <Icon size={19} /><span>{name}</span></NavLink>)}</nav>
      <div className="sidebar-end"><Button variant="ghost" className="sidebar-toggle" onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}>{collapsed ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}<span>Ciutkan sidebar</span></Button></div>
    </aside>
    <div className="operator-body">
      <header className="operator-top">
        <div><Button variant="ghost" size="icon" className="operator-menu" onClick={() => setMobile(!mobile)} aria-label="Buka navigasi" aria-expanded={mobile}><Menu size={22} /></Button>
          <span className="breadcrumb"><Activity size={16} /> Operator <ChevronRight size={14} /> <strong>{current?.name}</strong></span></div>
        <div>{browserMode ? <><span className="demo-tag" title={auth.email}>Operator terverifikasi</span><Button variant="ghost" size="small" onClick={() => { void supabase?.auth.signOut() }}>Keluar</Button></> : <span className="demo-tag" title="Mode demo lokal tanpa autentikasi">Mode demo</span>}
          <Button asChild variant="outline" className="role-button"><Link to="/"><SwitchCamera size={17} /><span>Mode mahasiswa</span><ChevronDown size={14} /></Link></Button></div>
      </header>
      <main id="main" className="operator-main"><Outlet /></main>
    </div>
  </div>
}
