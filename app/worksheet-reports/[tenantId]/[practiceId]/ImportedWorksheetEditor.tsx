'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateImportedWorksheet } from '../../../worksheet-import-actions'

const MULTILINE_FIELD = /(note|detail|address|comment|description)/i
const PRIORITY_FIELDS = [
  'credential',
  "provider's name",
  'specialty',
  'reporting option',
  '2026 penalty',
  'participation option',
]

function normalizeFieldLabel(label: string) {
  return label.trim().toLowerCase().replace(/[’_\-]+/g, ' ').replace(/\s+/g, ' ')
}

export default function ImportedWorksheetEditor({
  tenantId,
  practiceId,
  initialFields,
}: {
  tenantId: string
  practiceId: string
  initialFields: Record<string, string>
}) {
  const router = useRouter()
  const [fields, setFields] = useState(initialFields)
  const [savedFields, setSavedFields] = useState(initialFields)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [ok, setOk] = useState(false)
  const entries = useMemo(() => Object.entries(fields).sort(([firstLabel], [secondLabel]) => {
    const firstPriority = PRIORITY_FIELDS.indexOf(normalizeFieldLabel(firstLabel))
    const secondPriority = PRIORITY_FIELDS.indexOf(normalizeFieldLabel(secondLabel))
    if (firstPriority === -1 && secondPriority === -1) return 0
    if (firstPriority === -1) return 1
    if (secondPriority === -1) return -1
    return firstPriority - secondPriority
  }), [fields])
  const dirty = JSON.stringify(fields) !== JSON.stringify(savedFields)

  const updateField = (label: string, value: string) => {
    setFields(current => ({ ...current, [label]: value }))
    setMessage('')
  }

  const save = async () => {
    if (!dirty || saving) return
    setSaving(true)
    setMessage('')
    const result = await updateImportedWorksheet(tenantId, practiceId, fields)
    setSaving(false)
    setOk(result.ok)
    setMessage(result.message)
    if (result.ok) {
      setSavedFields(fields)
      router.refresh()
    }
  }

  return <div className="imported-editor">
    <div className="imported-editor-toolbar">
      <div>
        <strong>Uploaded worksheet fields</strong>
        <span>{entries.length} columns preserved from the original file</span>
      </div>
      <div className="imported-editor-actions">
        <button type="button" className="btn" disabled={!dirty || saving} onClick={() => { setFields(savedFields); setMessage('') }}>Reset changes</button>
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save worksheet'}</button>
      </div>
    </div>

    <div className="imported-editor-grid">
      {entries.map(([label, value]) => <label key={label} className={MULTILINE_FIELD.test(label) || value.length > 80 ? 'is-wide' : ''}>
        <span>{label}</span>
        {MULTILINE_FIELD.test(label) || value.length > 80
          ? <textarea rows={4} value={value} onChange={event => updateField(label, event.target.value)} />
          : <input value={value} onChange={event => updateField(label, event.target.value)} />}
      </label>)}
    </div>

    <div className="imported-editor-footer">
      <span className={dirty ? 'is-dirty' : ''}>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      {message && <p className={ok ? 'is-success' : 'is-error'} role="status">{message}</p>}
      <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save worksheet'}</button>
    </div>
  </div>
}
