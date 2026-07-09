import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import { commentsService } from '../../services/comments.service'
import type { Comment } from '../../types'

interface CommentThreadProps {
  objectiveId?: string
  krId?: string
  kpiId?: string
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/)
  const text = parts.length > 1
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2)
  return (
    <div className="cd-comment-avatar">
      {text.toUpperCase()}
    </div>
  )
}

export function CommentThread({ objectiveId, krId, kpiId }: CommentThreadProps) {
  const { user } = useAuth()
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    const fetch = objectiveId
      ? commentsService.getByObjective(objectiveId)
      : kpiId
        ? commentsService.getByKPI(kpiId)
        : commentsService.getByKR(krId!)
    fetch
      .then(data => { if (active) setComments(data) })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [objectiveId, krId, kpiId])

  async function handlePost(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text || !user) return
    setPosting(true)
    try {
      const comment = await commentsService.create({
        body: text,
        author_id: user.id,
        ...(objectiveId ? { objective_id: objectiveId } : kpiId ? { kpi_id: kpiId } : { key_result_id: krId }),
      })
      setComments(prev => [...prev, comment])
      setBody('')
      textareaRef.current?.focus()
    } catch {
      // silent — user sees no change
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(id: string) {
    await commentsService.delete(id)
    setComments(prev => prev.filter(c => c.id !== id))
  }

  return (
    <div className="cd-comment-thread">
      {loading ? (
        <p className="cd-comment-empty">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="cd-comment-empty">No comments yet.</p>
      ) : (
        <div className="cd-comment-list">
          {comments.map(c => (
            <div key={c.id} className="cd-comment">
              <Initials name={c.author?.full_name ?? 'User'} />
              <div className="cd-comment-body">
                <div className="cd-comment-meta">
                  <span className="cd-comment-author">{c.author?.full_name ?? 'Unknown'}</span>
                  <span className="cd-comment-time">{timeAgo(c.created_at)}</span>
                  {c.author_id === user?.id && (
                    <button
                      type="button"
                      className="cd-comment-delete"
                      onClick={() => handleDelete(c.id)}
                      title="Delete comment"
                    >
                      ×
                    </button>
                  )}
                </div>
                <p className="cd-comment-text">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handlePost} className="cd-comment-form">
        <textarea
          ref={textareaRef}
          className="cd-comment-input"
          placeholder="Add a comment…"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePost(e as any)
          }}
        />
        <div className="cd-comment-form-footer">
          <span className="cd-comment-hint">⌘↵ to post</span>
          <button
            type="submit"
            className="cd-btn cd-btn--primary cd-btn--sm"
            disabled={!body.trim() || posting}
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>
    </div>
  )
}
