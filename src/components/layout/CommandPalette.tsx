import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../cadence/Icon'
import { searchContent } from '../../services/search.service'
import type { SearchResult } from '../../services/search.service'

interface CmdItem {
  id: string
  label: string
  sub?: string | null
  group: string
  to: string
  icon: React.ComponentProps<typeof Icon>['name']
}

const PAGES: CmdItem[] = [
  { id: 'dash',       label: 'Dashboard',  group: 'Pages', to: '/dashboard',          icon: 'dashboard'   },
  { id: 'objectives', label: 'Objectives', group: 'Pages', to: '/objectives',          icon: 'checkCircle' },
  { id: 'kpis',       label: 'KPIs',       group: 'Pages', to: '/kpis',               icon: 'chart'       },
  { id: 'people',     label: 'People',     group: 'Pages', to: '/people',             icon: 'users'       },
  { id: '1on1s',      label: '1-on-1s',    group: 'Pages', to: '/1on1s',              icon: 'users'       },
  { id: 'scorecard',  label: 'Scorecard',  group: 'Pages', to: '/scorecard',          icon: 'chart'       },
  { id: 'analytics',  label: 'Analytics',  group: 'Pages', to: '/analytics',          icon: 'chartLine'   },
  { id: 'history',    label: 'History',    group: 'Pages', to: '/history',            icon: 'history'     },
]

const GROUP_ICON: Record<string, React.ComponentProps<typeof Icon>['name']> = {
  Objectives: 'checkCircle',
  KPIs:       'chart',
  People:     'users',
  Pages:      'dashboard',
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery]           = useState('')
  const [active, setActive]         = useState(0)
  const [results, setResults]       = useState<SearchResult[]>([])
  const [searching, setSearching]   = useState(false)
  const inputRef                    = useRef<HTMLInputElement>(null)
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigate                    = useNavigate()

  // Filtered pages (always shown when no query, or matched by name when query present)
  const filteredPages = query.trim()
    ? PAGES.filter(p => p.label.toLowerCase().includes(query.toLowerCase()))
    : PAGES

  // Combine: pages first, then DB results (only when query ≥ 2 chars)
  const allItems: CmdItem[] = [
    ...filteredPages,
    ...results.map(r => ({
      id:    r.id,
      label: r.label,
      sub:   r.sub,
      group: r.group,
      to:    r.to,
      icon:  GROUP_ICON[r.group] ?? 'checkCircle' as React.ComponentProps<typeof Icon>['name'],
    })),
  ]

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Debounced content search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim().length < 2) { setResults([]); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await searchContent(query)
        setResults(r)
        setActive(0)
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) onClose(); else { /* TopBar handles opening */ }
      }
      if (!open) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, allItems.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
      if (e.key === 'Enter')     { e.preventDefault(); go(allItems[active]) }
      if (e.key === 'Escape')    { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, allItems, active])

  function go(item: CmdItem | undefined) {
    if (!item) return
    navigate(item.to)
    onClose()
  }

  if (!open) return null

  const groups = [...new Set(allItems.map(i => i.group))]

  return (
    <>
      <div className="cd-cmd-backdrop" onClick={onClose} />
      <div className="cd-cmd" role="dialog" aria-modal aria-label="Command palette">
        <div className="cd-cmd-input">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            placeholder="Search objectives, KPIs, people, pages…"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0) }}
          />
          {searching && (
            <span style={{ fontSize: 11, color: 'var(--ink-faint)', paddingRight: 8, flexShrink: 0 }}>
              Searching…
            </span>
          )}
        </div>
        <div className="cd-cmd-results">
          {groups.map(g => (
            <div key={g} className="cd-cmd-grp">
              <div className="cd-cmd-grp-lbl">{g}</div>
              {allItems.filter(i => i.group === g).map(item => {
                const globalIdx = allItems.indexOf(item)
                return (
                  <button
                    key={item.id}
                    className={'cd-cmd-item' + (globalIdx === active ? ' is-on' : '')}
                    onMouseEnter={() => setActive(globalIdx)}
                    onClick={() => go(item)}
                    type="button"
                  >
                    <Icon name={item.icon} size={15} />
                    <span style={{ flex: 1, textAlign: 'left' }}>
                      {item.label}
                      {item.sub && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-soft)', fontWeight: 400 }}>
                          {item.sub}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {!searching && allItems.length === 0 && query.trim() && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-faint)', fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}
        </div>
      </div>
    </>
  )
}
