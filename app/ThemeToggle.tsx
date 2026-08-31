'use client'
import { useEffect, useState } from 'react'

export default function ThemeToggle() {
  const [theme, setTheme] = useState('dark')
  useEffect(() => {
    const saved = localStorage.getItem('theme') || 'dark'
    setTheme(saved)
    document.documentElement.setAttribute('data-theme', saved)
  }, [])
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
  }
  return (
    <button className="theme-toggle" onClick={toggle}>
      {theme === 'dark' ? '☀ Light' : '☾ Dark'}
    </button>
  )
}