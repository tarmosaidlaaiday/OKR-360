import { useState } from 'react'
import { getErrorMessage } from '../../lib/errors'
import { Modal } from '../ui/Modal'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Input'
import { Button } from '../ui/Button'
import type { CreateCheckinInput, KeyResult } from '../../types'
import { formatTarget } from '../../lib/utils'

interface CheckinFormProps {
  open: boolean
  onClose: () => void
  keyResult: KeyResult
  onSubmit: (data: CreateCheckinInput) => Promise<void>
}

export function CheckinForm({ open, onClose, keyResult, onSubmit }: CheckinFormProps) {
  const [value, setValue] = useState(String(keyResult.current_value))
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onSubmit({
        key_result_id: keyResult.id,
        value_at_checkin: Number(value),
        notes: notes.trim() || undefined,
      })
      onClose()
      setNotes('')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const isBool = keyResult.target_type === 'boolean'

  return (
    <Modal open={open} onClose={onClose} title="Check in" size="sm">
      <div className="mb-4">
        <p className="text-sm font-medium text-gray-900">{keyResult.title}</p>
        <p className="text-xs text-gray-500 mt-0.5">Target: {formatTarget(keyResult)}</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isBool ? (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Status</label>
            <div className="flex gap-3">
              {[{ label: 'Not done', val: '0' }, { label: 'Done', val: '1' }].map((opt) => (
                <label key={opt.val} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="bool_value"
                    value={opt.val}
                    checked={value === opt.val}
                    onChange={() => setValue(opt.val)}
                    className="accent-indigo-600"
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <Input
            label="Current value"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            min="0"
            step="any"
            hint={keyResult.unit ? `Unit: ${keyResult.unit}` : undefined}
          />
        )}
        <Textarea
          label="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What's driving this progress?"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Save check-in</Button>
        </div>
      </form>
    </Modal>
  )
}
