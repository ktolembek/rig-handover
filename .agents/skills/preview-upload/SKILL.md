---
name: preview-upload
description: Put one saved rig page on a public Netlify link and take it down again (ADR 0003). Use for a plan's "Preview for review" and "Clean up" issues.
---

# preview-upload

One HTML file on a public HTTPS link we can upload over, and remove. Needs `netlify` (CLI) signed
in (`netlify status`). Ask the human before every upload and before a take-down.

## Save the page (a command, not "save as")

```sh
mkdir -p /tmp/rig-preview
PORT=8795 pnpm start &              # LANE_MARKER from .env; unset it for the clean copy
curl -s -o /tmp/rig-preview/index.html http://127.0.0.1:8795/digest/<night>
kill %1
```

Keep the folder outside the repo: no previews in the repo (ADR 0003). For the clean copy run
`LANE_MARKER= PORT=8795 pnpm start` and check the banner reads "no marker set".

## Put

First time only, create the site without linking the repo:

```sh
cd /tmp/rig-preview && netlify sites:create --name <site-name> --disable-linking --json
```

Upload (also the command that uploads over the same link later):

```sh
cd /tmp/rig-preview && netlify deploy --prod --no-build --dir /tmp/rig-preview --site <site-id> --json
```

The link is `url` in the JSON. New projects can start private (401, Netlify login redirect): the
human sets Project configuration > General > Visitor access > visibility to public.

## Take down

```sh
netlify sites:delete <site-id> --force
```

Every deploy also gets its own permalink (`<deploy-id>--<site-name>.netlify.app`) that keeps
serving that deploy's file after a new upload. When a marker has to go, check old deploy
permalinks too, not only the main link.

## Check

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<site-name>.netlify.app/
```

Netlify's free tier injects an HTML comment and a toolbar script into served pages; the file we
uploaded has neither.
