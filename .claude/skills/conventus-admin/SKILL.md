---
name: conventus-admin
description: Perform Conventus room-admin actions through the REST API — create/rename/delete channels, add and configure OpenAI-compatible bots, reserve names, manage members, set status/avatar, and export/import the whole room. Use when asked to administer or seed a Conventus room.
---

# Conventus — admin actions via the API

Everything an admin can do in the UI is a REST call. First get an **admin
token** (room password + admin password), then send it as a bearer token.

```bash
B=${URL:-http://localhost:8899}
TOKEN=$(curl -s -X POST $B/api/auth/login -H 'content-type: application/json' \
  -d '{"password":"'"$ROOM_PASSWORD"'","name":"admin","admin_password":"'"$ADMIN_PASSWORD"'"}' \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')
H="Authorization: Bearer $TOKEN"
```

Endpoints marked 🔒 require the admin token. Full reference: `docs/content.md`
or `$B/docs`.

## Channels

```bash
# create / rename / delete (🔒)
curl -s -X POST  $B/api/channels        -H "$H" -H 'content-type: application/json' -d '{"name":"announcements","topic":"read-only-ish"}'
curl -s -X PATCH $B/api/channels/2      -H "$H" -H 'content-type: application/json' -d '{"name":"general-chat","topic":"hi"}'
curl -s -X DELETE $B/api/channels/2     -H "$H"   # not the default channel
```

## Bots (OpenAI-compatible) 🔒

```bash
curl -s -X POST $B/api/bots -H "$H" -H 'content-type: application/json' -d '{
  "name":"assistant","base_url":"https://api.openai.com/v1","api_key":"sk-…",
  "model":"gpt-4o-mini","system_prompt":"Be concise and kind.",
  "trigger":"mention","channels":[],"avatar":"🤖"}'
# edit (blank api_key keeps the existing one) / disable / delete
curl -s -X PATCH  $B/api/bots/1 -H "$H" -H 'content-type: application/json' -d '{"trigger":"all","enabled":false}'
curl -s -X DELETE $B/api/bots/1 -H "$H"
```
`trigger` is `mention` or `all`; empty `channels` = all channels.

## Members & identity

```bash
curl -s -X POST $B/api/admin/reserve -H "$H" -H 'content-type: application/json' -d '{"name":"speaker","password":"green-sun","is_admin":false}'  # 🔒
curl -s -X DELETE $B/api/admin/members/speaker -H "$H"                                                                                            # 🔒
curl -s -X POST $B/api/members/status  -H "$H" -H 'content-type: application/json' -d '{"status":"🌿 hosting"}'
curl -s -X POST $B/api/members/avatar  -H "$H" -H 'content-type: application/json' -d '{"avatar":"🦊"}'   # emoji or image URL
```
For emoji bodies, prefer a UTF-8 JSON file + `curl --data-binary @file`.

## Seed messages / automate posts

```bash
curl -s -X POST $B/api/channels/1/messages -H "$H" -H 'content-type: application/json' \
  -d '{"content":"Welcome to the grove 🌿  Try the **canvas** and `/help`."}'
```

## Snapshot the room (export / import) 🔒

```bash
curl -s -X POST $B/api/admin/export -H "$H" -o room.zip        # messages + files + bots + members
curl -s -X POST $B/api/admin/import -H "$H" -F "file=@room.zip"  # replaces the whole room
```

## Notes

- A **reserved** name requires its per-name password at login; granting
  `is_admin` makes that name an admin.
- Deleting a channel removes its messages; deleting a board removes its collab
  log. Both are irreversible (export first if unsure).
- The same token works against a deployed Space — set `URL`, `ROOM_PASSWORD`,
  `ADMIN_PASSWORD` and reuse these recipes.
