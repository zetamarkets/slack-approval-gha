# slack-approval

custom action to send approval request to Slack

![](https://user-images.githubusercontent.com/35091584/195488201-acc24277-5e0c-431f-a4b3-21b4430d5d80.png)


- Posts a main message in Slack with approval status and "Approve" and "Reject" buttons appended.
- Clicking on "Approve" will execute next steps after the required approvals.
- Clicking on "Reject" will cause workflow to fail.
- Canceling or timing out the workflow updates the message and fails the job.

# How To Use

- First, create a Slack App and install in your workspace.
- Second, add `chat:write` and `im:write` to OAuth Scope on OAuth & Permissions page.
- Finally, **Enable Socket Mode**.

```yaml
jobs:
  approval:
    runs-on: ubuntu-latest
    steps:
      - name: send approval
        uses: varu3/slack-approval@main
        with:
          approvers: U12345678,U23456789
          minimumApprovalCount: 2
        env:
          SLACK_APP_TOKEN: ${{ secrets.SLACK_APP_TOKEN }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_SIGNING_SECRET: ${{ secrets.SLACK_SIGNING_SECRET }}
          SLACK_CHANNEL_ID: ${{ secrets.SLACK_CHANNEL_ID }}
        timeout-minutes: 10
```

- Set environment variables

  - `SLACK_APP_TOKEN`

    - App-level tokens on `Basic Information page`. (starting with `xapp-` )

  - `SLACK_BOT_TOKEN`

    - Bot-level tokens on `OAuth & Permissions page`. (starting with `xoxb-` )

  - `SLACK_SIGNING_SECRET`

    - Signing Secret on `Basic Information page`.

  - `SLACK_CHANNEL_ID`

    - Channel ID for which you want to send approval.

- Set `timeout-minutes`
  - Set the time to wait for approval. If the timeout is reached, GitHub Actions will forcefully terminate the workflow.

## Approvers and Minimum Approval Count

You can restrict approval to a list of Slack user IDs and require multiple approvals.

- `approvers`: Comma-separated Slack user IDs who can approve or reject.
- `minimumApprovalCount`: Minimum number of unique approvals required (default: 1).
- If `approvers` is omitted, anyone in the channel can approve. The minimum count still applies.
- When `approvers` is set, `minimumApprovalCount` must be less than or equal to the number of approvers.

## Status Updates and Payload Overrides

The action posts a single main message that includes the buttons and approval status. The message is updated as approvals are collected, rejected, or canceled.

- `baseMessageTs`: Optional. If set, updates an existing message instead of posting a new one.
- `baseMessagePayload`: Slack message JSON for the main message. If empty, a default message is used.
- `successMessagePayload`: Slack message JSON to apply when approvals complete. Defaults to `baseMessagePayload`.
- `failMessagePayload`: Slack message JSON to apply when rejected or canceled. Defaults to `baseMessagePayload`.

Status and action blocks are appended automatically to whichever payload is active (base/success/fail). If your payload only includes `text`, it is converted to a section block so the text appears alongside the status.

## Custom Blocks

You can add custom blocks to the Slack notification by using the `custom-blocks` input:

```yaml
jobs:
  approval:
    runs-on: ubuntu-latest
    steps:
      - name: send approval
        uses: varu3/slack-approval@main
        with:
          custom-blocks: |
            [
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "*Environment:* Production"
                }
              }
            ]
        env:
          SLACK_APP_TOKEN: ${{ secrets.SLACK_APP_TOKEN }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          SLACK_SIGNING_SECRET: ${{ secrets.SLACK_SIGNING_SECRET }}
          SLACK_CHANNEL_ID: ${{ secrets.SLACK_CHANNEL_ID }}
        timeout-minutes: 10
```

The custom blocks will be displayed in the main message after the workflow information. If `baseMessagePayload` is provided, it takes full control of the main message and custom blocks are ignored. You can use any valid [Slack Block Kit](https://api.slack.com/block-kit) blocks.

## Outputs

- `mainMessageTs`: Timestamp of the main message sent to Slack.
