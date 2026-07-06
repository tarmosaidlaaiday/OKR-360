import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { Button } from '../ui/Button'
import type { CreateKeyResultInput, KrTargetType } from '../../types'

const TYPE_OPTIONS: { value: KrTargetType; label: string }[] = [
  { value: 'numeric',    label: 'Numeric (e.g. 1000 users)' },
  { value: 'percentage', label: 'Percentage (0–100%)' },
  { value: 'boolean',    label: 'Boolean (done / not done)' },
]

interface KeyResultFormProps {
  open: boolean
  onClose: () => void
  objectiveId: string
  onSubmit: (data: CreateKeyResultInput) => Promise<void>
}

export function KeyResultForm({ open, onClose, objectiveId, onSubmit }: KeyResultFormProps) {
  const [title, setTitle] = useState('')
  const [targetType, setTargetType] = useState<KrTargetType>('numeric')
  const [targetValue, setTargetValue] = useState('100')
  const [unit, setUnit] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setLoading(true)
    setError('')
    try {
      await onSubmit({
        objective_id: objectiveId,
        title: title.trim(),
        target_type: targetType,
        target_value: targetType === 'boolean' ? 1 : Number(targetValue) || 100,
        unit: unit.trim() || null,
      })
      onClose()
      setTitle(''); setTargetType('numeric'); setTargetValue('100'); setUnit('')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Key Result">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Reach 10,000 active users"
          required
        />
        <Select
          label="Type"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value as KrTargetType)}
          options={TYPE_OPTIONS}
        />
        {targetType !== 'boolean' && (
          <div className="flex gap-3">
            <Input
              label="Target value"
              type="number"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              min="0"
            />
            {targetType === 'numeric' && (
              <Input
                label="Unit (optional)"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="users, $, …"
              />
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Add key result</Button>
        </div>
      </form>
    </Modal>
  )
}
