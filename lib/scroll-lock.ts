'use client'

// Freeze the page behind the popup. The scrollbar's width is kept as padding so
// the page doesn't jump sideways; everything is restored exactly on close.
// Counted, so two popups at once can't unlock the page too early.
let scrollLocks = 0
let savedStyles: { htmlOverflow: string; bodyOverflow: string; bodyPaddingRight: string } | null = null
export function lockPageScroll() {
  if (scrollLocks++ > 0) return
  const html = document.documentElement, body = document.body
  const scrollbar = window.innerWidth - html.clientWidth
  savedStyles = { htmlOverflow: html.style.overflow, bodyOverflow: body.style.overflow, bodyPaddingRight: body.style.paddingRight }
  html.style.overflow = 'hidden'
  body.style.overflow = 'hidden'
  if (scrollbar > 0) body.style.paddingRight = `${(parseFloat(getComputedStyle(body).paddingRight) || 0) + scrollbar}px`
}
export function unlockPageScroll() {
  if (--scrollLocks > 0 || !savedStyles) return
  const html = document.documentElement, body = document.body
  html.style.overflow = savedStyles.htmlOverflow
  body.style.overflow = savedStyles.bodyOverflow
  body.style.paddingRight = savedStyles.bodyPaddingRight
  savedStyles = null
}
