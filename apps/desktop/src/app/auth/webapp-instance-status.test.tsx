// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WebappInstanceState } from '@/store/webapp-instance'

import { WebappInstanceStatus } from './webapp-instance-status'

vi.mock('@clerk/react', () => ({
  OrganizationSwitcher: () => <div>Choose organization</div>,
  SignIn: () => <div>Sign in</div>,
  SignUp: () => <div>Sign up</div>
}))
vi.mock('@/i18n', () => ({ useI18n: () => ({ locale: 'en', t: { common: { retry: 'Retry' } } }) }))

const makeState = (status: WebappInstanceState['status']): WebappInstanceState => ({ error: null, identity: null, status })

const renderStatus = (status: WebappInstanceState['status'], actionError: null | string = null) => {
  const onRetry = vi.fn()
  const onSignOut = vi.fn()
  render(<WebappInstanceStatus actionError={actionError} onRetry={onRetry} onSignOut={onSignOut} pending={false} signedIn state={makeState(status)} />)

  return { onRetry, onSignOut }
}

afterEach(cleanup)

describe('WebappInstanceStatus', () => {
  it('prioritizes signing in again for an unauthorized session', () => {
    const { onRetry, onSignOut } = renderStatus('unauthorized')
    expect(screen.getByRole('heading', { name: 'We couldn’t verify your session' })).toBeTruthy()
    expect(screen.getByText('Please sign in again to continue.')).toBeTruthy()
    const signIn = screen.getByRole('button', { name: 'Sign in again' })
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(signIn.getAttribute('data-variant')).toBe('default')
    expect(retry.getAttribute('data-variant')).toBe('ghost')
    expect(screen.queryByRole('link', { name: 'Open Unitalk' })).toBeNull()
    fireEvent.click(signIn)
    fireEvent.click(retry)
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows errors returned when sign-out fails', () => {
    renderStatus('unauthorized', 'Sign-out failed')
    expect(screen.getByText('Sign-out failed').getAttribute('role')).toBe('alert')
  })

  it('keeps other error states and their actions unchanged', () => {
    const { onRetry } = renderStatus('missing')
    expect(screen.getByRole('heading', { name: 'Could not open your instance' })).toBeTruthy()
    expect(screen.getByText('Create an instance for this organization to continue.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Unitalk' }).getAttribute('href')).toBe('https://unitalk.ai')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})