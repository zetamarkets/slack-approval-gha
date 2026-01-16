import * as core from '@actions/core'
import { App, LogLevel } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { KnownBlock, Block } from '@slack/types'

type SlackMessagePayload = Record<string, any>

const token = process.env.SLACK_BOT_TOKEN || ""
const signingSecret = process.env.SLACK_SIGNING_SECRET || ""
const slackAppToken = process.env.SLACK_APP_TOKEN || ""
const channel_id = process.env.SLACK_CHANNEL_ID || ""

const baseMessageTs = core.getInput('baseMessageTs') || ""
const customBlocksInput = core.getInput('custom-blocks') || "[]"
const approversInput = core.getInput('approvers') || ""
const minimumApprovalCountInput = core.getInput('minimumApprovalCount') || ""
const baseMessagePayloadInput = core.getMultilineInput('baseMessagePayload').join("")
const successMessagePayloadInput = core.getMultilineInput('successMessagePayload').join("")
const failMessagePayloadInput = core.getMultilineInput('failMessagePayload').join("")

const app = new App({
  token: token,
  signingSecret: signingSecret,
  appToken: slackAppToken,
  socketMode: true,
  port: 3000,
  logLevel: LogLevel.DEBUG,
})

const parseJsonInput = <T>(input: string, fallback: T, label: string): T => {
  if (!input.trim()) {
    return fallback
  }

  try {
    return JSON.parse(input) as T
  } catch (error) {
    console.warn(`Failed to parse ${label}, using default value:`, error)
    return fallback
  }
}

const hasPayload = (payload: SlackMessagePayload): boolean => {
  if (!payload) {
    return false
  }

  const text = payload.text
  const blocks = payload.blocks

  return (typeof text === 'string' && text.length > 0) || (Array.isArray(blocks) && blocks.length > 0)
}

