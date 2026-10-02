'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, X } from 'lucide-react'
import { getWorksheetPreview, getWorksheetPreviewActivity, type WorksheetPreview } from './worksheet-actions'
import { getWorksheetAssignmentOptions, reassignWorksheetLead, type WorksheetAssignmentOptions } from './worksheet-assignment-actions'

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function PreviewField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="worksheet-preview-field">
      <span>{label}</span>
      <strong>{value?.trim() || '—'}</strong>
    </div>
  )
}

export default function WorksheetPreviewModal({
  practiceCode,
  practiceName,
  tenantId,
  practiceId,
  initialPreview,
  fullLeadHref,
  fullLeadLabel = 'Open full lead',
  enableAssignment = false,
  onClose,
}: {
  practiceCode: string
  practiceName: string
  tenantId?: string
  practiceId?: string
  initialPreview?: WorksheetPreview
  fullLeadHref?: string | null
  fullLeadLabel?: string
  enableAssignment?: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const attachDialog = useCallback((dialog: HTMLDialogElement | null) => {
    dialogRef.current = dialog
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  const hasInitialPreview = !!initialPreview
  const [preview, setPreview] = useState<WorksheetPreview | null>(initialPreview ?? null)
  const [loading, setLoading] = useState(!initialPreview)
  const [activityLoading, setActivityLoading] = useState(!!initialPreview)
  const [activityError, setActivityError] = useState('')
  const [error, setError] = useState('')
  const [assignmentOptions, setAssignmentOptions] = useState<WorksheetAssignmentOptions | null>(null)
  const [assignmentTarget, setAssignmentTarget] = useState('')
  const [assignmentLoading, setAssignmentLoading] = useState(enableAssignment && !!tenantId && !!practiceId)
  const [assignmentBusy, setAssignmentBusy] = useState(false)
  const [assignmentMessage, setAssignmentMessage] = useState('')

  useEffect(() => () => {
    if (dialogRef.current?.open) dialogRef.current.close()
  }, [])

  useEffect(() => {
    let active = true
    if (hasInitialPreview && tenantId && practiceId) {
      void getWorksheetPreviewActivity(practiceCode, tenantId, practiceId).then(result => {
        if (!active) return
        if (result.ok) {
          setPreview(current => current ? { ...current, activities: result.activities } : current)
        } else {
          setActivityError(result.message)
        }
        setActivityLoading(false)
      }).catch(() => {
        if (!active) return
        setActivityError('Could not load recent activity.')
        setActivityLoading(false)
      })
      return () => { active = false }
    }
    void getWorksheetPreview(practiceCode, tenantId, practiceId).then(result => {
      if (!active) return
      if (result.ok) setPreview(result.data)
      else setError(result.message)
      setLoading(false)
    }).catch(() => {
      if (!active) return
      setError('Could not load this worksheet. Please try again.')
      setLoading(false)
    })
    return () => { active = false }
  }, [practiceCode, tenantId, practiceId, hasInitialPreview])

  useEffect(() => {
    if (!enableAssignment || !tenantId || !practiceId) return
    let active = true
    void getWorksheetAssignmentOptions(practiceCode, tenantId, practiceId).then(result => {
      if (!active) return
      if (result.ok) {
        setAssignmentOptions(result.data)
        setAssignmentTarget(result.data.assignedTo ?? '')
      } else {
        setAssignmentMessage(result.message)
      }
      setAssignmentLoading(false)
    }).catch(() => {
      if (!active) return
      setAssignmentMessage('Could not load team assignment options.')
      setAssignmentLoading(false)
    })
    return () => { active = false }
  }, [enableAssignment, practiceCode, practiceId, tenantId])

  const handleReassign = async () => {
    if (!tenantId || !practiceId || !assignmentTarget) return
    setAssignmentBusy(true)
    setAssignmentMessage('')
    const result = await reassignWorksheetLead(practiceCode, tenantId, practiceId, assignmentTarget)
    setAssignmentBusy(false)
    setAssignmentMessage(result.message)
    if (result.ok && assignmentOptions) {
      const target = assignmentOptions.agents.find(agent => agent.id === assignmentTarget)
      setAssignmentOptions({
        ...assignmentOptions,
        assignedTo: assignmentTarget,
        assignedToName: target?.fullName ?? assignmentOptions.assignedToName,
      })
      router.refresh()
    }
  }

  const worksheet = preview?.worksheet
  const resolvedFullLeadHref = fullLeadHref === undefined ? `/practice/${practiceCode}` : fullLeadHref

  return (
    <dialog
      ref={attachDialog}
      className="worksheet-preview-dialog"
      aria-labelledby="worksheet-preview-title"
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <header className="worksheet-preview-header">
        <div>
          <span className="worksheet-preview-kicker">Saved worksheet</span>
          <h2 id="worksheet-preview-title">{practiceName}</h2>
          <p>{practiceCode}{worksheet?.companyName ? ` · ${worksheet.companyName}` : ''}</p>
        </div>
        <button type="button" className="worksheet-preview-close" onClick={onClose} aria-label="Close worksheet preview" title="Close">
          <X size={18} />
        </button>
      </header>

      <div className="worksheet-preview-content">
        {loading ? (
          <div className="worksheet-preview-skeleton" role="status" aria-label="Loading saved worksheet">
            <section aria-hidden="true">
              <span className="worksheet-preview-skeleton-title" />
              <span className="worksheet-preview-skeleton-note" />
              <span className="worksheet-preview-skeleton-note short" />
              <div className="worksheet-preview-skeleton-fields">
                {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
              </div>
            </section>
            <section aria-hidden="true">
              <span className="worksheet-preview-skeleton-title short" />
              {Array.from({ length: 4 }, (_, index) => <span className="worksheet-preview-skeleton-event" key={index} />)}
            </section>
          </div>
        ) : error ? (
          <p className="worksheet-preview-message is-error" role="alert">{error}</p>
        ) : (
          <>
            <section className="worksheet-preview-main" aria-label="Worksheet details">
              <div className="worksheet-preview-section-heading">
                <h3>Agent notes</h3>
                {worksheet?.disposition && <span className="worksheet-preview-status">{worksheet.disposition}</span>}
              </div>
              {worksheet ? (
                <>
                  <div className="worksheet-preview-call-details">{worksheet.callDetails?.trim() || 'No call details recorded.'}</div>
                  <div className="worksheet-preview-fields">
                    <PreviewField label="Concerned person" value={worksheet.concernedPerson} />
                    <PreviewField label="Email" value={worksheet.email} />
                    <PreviewField label="Additional phone" value={worksheet.additionalPhone} />
                    <PreviewField label="Direct line" value={worksheet.directLine} />
                    <PreviewField
                      label="Callback"
                      value={worksheet.callbackAt ? `${formatDate(worksheet.callbackAt)}${worksheet.timezone ? ` · ${worksheet.timezone}` : ''}` : null}
                    />
                    <PreviewField
                      label="Last updated"
                      value={worksheet.updatedByName
                        ? `${worksheet.updatedByName}${worksheet.updatedAt ? ` · ${formatDate(worksheet.updatedAt)}` : ''}`
                        : worksheet.updatedAt ? formatDate(worksheet.updatedAt) : null}
                    />
                  </div>
                </>
              ) : (
                <p className="worksheet-preview-empty">No worksheet has been saved for this lead yet.</p>
              )}
              {enableAssignment && tenantId && practiceId && (
                <section className="worksheet-preview-assignment" aria-label="Lead assignment">
                  <div className="worksheet-preview-section-heading">
                    <h3>Lead assignment</h3>
                    {assignmentOptions?.assignedToName && <span>{assignmentOptions.assignedToName}</span>}
                  </div>
                  {assignmentLoading ? (
                    <p className="worksheet-preview-assignment-status" role="status">Loading eligible teammates…</p>
                  ) : assignmentOptions?.canAssign ? (
                    <>
                      <div className="worksheet-preview-assign-row">
                        <select aria-label="Assign lead to teammate" value={assignmentTarget} onChange={event => setAssignmentTarget(event.target.value)} disabled={assignmentBusy}>
                          <option value="">Choose a teammate…</option>
                          {assignmentOptions.agents.map(agent => (
                            <option key={agent.id} value={agent.id}>{agent.fullName} · {agent.role.replaceAll('_', ' ')}</option>
                          ))}
                        </select>
                        <button type="button" className="worksheet-preview-assign" onClick={() => void handleReassign()} disabled={!assignmentTarget || assignmentBusy || assignmentTarget === assignmentOptions.assignedTo}>
                          {assignmentBusy ? 'Assigning…' : assignmentOptions.assignedTo ? assignmentTarget === assignmentOptions.assignedTo ? 'Currently assigned' : 'Reassign lead' : 'Assign lead'}
                        </button>
                      </div>
                      {assignmentMessage && <p className={`worksheet-preview-assignment-status${assignmentMessage.startsWith('Lead assigned') ? ' is-success' : ' is-error'}`} role="status">{assignmentMessage}</p>}
                      {assignmentOptions.agents.length === 0 && <p className="worksheet-preview-assignment-status">No eligible active teammates found.</p>}
                    </>
                  ) : assignmentMessage ? (
                    <p className="worksheet-preview-assignment-status is-error" role="alert">{assignmentMessage}</p>
                  ) : null}
                </section>
              )}
            </section>

            <section className="worksheet-preview-timeline" aria-label="Recent activity">
              <div className="worksheet-preview-section-heading">
                <h3>Recent activity</h3>
                <span>{activityLoading ? '…' : preview?.activities.length ?? 0}</span>
              </div>
              {activityLoading ? (
                <div className="worksheet-preview-activity-loading" role="status">
                  <span>Loading recent activity…</span>
                  {Array.from({ length: 3 }, (_, index) => <i aria-hidden="true" key={index} />)}
                </div>
              ) : activityError ? (
                <p className="worksheet-preview-assignment-status is-error" role="status">{activityError}</p>
              ) : preview?.activities.length ? (
                <ol>
                  {preview.activities.map((activity, index) => (
                    <li key={`${activity.createdAt}-${index}`}>
                      <span className="worksheet-preview-timeline-dot" />
                      <div>
                        <strong>{activity.disposition || 'Worksheet updated'}</strong>
                        {activity.note && <p>{activity.note}</p>}
                        <small>{activity.userName || 'Team member'} · {formatDate(activity.createdAt)}</small>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="worksheet-preview-empty">No activity has been recorded yet.</p>
              )}
            </section>
          </>
        )}
      </div>

      <footer className="worksheet-preview-footer">
        <button type="button" className="worksheet-preview-secondary" onClick={onClose}>Close</button>
        {resolvedFullLeadHref && (
          <Link prefetch={false} href={resolvedFullLeadHref} className="worksheet-preview-open">
            {fullLeadLabel} <ExternalLink size={14} />
          </Link>
        )}
      </footer>
    </dialog>
  )
}
