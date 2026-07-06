import { useQuery } from '@tanstack/react-query'
import { App, Button, Table, Tooltip, Typography } from 'antd'
import { useLingui } from '@lingui/react/macro'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy, faCircleQuestion } from '@fortawesome/free-regular-svg-icons'
import { getBroadcastLinkStats, LinkClickStats } from '../../services/api/messages_history'

const { Text } = Typography

interface BroadcastLinkStatsProps {
  workspaceId: string
  broadcastId: string
  enabled?: boolean
}

export function BroadcastLinkStats({
  workspaceId,
  broadcastId,
  enabled = true
}: BroadcastLinkStatsProps) {
  const { t } = useLingui()
  const { message } = App.useApp()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['broadcast-link-stats', workspaceId, broadcastId],
    queryFn: () => getBroadcastLinkStats(workspaceId, broadcastId),
    // Only fetched while the details section is visible; stats are read once, no
    // polling, and kept fresh for a minute so expand/collapse toggles do not
    // refire the server-side aggregation.
    enabled,
    staleTime: 60_000,
    retry: false
  })

  const linkStats = data?.link_stats ?? []
  const totalUniqueClicks = linkStats.reduce((sum, row) => sum + row.unique_clicks, 0)

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    message.success(t`URL copied to clipboard.`)
  }

  // Older servers answer this route with an empty 200 body, which makes the API
  // client throw while parsing the response. Whatever the failure, degrade to a
  // quiet empty state instead of breaking the details section.
  if (isError) {
    return (
      <div className="mb-6">
        <Text type="secondary">{t`Per-link click data is not available.`}</Text>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <Table
        dataSource={linkStats.map((row) => ({ ...row, key: row.url }))}
        columns={[
          {
            title: (
              <span className="flex items-center gap-2">
                {t`Link Clicks`}
                <Tooltip
                  title={t`Per-link tracking only covers clicks recorded after this feature was enabled. Older clicks are counted in the aggregate Clicks stat only. Each message records up to 50 distinct URLs.`}
                >
                  <FontAwesomeIcon
                    icon={faCircleQuestion}
                    className="text-gray-400 cursor-help"
                    style={{ opacity: 0.7 }}
                  />
                </Tooltip>
              </span>
            ),
            dataIndex: 'url',
            key: 'url',
            render: (url: string) => (
              <div className="flex items-center gap-1">
                {/* Plain text on purpose: recorded URLs can be forged by any email
                    recipient (tracking tokens are mintable), so rendering them as
                    clickable links would hand admins a phishing vector. */}
                <Tooltip title={url}>
                  <span className="truncate inline-block align-bottom" style={{ maxWidth: 480 }}>
                    {url}
                  </span>
                </Tooltip>
                <Tooltip title={t`Copy URL`}>
                  <Button
                    type="text"
                    size="small"
                    icon={<FontAwesomeIcon icon={faCopy} style={{ opacity: 0.7 }} />}
                    onClick={() => copyUrl(url)}
                  />
                </Tooltip>
              </div>
            )
          },
          {
            title: t`Total clicks`,
            dataIndex: 'total_clicks',
            key: 'total_clicks',
            width: 120,
            align: 'right' as const,
            render: (value: number) => value.toLocaleString()
          },
          {
            title: t`Unique clicks`,
            dataIndex: 'unique_clicks',
            key: 'unique_clicks',
            width: 120,
            align: 'right' as const,
            render: (value: number) => value.toLocaleString()
          },
          {
            title: t`Click share`,
            key: 'click_share',
            width: 110,
            align: 'right' as const,
            render: (_: unknown, record: LinkClickStats) =>
              totalUniqueClicks > 0
                ? `${((record.unique_clicks / totalUniqueClicks) * 100).toFixed(1)}%`
                : '-'
          }
        ]}
        size="small"
        loading={isLoading}
        pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t`No link clicks recorded yet` }}
      />
      {linkStats.length >= 200 && (
        <div className="text-xs text-gray-400 mt-1">
          {t`Showing the top 200 links by total clicks.`}
        </div>
      )}
    </div>
  )
}
