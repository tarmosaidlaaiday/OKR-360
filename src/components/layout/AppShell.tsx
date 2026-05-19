import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ReviewBanner } from './ReviewBanner'
import { SampleDataBanner } from './SampleDataBanner'
import { useNotifications } from '../../hooks/useNotifications'
import { useReviewCycle } from '../../hooks/useReviewCycle'
import { useSampleData } from '../../hooks/useSampleData'

export function AppShell() {
  const navigate = useNavigate()
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const { selfAssessmentDue, cycleLabel, reviewClosesAt } = useReviewCycle()
  const { hasSampleData, clearing, clearSampleData } = useSampleData()
  const [bannerDismissed, setBannerDismissed] = useState(false)

  return (
    <div className="cd-app">
      <Sidebar />
      <div className="cd-shell">
        <TopBar
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkRead={markRead}
          onMarkAllRead={markAllRead}
          onCheckin={() => navigate('/check-in')}
        />
        {hasSampleData && <SampleDataBanner onClear={clearSampleData} clearing={clearing} />}
        {selfAssessmentDue && !bannerDismissed && (
          <ReviewBanner
            cycleLabel={cycleLabel}
            closesAt={reviewClosesAt}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}
        <div className="cd-content">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
