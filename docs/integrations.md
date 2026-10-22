# Integrations

## Claude (MCP)
Tick has an MCP server at `/mcp`, so Claude Code or Claude Desktop can manage your tasks: list and search them, show your lists, add, change, tick off, reopen, snooze and delete (to the trash). Claude uses a *full* key of its own, which you can revoke at any time; it cannot reach your settings, keys or password. Setting it up: [SETUP.md, step 12](../SETUP.md#12-optional-claude-mcp).

## Inbox API for automations
`POST /api/inbox` adds a task, for example from a shortcut, a script or an email rule. Make a key under **⚙ Settings → Advanced → Keys → New key**, kind *Inbox*; that key can only add tasks.

```bash
curl -X POST https://tick.example.com/api/inbox \
  -H "Authorization: Bearer $INBOX_KEY" -H "content-type: application/json" \
  -d '{"title": "Call the dentist", "notes": "about the check-up", "due": "2026-11-03", "list": "Home"}'
```

| Field | Meaning |
|---|---|
| `title` | The task (required) |
| `notes` | The notes, in markdown |
| `due` | A date (gets your reminder time), a local time like `2026-11-03T14:30`, or a time with a zone |
| `list` | The list; a list that does not exist yet is made |
| `repeat` | A repeat rule such as `FREQ=WEEKLY;BYDAY=MO` |

The Dutch field names `titel`, `omschrijving` and `datum` work too.

## Home Assistant
Sensors for your open, today's and overdue tasks, and actions to complete, postpone and add tasks, as one package file. See [home-assistant/README.md](../home-assistant/README.md).

## Fallback webhook
When a notification could not be delivered within 15 minutes, or you have no device with notifications, Tick can post it to a webhook of your own instead (for example to a chat app or Home Assistant). Set it under **⚙ Settings → Advanced → Fallback webhook** (`https://` only) and use *Send test* to check. Leave it empty to switch it off.
