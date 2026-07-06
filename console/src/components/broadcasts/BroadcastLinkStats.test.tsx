import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import { BroadcastLinkStats } from './BroadcastLinkStats'
import { getBroadcastLinkStats } from '../../services/api/messages_history'

// antd's Table scroll wrapper mounts a ResizeObserver; jsdom doesn't provide one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('../../services/api/messages_history', () => ({
  getBroadcastLinkStats: vi.fn()
}))

const mockedGetBroadcastLinkStats = getBroadcastLinkStats as ReturnType<typeof vi.fn>

const clipboardWriteText = vi.fn()
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: clipboardWriteText },
  configurable: true
})

const renderComponent = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AntApp>
        <BroadcastLinkStats workspaceId="ws1" broadcastId="bc1" />
      </AntApp>
    </QueryClientProvider>
  )
}

describe('BroadcastLinkStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a row per link with counts and click share', async () => {
    mockedGetBroadcastLinkStats.mockResolvedValue({
      link_stats: [
        { url: 'https://example.com/pricing', total_clicks: 10, unique_clicks: 6 },
        { url: 'https://example.com/blog', total_clicks: 3, unique_clicks: 2 }
      ]
    })

    renderComponent()

    expect(await screen.findByText('https://example.com/pricing')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/blog')).toBeInTheDocument()
    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // Click share = unique clicks over the sum of unique clicks (6+2=8).
    expect(screen.getByText('75.0%')).toBeInTheDocument()
    expect(screen.getByText('25.0%')).toBeInTheDocument()
    expect(mockedGetBroadcastLinkStats).toHaveBeenCalledWith('ws1', 'bc1')
  })

  it('never renders recorded URLs as clickable links', async () => {
    // Recorded URLs are attacker-influenceable (recipients can mint tracking
    // tokens with arbitrary URLs), so the table must render them as plain text.
    mockedGetBroadcastLinkStats.mockResolvedValue({
      link_stats: [{ url: 'https://evil.example.com/phish', total_clicks: 1, unique_clicks: 1 }]
    })

    const { container } = renderComponent()

    await screen.findByText('https://evil.example.com/phish')
    expect(container.querySelector('a')).toBeNull()
  })

  it('offers a copy-to-clipboard action for each URL', async () => {
    mockedGetBroadcastLinkStats.mockResolvedValue({
      link_stats: [{ url: 'https://example.com/pricing', total_clicks: 10, unique_clicks: 6 }]
    })

    renderComponent()

    await screen.findByText('https://example.com/pricing')
    const copyButtons = screen.getAllByRole('button')
    expect(copyButtons.length).toBeGreaterThan(0)
    await userEvent.click(copyButtons[0])
    expect(clipboardWriteText).toHaveBeenCalledWith('https://example.com/pricing')
  })

  it('degrades to a quiet empty state when the query fails', async () => {
    // Old servers answer the route with an empty 200 body, which surfaces as a
    // SyntaxError from response parsing — the section must not crash.
    mockedGetBroadcastLinkStats.mockRejectedValue(
      new SyntaxError('Unexpected end of JSON input')
    )

    renderComponent()

    expect(await screen.findByText('Per-link click data is not available.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows an empty table state when no clicks were recorded', async () => {
    mockedGetBroadcastLinkStats.mockResolvedValue({ link_stats: [] })

    renderComponent()

    expect(await screen.findByText('No link clicks recorded yet')).toBeInTheDocument()
  })
})
