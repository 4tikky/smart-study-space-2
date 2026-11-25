import '@fontsource-variable/plus-jakarta-sans'
import './styles.css'
import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { Button, Empty, Panel, Skeleton, ToastProvider } from './components/ui'
import { OperatorLayout, StudentLayout } from './layouts/Layouts'
import { Student, FloorDetail } from './pages/Student'
import { AuthProvider, Login, RequireOperator } from './components/Auth'
const Overview = lazy(() => import('./pages/Overview').then(module => ({ default: module.Overview })))
const ImageDetection = lazy(() => import('./pages/ImageDetection').then(module => ({ default: module.ImageDetection })))
const VideoDetection = lazy(() => import('./pages/VideoDetection').then(module => ({ default: module.VideoDetection })))
const Live = lazy(() => import('./pages/Live').then(module => ({ default: module.Live })))
const History = lazy(() => import('./pages/History').then(module => ({ default: module.History })))
const Analytics = lazy(() => import('./pages/Analytics').then(module => ({ default: module.Analytics })))
const Model = lazy(() => import('./pages/Model').then(module => ({ default: module.Model })))
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })))

createRoot(document.getElementById('root')!).render(
  <ToastProvider><AuthProvider><BrowserRouter><Suspense fallback={<div className="wrap route-loading"><Skeleton className="floor-skeleton" /></div>}><Routes>
    <Route path="masuk" element={<Login />} />
    <Route element={<StudentLayout />}>
      <Route index element={<Student />} />
      <Route path="lantai/:id" element={<FloorDetail />} />
      <Route path="*" element={<Panel><Empty title="Halaman tidak ditemukan" detail="Kembali ke beranda untuk memilih lantai."
        action={<Button asChild><Link to="/">Ke beranda</Link></Button>} /></Panel>} />
    </Route>
    <Route element={<RequireOperator />}><Route path="operator" element={<OperatorLayout />}>
      <Route index element={<Overview />} />
      <Route path="live" element={<Live />} />
      <Route path="image" element={<ImageDetection />} />
      <Route path="video" element={<VideoDetection />} />
      <Route path="history" element={<History />} />
      <Route path="analytics" element={<Analytics />} />
      <Route path="model" element={<Model />} />
      <Route path="settings" element={<Settings />} />
    </Route></Route>
  </Routes></Suspense></BrowserRouter></AuthProvider></ToastProvider>,
)
