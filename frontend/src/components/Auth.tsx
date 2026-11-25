import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { database, operatorAllowed, supabase } from '../services/supabase'
import { browserMode } from '../services/runtime'
import { Button, ErrorBox, Field, Logo, Panel, Spinner } from './ui'

type Auth = { loading: boolean; operator: boolean; email: string; error: string }
const AuthContext = createContext<Auth>({ loading: true, operator: false, email: '', error: '' })
export const useAuth = () => useContext(AuthContext)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Auth>({ loading: browserMode, operator: !browserMode, email: '', error: '' })
  useEffect(() => {
    if (!browserMode || !supabase) { setState({ loading: false, operator: !browserMode, email: '', error: '' }); return }
    let generation = 0, active = true
    async function verify(email = '') {
      const sequence = ++generation
      setState(previous => previous.email === email && previous.operator ? previous : { loading: true, operator: false, email, error: '' })
      try {
        const allowed = email ? await operatorAllowed() : false
        if (active && sequence === generation) setState({ loading: false, operator: allowed, email, error: email && !allowed ? 'Akun ini belum terdaftar sebagai operator. Hubungi administrator.' : '' })
      } catch { if (active && sequence === generation) setState({ loading: false, operator: false, email, error: 'Izin operator belum dapat diverifikasi. Periksa koneksi Supabase.' }) }
    }
    void supabase.auth.getSession().then(({ data }) => { if (active) void verify(data.session?.user.email) })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => { if (active) void verify(session?.user.email) }, 0)
    })
    return () => { active = false; generation++; data.subscription.unsubscribe() }
  }, [])
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
export function RequireOperator() {
  const auth = useAuth(), location = useLocation()
  if (auth.loading) return <div className="wrap route-loading" role="status"><Spinner /> Memverifikasi akses operator…</div>
  return auth.operator ? <Outlet /> : <Navigate to="/masuk" state={{ from: location.pathname }} replace />
}
export function Login() {
  const auth = useAuth(), location = useLocation()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  if (auth.operator) return <Navigate to={location.state?.from?.startsWith('/operator') ? location.state.from : '/operator'} replace />
  return <main className="wrap auth-page"><Link to="/"><Logo /></Link><Panel title="Masuk operator" description="Gunakan akun yang telah diizinkan oleh administrator perpustakaan.">
    {(error || auth.error) && <ErrorBox message={error || auth.error} />}
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError('')
      try {
        const result = await database().auth.signInWithPassword({ email, password })
        if (result.error) throw new Error('Email atau kata sandi tidak sesuai, atau akun belum dikonfirmasi.')
        setPassword('')
      } catch (reason) { setError((reason as Error).message) }
      finally { setBusy(false) }
    }}>
      <Field label="Email"><input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <Field label="Kata sandi"><input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></Field>
      <Button className="stretch panel-action" disabled={busy || auth.loading}>{busy ? <Spinner /> : null} Masuk</Button>
    </form>
    {auth.email && !auth.operator && <Button variant="outline" className="panel-action" onClick={() => { void supabase?.auth.signOut() }}>Keluar dari akun</Button>}
    <p className="muted panel-action"><Link to="/">Kembali ke ketersediaan kursi</Link></p>
  </Panel></main>
}
