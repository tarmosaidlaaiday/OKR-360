import { useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Trash2, Plus, MessageSquare } from 'lucide-react'
import { ProgressRing } from './ProgressRing'
import { ObjectiveStatusBadge } from './ObjectiveStatusBadge'
import { KeyResultRow } from '../key-results/KeyResultRow'
import { KeyResultForm } from '../key-results/KeyResultForm'
import { Avatar } from '../ui/Avatar'
import { CommentThread } from '../comments/CommentThread'
import { computeObjectiveProgress } from '../../lib/utils'
import { keyResultsService } from '../../services/keyResults.service'
import { checkinsService } from '../../services/checkins.service'
import { useAuth } from '../../context/AuthContext'
import type { Objective, CreateKeyResultInput, CreateCheckinInput, KeyResult } from '../../types'

interface ObjectiveCardProps {
  objective: Objective
  onEdit?: (obj: Objective) => void
  onDelete?: (id: string) => Promise<void>
  onKeyResultAdded?: () => void
}

export function ObjectiveCard({ objective, onEdit, onDelete, onKeyResultAdded }: ObjectiveCardProps) {
  const { user } = useAuth()
  const [expanded, setExpanded] = useState(true)
  const [krOpen, setKrOpen] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [keyResults, setKeyResults] = useState<KeyResult[]>(objective.key_results ?? [])

  const isOwner = user?.id === objective.owner_id
  const progress = computeObjectiveProgress(keyResults)

  async function handleAddKR(input: CreateKeyResultInput) {
    const kr = await keyResultsService.create(input)
    setKeyResults((prev) => [...prev, kr])
    onKeyResultAdded?.()
  }

  async function handleCheckin(kr: KeyResult, data: CreateCheckinInput) {
    if (!user) throw new Error('Not authenticated')
    await checkinsService.create({ ...data, author_id: user.id })
    // optimistically update current_value in local state
    setKeyResults((prev) =>
      prev.map((k) => k.id === kr.id ? { ...k, current_value: data.value_at_checkin } : k)
    )
  }

  async function handleDeleteKR(id: string) {
    await keyResultsService.delete(id)
    setKeyResults((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start gap-4 p-5">
        <ProgressRing progress={progress} size={56} strokeWidth={5} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900 flex-1">{objective.title}</h3>
            <ObjectiveStatusBadge status={objective.status} />
          </div>
          {objective.description && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{objective.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {objective.owner && (
              <div className="flex items-center gap-1.5">
                <Avatar name={objective.owner.full_name} src={objective.owner.avatar_url} size="sm" />
                <span className="text-xs text-gray-500">{objective.owner.full_name}</span>
              </div>
            )}
            {objective.unit && (
              <span className="text-xs text-gray-400 bg-gray-50 rounded-full px-2 py-0.5 ring-1 ring-gray-200">
                {objective.unit.name}
              </span>
            )}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {isOwner && onEdit && (
            <button
              onClick={() => onEdit(objective)}
              className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
          {isOwner && onDelete && (
            <button
              onClick={() => onDelete(objective.id)}
              className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Key Results */}
      {expanded && (
        <div className="border-t border-gray-50 px-5 pb-4">
          {keyResults.length > 0 && (
            <div className="mt-3 flex flex-col divide-y divide-gray-50">
              {keyResults.map((kr) => (
                <KeyResultRow
                  key={kr.id}
                  keyResult={kr}
                  onCheckin={isOwner ? handleCheckin : undefined}
                  onDelete={isOwner ? handleDeleteKR : undefined}
                  isOwner={isOwner}
                />
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-4">
            {isOwner && (
              <button
                onClick={() => setKrOpen(true)}
                className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium transition-colors"
              >
                <Plus size={14} /> Add key result
              </button>
            )}
            <button
              onClick={() => setCommentsOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              <MessageSquare size={13} />
              {commentsOpen ? 'Hide comments' : 'Comments'}
            </button>
          </div>
          {keyResults.length === 0 && !isOwner && (
            <p className="text-xs text-gray-400 mt-3">No key results yet.</p>
          )}
          {commentsOpen && (
            <div className="mt-3">
              <CommentThread objectiveId={objective.id} />
            </div>
          )}
        </div>
      )}

      <KeyResultForm
        open={krOpen}
        onClose={() => setKrOpen(false)}
        objectiveId={objective.id}
        onSubmit={handleAddKR}
      />
    </div>
  )
}
