import { useAuth } from '@clerk/electron/react'
import { useEffect } from 'react'

import { setClerkTokenGetter } from '@/lib/clerk-session'

export function ClerkSessionBridge() {
  const { getToken } = useAuth()

  useEffect(() => {
    setClerkTokenGetter(() => getToken())

    return () => setClerkTokenGetter(null)
  }, [getToken])

  return null
}
