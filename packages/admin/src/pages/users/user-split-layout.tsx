/**
 * User-flavored split layout. Wraps the generic `SplitLayout` with the
 * two user-only collapsibles (Active sessions, Audit). Keeping this
 * file as a thin wrapper means non-user resources go straight through
 * `SplitLayout` without dragging the user-specific imports along.
 */
import * as React from 'react';
import { SplitLayout } from '../internals/split-layout';
import { CollapsibleSection } from '../internals/collapsible-section';
import { ActiveUserSessionsTab } from './active-sessions-tab';
import { UserAuditTab } from './audit-tab';
import { iconFor } from '../../icons';

export interface UserSplitLayoutProps {
  userId: string;
  profile: React.ReactNode;
  tabs: React.ReactNode;
  /** Bulk `/_counts` payload. The Active sessions section reads
   *  `__active_sessions` here for its header badge until its own
   *  polling updates the override. */
  counts: Record<string, number> | null;
  /** Eyebrow label above the profile card. Defaults to "Profile" so
   *  the existing UX doesn't regress; Edit pages can pass
   *  "Edit profile" to make the surface intent obvious. */
  profileLabel?: string;
}

export function UserSplitLayout({
  userId, profile, tabs, counts, profileLabel = 'Profile',
}: UserSplitLayoutProps) {
  const [liveSessionsCount, setLiveSessionsCount] = React.useState<number | null>(null);

  return (
    <SplitLayout
      profile={profile}
      tabs={tabs}
      profileLabel={profileLabel}
      below={(
        <>
          <CollapsibleSection
            title="Active sessions"
            icon={iconFor('radio')}
            count={liveSessionsCount ?? counts?.['__active_sessions']}
            testId="section-active-sessions"
          >
            <ActiveUserSessionsTab
              userId={userId}
              onCountChange={setLiveSessionsCount}
            />
          </CollapsibleSection>
          <CollapsibleSection
            title="Audit"
            icon={iconFor('file-text')}
            testId="section-audit"
          >
            <UserAuditTab userId={userId} />
          </CollapsibleSection>
        </>
      )}
    />
  );
}