async function run(): Promise<void> {
  try {
    const web = new WebClient(token)

    const github_server_url = process.env.GITHUB_SERVER_URL || ""
    const github_repos = process.env.GITHUB_REPOSITORY || ""
    const run_id = process.env.GITHUB_RUN_ID || ""
    const run_number = process.env.GITHUB_RUN_NUMBER || ""
    const run_attempt = process.env.GITHUB_RUN_ATTEMPT || ""
    const workflow = process.env.GITHUB_WORKFLOW || ""
    const runnerOS = process.env.RUNNER_OS || ""
    const actor = process.env.GITHUB_ACTOR || ""
    const actionsUrl = `${github_server_url}/${github_repos}/actions/runs/${run_id}`
    const aid = `${github_repos}-${workflow}-${run_id}-${run_number}-${run_attempt}`

    const parsedApprovers = approversInput
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    const uniqueApprovers = Array.from(new Set(parsedApprovers))
    const approverSet = new Set(uniqueApprovers)
    const restrictApprovers = uniqueApprovers.length > 0

    const parsedMinimumApprovalCount = Number.parseInt(minimumApprovalCountInput, 10)
    const minimumApprovalCount =
      Number.isFinite(parsedMinimumApprovalCount) && parsedMinimumApprovalCount > 0
        ? parsedMinimumApprovalCount
        : 1

    if (restrictApprovers && minimumApprovalCount > uniqueApprovers.length) {
      throw new Error('minimumApprovalCount cannot be greater than the number of approvers')
    }

    const approvedBy: string[] = []
    const approvedBySet = new Set<string>()
    const remainingApprovers = [...uniqueApprovers]

    const parsedCustomBlocks = parseJsonInput<(KnownBlock | Block)[]>(
      customBlocksInput,
      [],
      'custom-blocks'
    )

    const baseMessagePayload = parseJsonInput<SlackMessagePayload>(
      baseMessagePayloadInput,
      {},
      'baseMessagePayload'
    )
    const successMessagePayload = parseJsonInput<SlackMessagePayload>(
      successMessagePayloadInput,
      {},
      'successMessagePayload'
    )
    const failMessagePayload = parseJsonInput<SlackMessagePayload>(
      failMessagePayloadInput,
      {},
      'failMessagePayload'
    )

    const baseBlocks: (KnownBlock | Block)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'GitHub Actions Approval Request',
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*GitHub Actor:*\n${actor}`,
          },
          {
            type: 'mrkdwn',
            text: `*Repos:*\n${github_server_url}/${github_repos}`,
          },
          {
            type: 'mrkdwn',
            text: `*Actions URL:*\n${actionsUrl}`,
          },
          {
            type: 'mrkdwn',
            text: `*GITHUB_RUN_ID:*\n${run_id}`,
          },
          {
            type: 'mrkdwn',
            text: `*Workflow:*\n${workflow}`,
          },
          {
            type: 'mrkdwn',
            text: `*RunnerOS:*\n${runnerOS}`,
          },
        ],
      },
      {
        type: 'divider',
      },
    ]

    const defaultMainMessagePayload: SlackMessagePayload = {
      text: 'GitHub Actions Approval request',
      blocks: [...baseBlocks, ...parsedCustomBlocks],
    }

    const mainMessagePayload = hasPayload(baseMessagePayload)
      ? baseMessagePayload
      : defaultMainMessagePayload
    const resolvedSuccessMessagePayload = hasPayload(successMessagePayload)
      ? successMessagePayload
      : mainMessagePayload
    const resolvedFailMessagePayload = hasPayload(failMessagePayload)
      ? failMessagePayload
      : mainMessagePayload

    const formatUserMentions = (users: string[]) => users.map((id) => `<@${id}>`).join(', ')

    const renderStatusTitle = (): KnownBlock | Block => {
      const remainingApprovals = Math.max(0, minimumApprovalCount - approvedBy.length)
      const approvedMentions = formatUserMentions(approvedBy)
      const remainingMentions = formatUserMentions(remainingApprovers)
      let text = `*Required approvals:* ${minimumApprovalCount}\n*Remaining approvals:* ${remainingApprovals}`

      if (restrictApprovers) {
        text += `\n*Remaining approvers:* ${remainingMentions || 'None'}`
      }
      if (approvedMentions) {
        text += `\n*Approved by:* ${approvedMentions}`
      }

      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      }
    }

    const renderStatusBody = (): KnownBlock | Block => {
      if (approvedBy.length >= minimumApprovalCount) {
        const approvedMentions = formatUserMentions(approvedBy)
        return {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: approvedMentions.length > 0
              ? `Approved by ${approvedMentions} :white_check_mark:`
              : 'Approved :white_check_mark:',
          },
        }
      }

      return {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              emoji: true,
              text: 'Approve',
            },
            style: 'primary',
            value: aid,
            action_id: 'slack-approval-approve',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              emoji: true,
              text: 'Reject',
            },
            style: 'danger',
            value: aid,
            action_id: 'slack-approval-reject',
          },
        ],
      }
    }

    const renderRejectedBlock = (userId?: string): KnownBlock | Block => {
      const text = userId ? `Rejected by <@${userId}> :x:` : 'Rejected :x:'
      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text,
        },
      }
    }

    const renderCanceledBlock = (): KnownBlock | Block => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Canceled :radio_button: :leftwards_arrow_with_hook:',
      },
    })

    const buildMessagePayload = (
      payload: SlackMessagePayload,
      statusBlocks: (KnownBlock | Block)[]
    ): SlackMessagePayload => {
      const baseBlocks = Array.isArray(payload.blocks) ? payload.blocks : []
      const blocks =
        baseBlocks.length > 0
          ? [...baseBlocks, ...statusBlocks]
          : typeof payload.text === 'string' && payload.text.trim().length > 0
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: payload.text,
                  },
                },
                ...statusBlocks,
              ]
            : [...statusBlocks]

      return {
        ...payload,
        blocks,
      }
    }

    const approve = (userId: string): 'approved' | 'pending' | 'not-allowed' | 'already-approved' => {
      if (restrictApprovers && !approverSet.has(userId)) {
        return 'not-allowed'
      }
      if (approvedBySet.has(userId)) {
        return 'already-approved'
      }

      approvedBySet.add(userId)
      approvedBy.push(userId)

      if (restrictApprovers) {
        const idx = remainingApprovers.indexOf(userId)
        if (idx >= 0) {
          remainingApprovers.splice(idx, 1)
        }
      }

      return approvedBy.length >= minimumApprovalCount ? 'approved' : 'pending'
    }

    const initialStatusBlocks = [renderStatusTitle(), renderStatusBody()]
    const initialMessagePayload = buildMessagePayload(mainMessagePayload, initialStatusBlocks)

    const mainMessage = baseMessageTs
      ? await web.chat.update({
          channel: channel_id,
          ts: baseMessageTs,
          ...(initialMessagePayload as any),
        } as any)
      : await web.chat.postMessage({
          channel: channel_id,
          ...(initialMessagePayload as any),
        } as any)

    const mainMessageTs = mainMessage.ts || baseMessageTs || ""

    core.setOutput('mainMessageTs', mainMessageTs)

    const updateMainMessage = async (
      client: WebClient,
      payload: SlackMessagePayload,
      statusBlocks: (KnownBlock | Block)[]
    ) => {
      if (!mainMessageTs) {
        return
      }
      const messagePayload = buildMessagePayload(payload, statusBlocks)
      await client.chat.update({
        channel: channel_id,
        ts: mainMessageTs,
        ...(messagePayload as any),
      })
    }

    const cancelHandler = async () => {
      await updateMainMessage(web, resolvedFailMessagePayload, [
        renderStatusTitle(),
        renderCanceledBlock(),
      ])
      process.exit(1)
    }

    process.on('SIGTERM', cancelHandler)
    process.on('SIGINT', cancelHandler)
    process.on('SIGBREAK', cancelHandler)

    app.action('slack-approval-approve', async ({ack, client, body, logger, action}) => {
      await ack()
      if (action.type !== 'button') {
        return
      }
      if (action.value !== aid) {
        return
      }

      const approveResult = approve(body.user.id)
      if (approveResult === 'not-allowed' || approveResult === 'already-approved') {
        return
      }

      try {
        if (approveResult === 'approved') {
          await updateMainMessage(client, resolvedSuccessMessagePayload, [
            renderStatusTitle(),
            renderStatusBody(),
          ])
        } else {
          await updateMainMessage(client, mainMessagePayload, [
            renderStatusTitle(),
            renderStatusBody(),
          ])
        }
      } catch (error) {
        logger.error(error)
      }

      if (approveResult === 'approved') {
        process.exit(0)
      }
    })

    app.action('slack-approval-reject', async ({ack, client, body, logger, action}) => {
      await ack()
      if (action.type !== 'button') {
        return
      }
      if (action.value !== aid) {
        return
      }
      if (restrictApprovers && !approverSet.has(body.user.id)) {
        return
      }

      try {
        await updateMainMessage(client, resolvedFailMessagePayload, [
          renderStatusTitle(),
          renderRejectedBlock(body.user.id),
        ])
      } catch (error) {
        logger.error(error)
      }

      process.exit(1)
    })

    await app.start(3000)
    console.log('Waiting Approval reaction.....')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  }
}

run()
