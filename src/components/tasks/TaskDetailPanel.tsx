import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { updateKrTask, updateKrTaskStatus } from '../../services/krTasks.service'
import { updatePersonalTask } from '../../services/personalTasks.service'
import { getTaskAttachments, uploadTaskAttachment, deleteTaskAttachment } from '../../services/taskAttachments.service'
import { CommentThread } from '../comments/CommentThread'
import { Icon } from '../cadence/Icon'
import type { UnifiedTask, KrTaskStatus } from '../../types/cadence'
import type { TaskAttachment } from '../../services/taskAttachments.service'

// ── Status chip ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<KrTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}
const STATUS_CYCLE: Record<KrTaskStatus, KrTaskStatus> = {
  todo: 'in_progress',
  in_progress: 'done',
  done: 'todo',
}

function StatusPill({ status, onClick }: { status: KrTaskStatus; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 20, border: '1px solid var(--line)',
        fontSize: 12, fontWeight: 500, cursor: 'pointer',
        background: status === 'done'
          ? 'color-mix(in oklab, var(--green, #22c55e) 15%, transparent)'
          : status === 'in_progress'
            ? 'color-mix(in oklab, var(--accent) 12%, transparent)'
            : 'var(--bg-sub)',
        color: status === 'done'
          ? 'var(--green, #16a34a)'
          : status === 'in_progress'
            ? 'var(--accent)'
            : 'var(--ink-soft)',
      }}
      title="Click to advance status"
    >
      {status === 'done' && <Icon name="check" size={11} />}
      {status === 'in_progress' && <Icon name="circle" size={8} />}
      {STATUS_LABELS[status]}
    </button>
  )
}

// ── Attachments section ───────────────────────────────────────────────────

