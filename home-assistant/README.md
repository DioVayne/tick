# Tick in Home Assistant

Read your tasks in Home Assistant and complete, postpone or add them from automations. No custom component: one package file with `rest_command` and trigger-based template sensors.

## What you get

| Entity | State | Attribute `tasks` |
|---|---|---|
| `sensor.tick_open` | number of open tasks | `[{id, title, list, due}]` |
| `sensor.tick_today` | tasks with a reminder today | same, only today |
| `sensor.tick_overdue` | tasks with a reminder before today | same, only overdue |
| `rest_command.tick_done` | complete a task: `data: {id}` | |
| `rest_command.tick_tomorrow` | move a task to tomorrow: `data: {id}` | |
| `rest_command.tick_add` | add a task: `data: {title, due?, list?}` | |

`due` is the reminder in Home Assistant's local time (ISO), or `null`. When adding, a `due` without a zone is read in your Tick time zone, and a bare date gets your reminder time. Only top-level tasks count, like the badge on the Tick icon; tasks shared with you are included. Home Assistant polls once a minute, so a change in Tick shows up within a minute.

## Install

1. **Key.** In Tick: Settings → Advanced → Keys → + New key, named for example `Home Assistant`, with access "Full access". Tick shows the key once; put it in `secrets.yaml`, with `Bearer ` in front:

   ```yaml
   tick_full: "Bearer tick_..."
   ```

   A full key reaches your tasks and lists, but not settings, keys or accounts. Revoking it in Tick stops it at once.

2. **Packages.** If `configuration.yaml` has no packages yet, add:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

3. **The package.** Copy [`tick.yaml`](tick.yaml) to `<config>/packages/tick.yaml` and replace every `https://tick.example.com` with your Tick address.

4. **Check and restart.** Developer tools → YAML → Check configuration, then restart. The three sensors appear within a minute.

5. **Dashboard (optional).** Add a manual card with [`tick-card.yaml`](tick-card.yaml).

## Examples

Add a task when the washing machine is done:

```yaml
automation:
  - alias: "Washing machine done → Tick"
    triggers:
      - trigger: state
        entity_id: sensor.washing_machine_status
        to: "done"
    actions:
      - action: rest_command.tick_add
        data:
          title: "Empty the washing machine"
          list: "Home"
      - event: tick_refresh
```

A morning notification when tasks are overdue:

```yaml
automation:
  - alias: "Tick: overdue"
    triggers:
      - trigger: time
        at: "08:00:00"
    conditions:
      - condition: numeric_state
        entity_id: sensor.tick_overdue
        above: 0
    actions:
      - action: notify.mobile_app_your_phone
        data:
          message: >-
            {{ states('sensor.tick_overdue') }} overdue:
            {{ state_attr('sensor.tick_overdue', 'tasks') | map(attribute='title') | join(', ') }}
```

Complete the first task of today (for example from a button):

```yaml
- action: rest_command.tick_done
  data:
    id: "{{ (state_attr('sensor.tick_today', 'tasks') | first).id }}"
- event: tick_refresh
```

Firing the event `tick_refresh` after a change makes the sensors fetch again at once instead of within the minute.

## Troubleshooting

- **Sensors `unavailable`:** the fetch failed. A `401` in the log means the key is wrong or revoked (check the `Bearer ` prefix in `secrets.yaml`); a timeout means Home Assistant cannot reach the address.
- **Times an hour off:** Home Assistant's time zone (Settings → System → General) differs from the one in Tick.
- **"Attributes exceed 16384 bytes" in the log:** with many hundreds of open tasks the attribute gets too big to keep in the history; the sensors still work.
