# Facebook Page live-announcement setup

The Worker can publish one Facebook Page post when a new Crack Packs YouTube
video becomes live. The post uses the YouTube title and description, links to
the Crack Packs Whatnot profile, and includes the YouTube watch URL.

The feature is installed disabled. Keep `FACEBOOK_AUTO_POST_ENABLED` set to
`"false"` until the Meta app and Page access token are ready.

## Meta requirements

Use a Meta app controlled by the same business or person who controls the
Facebook Page. Request the least access needed for Page publishing:

- `pages_manage_posts`
- `pages_read_engagement`

Use `pages_show_list` while obtaining the list of Pages the signed-in person
manages. `publish_video` is not needed for this integration because it creates a
text/link post, not a native Facebook video.

The returned Page token must include a content-creation Page task such as
`CREATE_CONTENT` or `PROFILE_PLUS_CREATE_CONTENT`. App review, advanced access,
business verification, or switching the app to Live mode may be required by
Meta before non-app-role users can authorize these permissions.

Official references:

- https://developers.facebook.com/docs/pages-api/posts/
- https://www.postman.com/meta/facebook/request/bqfxwbp/get-access-tokens-of-pages-you-manage

## Values and secrets

Set these non-secret values in `wrangler.jsonc`:

- `FACEBOOK_PAGE_ID`: the Page `id` returned by `/me/accounts`
- `FACEBOOK_GRAPH_VERSION`: currently `v25.0`
- `WHATNOT_LIVE_URL`: `https://www.whatnot.com/user/crack_packs`
- `FACEBOOK_AUTO_POST_ENABLED`: change to `"true"` only after setup

Also put the public Facebook Page URL in `assets/js/config.js` as
`facebookUrl`. That makes the Facebook button appear in the member Profile
social-links section; the Page access token never belongs in browser code.

Store these only as encrypted Worker secrets:

- `FACEBOOK_PAGE_ACCESS_TOKEN`: the Page access token returned for the Page
- `FACEBOOK_APP_SECRET`: Meta Developers > App settings > Basic > App secret

From this directory in PowerShell:

```powershell
npx.cmd wrangler secret put FACEBOOK_PAGE_ACCESS_TOKEN
npx.cmd wrangler secret put FACEBOOK_APP_SECRET
npx.cmd wrangler secret list
npx.cmd wrangler deploy --dry-run
npx.cmd wrangler deploy
```

Never paste either secret into `wrangler.jsonc`, Git, browser JavaScript, an
email, or a support screenshot.

## How duplicate prevention works

A one-minute Cloudflare Cron Trigger checks the existing YouTube status
pipeline. A single SQLite-backed Durable Object coordinates Facebook posting
and stores one record per YouTube video ID.

- A successful post is never posted again.
- A definite Meta 4xx rejection can retry every 15 minutes, up to 12 attempts.
- A network failure, Meta 5xx response, or other ambiguous outcome is not
  retried automatically because the post might have succeeded despite the
  missing response. This favors avoiding duplicate Facebook posts.

Use Cloudflare Worker logs to inspect failures:

```powershell
npx.cmd wrangler tail
```

If an ambiguous record must be cleared, inspect the
`SocialAnnouncementCoordinator` Durable Object in Cloudflare Data Studio before
removing it. First verify that Facebook did not already publish the post.

## Token maintenance

Use Meta's Access Token Debugger to verify the Page token, its app, scopes, Page
tasks, and expiration. Page role changes, password/security events, permission
changes, or app configuration changes can invalidate a previously working
token. Rotate the Worker secret when Meta issues a replacement.
