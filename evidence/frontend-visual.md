# Frontend visual correction

Date: 2026-10-24

Observed real route: `http://127.0.0.1:9001/app/changedesk`.

The pre-fix browser capture at the environment-local, ignored path `evidence/local/frontend-demo.png` showed that the plugin-generated `index.css` was not applied by the Medusa admin host: text rendered at browser defaults, product checkboxes flowed inline, and there was no page hierarchy.

Commit `d045249` makes the route self-contained by importing `route.css?inline` and rendering it in a scoped `style` element. It also reduces the heading to 26–36 px, constrains content to 1080 px, lays product rows out as aligned checkbox/name/status columns with 54 px targets, and separates the next action into a clear responsive side card.

Status: IMPLEMENTED, NOT VISUALLY VERIFIED AFTER REBUILD at closure time. The environment owner integrated the commit and started the SDK/plugin/host rebuild, but did not return a healthy-host signal and post-fix capture before the user-requested immediate close. The pre-fix capture must not be presented as the final UI.
