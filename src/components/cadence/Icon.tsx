type IconName =
  | 'dashboard' | 'target' | 'chart' | 'user' | 'chat' | 'retro'
  | 'plus' | 'chevron' | 'chevronR' | 'arrowUp' | 'arrowDown'
  | 'check' | 'circle' | 'info' | 'search' | 'filter' | 'cmd'
  | 'flag' | 'sparkle' | 'calendar' | 'settings' | 'grid'
  | 'link' | 'x' | 'star' | 'users' | 'bell' | 'alertTriangle'
  | 'mail' | 'shield' | 'slash' | 'eye' | 'eyeOff' | 'checkCircle' | 'chartLine' | 'sitemap'
  | 'history' | 'zap' | 'hourglass' | 'thumbsUp' | 'moreVertical' | 'pencil' | 'trash'

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard:  <><rect x="3" y="3"  width="7" height="9"  rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/></>,
  target:     <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></>,
  chart:      <><path d="M4 20V8"/><path d="M10 20V4"/><path d="M16 20v-8"/><path d="M22 20H2"/></>,
  user:       <><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></>,
  chat:       <><path d="M4 5h16v11H8l-4 4z"/></>,
  retro:      <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></>,
  plus:       <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  chevron:    <><path d="M6 9l6 6 6-6"/></>,
  chevronR:   <><path d="M9 6l6 6-6 6"/></>,
  arrowUp:    <><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></>,
  arrowDown:  <><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></>,
  check:      <><path d="M5 12l5 5 9-11"/></>,
  circle:     <><circle cx="12" cy="12" r="8"/></>,
  info:       <><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r=".8" fill="currentColor" stroke="none"/></>,
  search:     <><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></>,
  filter:     <><path d="M3 5h18"/><path d="M6 12h12"/><path d="M10 19h4"/></>,
  cmd:        <><path d="M9 6h6v6a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3v0a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h0"/></>,
  flag:       <><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></>,
  sparkle:    <><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/></>,
  calendar:   <><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/></>,
  settings:   <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
  grid:       <><rect x="3" y="3"  width="8" height="8" rx="1.5"/><rect x="13" y="3"  width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></>,
  link:       <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
  x:          <><path d="M18 6L6 18"/><path d="M6 6l12 12"/></>,
  star:       <><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></>,
  users:         <><circle cx="9" cy="8" r="4"/><path d="M3 21c1-3.5 3.5-5.5 6-5.5s5 2 6 5.5"/><path d="M17 11c1.5 0 4 1 5 4"/><circle cx="17" cy="6" r="3"/></>,
  bell:          <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
  alertTriangle: <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
  mail:          <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
  shield:        <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  slash:         <><circle cx="12" cy="12" r="9"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></>,
  eye:           <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff:        <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>,
  checkCircle:   <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  chartLine:     <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
  sitemap:       <><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="15" width="6" height="5" rx="1"/><rect x="16" y="15" width="6" height="5" rx="1"/><path d="M12 7v3.5M5 15v-2.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V15"/></>,
  history:       <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/><path d="M3.05 11a9 9 0 0 1 .44-2.5"/></>,
  zap:           <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
  hourglass:     <><path d="M5 22h14M5 2h14M17 22v-4.2a5 5 0 0 0-1.46-3.54L12 11 8.46 14.26A5 5 0 0 0 7 17.8V22M17 2v4.2a5 5 0 0 1-1.46 3.54L12 13 8.46 9.74A5 5 0 0 1 7 6.2V2"/></>,
  thumbsUp:      <><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></>,
  moreVertical:  <><circle cx="12" cy="5"  r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/></>,
  pencil:        <><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></>,
  trash:         <><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></>,
}

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="1.6"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
