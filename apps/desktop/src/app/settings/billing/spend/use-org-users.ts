import { useAuth, useOrganization, useUser } from '@clerk/react'
import { useEffect, useMemo } from 'react'

/**
 * Org member emails from Clerk (admins only) plus the current user's own email.
 * The spend gateway rows carry only the Clerk user id, so this map is what
 * turns ids into readable emails in the table and the user filter.
 */
export function useOrgUsers(): { emailsById: Map<string, string> } {
  const { orgRole } = useAuth()
  const isAdmin = orgRole === 'org:admin'

  const { memberships } = useOrganization({
    memberships: isAdmin ? { infinite: true, keepPreviousData: true, pageSize: 100 } : undefined
  })

  const { user } = useUser()

  // Load every page of members.
  useEffect(() => {
    if (!isAdmin || !memberships) {
      return
    }

    if (memberships.hasNextPage && !memberships.isFetching) {
      void memberships.fetchNext()
    }
  }, [isAdmin, memberships, memberships?.hasNextPage, memberships?.isFetching])

  const emailsById = useMemo(() => {
    const map = new Map<string, string>()
    const aiCollaboratorIds = new Set<string>()

    for (const membership of memberships?.data ?? []) {
      const id = membership.publicUserData?.userId

      if (!id) {
        continue
      }

      if ((membership.role || '').toLowerCase() === 'org:ai_collaborator') {
        aiCollaboratorIds.add(id)

        continue
      }

      map.set(id, membership.publicUserData?.identifier ?? id)
    }

    const ownEmail = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress

    if (user?.id && ownEmail && !map.has(user.id) && !aiCollaboratorIds.has(user.id)) {
      map.set(user.id, ownEmail)
    }

    return map
  }, [memberships?.data, user])

  return { emailsById }
}