function AttachmentsSection({
  taskId,
  source,
  uploadedBy,
}: {
  taskId: string
  source: 'kr' | 'personal'
  uploadedBy: string
}) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    getTaskAttachments(taskId, source)
      .then(data => { if (active) setAttachments(data) })
      .catch(console.error)
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [taskId, source])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const att = await uploadTaskAttachment(taskId, source, file, uploadedBy)
      setAttachments(prev => [...prev, att])
    } catch (err) {
      console.error('Upload failed', err)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(id: string) {
    await deleteTaskAttachment(id)
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  function ext(name: string) {
    return name.split('.').pop()?.toUpperCase() ?? 'FILE'
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Attachments
      </div>
      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>Loading…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {attachments.map(att => (
            <div
              key={att.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: 'var(--bg-sub)',
                borderRadius: 6,
                border: '1px solid var(--line)',
              }}
            >
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                padding: '2px 5px', borderRadius: 4,
                background: 'var(--bg-elev)', border: '1px solid var(--line)',
                color: 'var(--ink-soft)', flexShrink: 0,
              }}>
                {ext(att.file_name)}
              </span>
              <a
                href={att.file_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, fontSize: 13, color: 'var(--ink)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {att.file_name}
              </a>
              {att.uploaded_by === uploadedBy && (
                <button
                  type="button"
                  onClick={() => handleDelete(att.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', padding: 2, lineHeight: 1 }}
                  title="Remove attachment"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
          {attachments.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--ink-faint)' }}>No attachments yet.</p>
          )}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <input
          ref={fileRef}
          type="file"
          id="task-file-upload"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          disabled={uploading}
        />
        <label
          htmlFor="task-file-upload"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 12, fontWeight: 500, cursor: uploading ? 'default' : 'pointer',
            color: uploading ? 'var(--ink-faint)' : 'var(--accent)',
            opacity: uploading ? 0.5 : 1,
          }}
        >
          <Icon name="plus" size={12} />
          {uploading ? 'Uploading…' : 'Attach file'}
        </label>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────

interface TaskDetailPanelProps {
  task: UnifiedTask
  onClose: () => void
  onTaskUpdate: (updated: Partial<UnifiedTask>) => void
}

export function TaskDetailPanel({ task, onClose, onTaskUpdate }: TaskDetailPanelProps) {
  const { user } = useAuth()

  // Editable fields local state
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description ?? '')
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [savingDesc, setSavingDesc] = useState(false)
  const descTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync if task changes externally
  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description ?? '')
  }, [task.id, task.title, task.description])

  async function saveTitle() {
    const trimmed = title.trim()
    if (!trimmed || trimmed === task.title) { setEditingTitle(false); return }
    setSavingTitle(true)
    try {
      if (task.source === 'kr') {
        await updateKrTask(task.id, { title: trimmed })
      } else {
        await updatePersonalTask(task.id, { title: trimmed })
      }
      onTaskUpdate({ title: trimmed })
    } catch (err) {
      console.error(err)
      setTitle(task.title) // revert
    } finally {
      setSavingTitle(false)
      setEditingTitle(false)
    }
  }

  function handleDescChange(value: string) {
    setDescription(value)
    if (descTimeout.current) clearTimeout(descTimeout.current)
    descTimeout.current = setTimeout(async () => {
      setSavingDesc(true)
      try {
        if (task.source === 'kr') {
          await updateKrTask(task.id, { description: value || null })
        } else {
          await updatePersonalTask(task.id, { description: value || null })
        }
        onTaskUpdate({ description: value || null })
      } catch (err) {
        console.error(err)
      } finally {
        setSavingDesc(false)
      }
    }, 800)
  }

  async function handleStatusCycle() {
    const next = STATUS_CYCLE[task.status]
    onTaskUpdate({ status: next })
    try {
      if (task.source === 'kr') {
        await updateKrTaskStatus(task.id, next)
      } else {
        await updatePersonalTask(task.id, { status: next })
      }
    } catch (err) {
      console.error(err)
      onTaskUpdate({ status: task.status }) // revert
    }
  }

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const commentProps = task.source === 'kr'
    ? { krTaskId: task.id }
    : { personalTaskId: task.id }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 400,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(520px, 100vw)',
          background: 'var(--bg-elev, var(--bg))',
          borderLeft: '1px solid var(--line)',
          zIndex: 401,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 32px rgba(0,0,0,0.12)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--line)',
          position: 'sticky', top: 0,
          background: 'var(--bg-elev, var(--bg))',
          zIndex: 1,
        }}>
          <div style={{ flex: 1 }}>
            {/* Source breadcrumb */}
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginBottom: 6, fontWeight: 500 }}>
              {task.source_label}
            </div>

            {/* Title */}
            {editingTitle ? (
              <input
                autoFocus
                style={{
                  width: '100%', fontSize: 18, fontWeight: 700,
                  background: 'transparent', border: 'none', outline: 'none',
                  color: 'var(--ink)', padding: 0,
                  borderBottom: '2px solid var(--accent)',
                }}
                value={title}
                onChange={e => setTitle(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveTitle()
                  if (e.key === 'Escape') { setTitle(task.title); setEditingTitle(false) }
                }}
                disabled={savingTitle}
              />
            ) : (
              <h2
                onClick={() => setEditingTitle(true)}
                style={{
                  margin: 0, fontSize: 18, fontWeight: 700,
                  cursor: 'text', color: 'var(--ink)',
                  lineHeight: 1.3,
                }}
                title="Click to edit title"
              >
                {title}
              </h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--ink-faint)', padding: 4, lineHeight: 1, flexShrink: 0,
            }}
            title="Close (Esc)"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>

          {/* Status */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Status
            </div>
            <StatusPill status={task.status} onClick={handleStatusCycle} />
          </div>

          {/* Description */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              Description
              {savingDesc && <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--ink-faint)' }}>saving…</span>}
            </div>
            <textarea
              placeholder="Add a description…"
              value={description}
              onChange={e => handleDescChange(e.target.value)}
              rows={4}
              style={{
                width: '100%', resize: 'vertical', fontSize: 13,
                padding: '10px 12px', borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--bg-sub)',
                color: 'var(--ink)',
                fontFamily: 'inherit',
                lineHeight: 1.55,
                boxSizing: 'border-box',
                outline: 'none',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--line)' }}
            />
          </div>

          {/* Attachments */}
          {user?.id && (
            <AttachmentsSection
              taskId={task.id}
              source={task.source}
              uploadedBy={user.id}
            />
          )}

          {/* Divider */}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 4 }} />

          {/* Comments */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Comments
            </div>
            <CommentThread {...commentProps} />
          </div>
        </div>
      </div>
    </>
  )
}
