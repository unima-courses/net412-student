# Development and contributions

Student installation is in [README.md](README.md); lab use is in [LAB_GUIDE.md](LAB_GUIDE.md). Operational checks and bundle maintenance are in [MAINTAINERS.md](MAINTAINERS.md).

## Local development

Use Node.js 24 LTS, npm, Docker and the Compose plugin. Install the locked dependencies from the repository root:

```bash
npm ci
npm start
```

`npm start` builds the browser assets and runs the local Node API on `127.0.0.1:4174`. For interface development, leave it running and start Vite in a second terminal:

```bash
npm run dev
```

Open the Vite URL printed in that terminal. Requests under `/api` are proxied to the local Node server on port 4174. The normal browser build is written to `web-dist/`. Set `NET412_PORT` to change the Node port when needed; if developing with Vite, also update its API proxy to match.

Use the separate `net412-instructor` repository for the Django backend and its setup instructions. A deployed backend uses HTTPS; `http://127.0.0.1:8000` is accepted for a local backend. Configure the URL through **Instructor server settings**. Authenticated local requests and new terminal connections check account access with the instructor server, so a reachable backend is needed for integration work.

## Architecture and activity packs

The browser client serves the workbook locally. The Node process downloads assigned lab definitions, controls Docker, provides container terminals and exports work. The Django server owns authentication, assignments, task/build definitions, expected answers, submissions and grades.

Opening an activity downloads its Dockerfile, Compose file and supporting build context into `~/.net412-lab/packs/`. The client verifies the activity/version digest before using the bundle. **Start lab** builds the downloaded definition locally; it does not build the maintainer fixture in `lab/`.

The generic `compose` pack in `src/labs/compose.js` supports instructor-authored terminal activities with start/reset actions. L2 uses `src/labs/l2-arp.js` for setup, personal-challenge initialization, runtime MAC synchronization and PCAP export. Task text, actions and solution release come from the instructor specification. Neither pack should run an attack or start a traffic capture on the student's behalf.

Terminal sessions are independent Docker shells. Switching tabs or navigating within the client retains the shells, scrollback and running commands; browser reload persistence is not provided. Closing a session, signing out or resetting ends the corresponding connections.

## Workspace exports

`src/workspaces.js` copies Docker tar entries into an isolated temporary tree, with one folder per Compose/topology container, and then archives that tree. Temporary files and partial ZIPs are removed on success or failure. Files are streamed to disk; captures are not buffered in server memory. The download name is `<registration-number>_<activity-id>.zip` (unsafe filename characters become hyphens).

Exports work for created, running and stopped containers. When containers do not exist, the pack uses `docker compose create --build --no-recreate` to prepare initial workspaces without running the lab or replacing existing containers. This first preparation needs Docker and any uncached image downloads. The exporter checks the Compose working-directory label before copying to avoid exporting another student's containers. It enumerates all Compose services plus topology devices, including nonterminal devices. It exports `WorkingDir` (fallback `/work`) or `environment.work_directories` overrides; missing directories and `/` fail explicitly. Hidden/nested/binary files and empty directories are retained; links become `.link.txt` records. Save files and stop captures first.

## Activity caching and connectivity

The dashboard prefetches activities sequentially; a click shares any in-flight download. The workbook renders as soon as its verified definition is ready, with container status checked afterwards. Common and personalized bundles are cached on disk by instructor origin, student, activity, version and source digest, then verified when materialized. L2 downloads only its personalized bundle rather than also downloading the common copy. Session caches use the public specification digest so same-version edits and walkthrough releases invalidate them. Catalog metadata refreshes every 30 seconds while the page is visible. Cached workbooks can remain readable through a connection interruption; authentication and grading still require the instructor server.

Concurrent account checks share one request. Read-only local actions reuse a successful account check for up to five seconds; mutations and new terminals revalidate with the server. Thus reset/deactivation may take up to five seconds to reach cached local reads. Account changes, sign-out and server changes clear local session access. Activity-specific requests prevent prefetching another generic Compose pack from changing the current terminal/action target.

Due dates arrive as timezone-aware ISO timestamps. The interface disables submission fields at the deadline and polls for instructor changes. The instructor server independently rejects late submissions, including queued submissions that arrive late. Accepted submissions can be retried idempotently after a deadline without adding another attempt.

## Topology renderer

`src/topology/index.js` exports `topologyModel`, `layoutTopology` and `renderTopology`; styling lives in `src/topology/topology.css`. The renderer is independent of the workbook, authentication and Docker execution. It accepts an activity topology and returns escaped, accessible HTML with local SVG icons and no external assets or animation.

Each network is a compact dark LAN bar with attached device cards. Devices default above it; optional `placement: "bottom"` places a device below, and `emphasis: true` adds a maroon outline. L2 uses these hints for host_b. Supported icons are `host`, `server`, `router`, `switch` and `firewall`; unknown kinds use the host icon. Names, IPs and roles come from the specification. An optional authored `mac` is illustrative only; the renderer never fetches runtime MACs, flags or grading ground truth.

Multiple networks render as separate segments. A device belonging to several networks appears on each with a shared-device membership label. Unknown/unconnected memberships remain visible in an unconnected section. Legacy flat device arrays render on one LAN. Wide diagrams scroll inside their frame; narrow frames reflow into a vertical connection rail with full-width cards. Layout depends on container width.

## Theme and assets

The interface uses a course-local snapshot of **Teaching theme v1, 7 September 2026**. Its maroon/paper tokens and bundled Latin Modern fonts are adapted in `src/style.css`; font provenance and the GUST license are retained in `src/fonts/`. Keep assets local, preserve readable contrast, visible focus and responsive layouts, and refresh the theme snapshot deliberately.

## Contributing changes

Keep student setup in the README and lab usage in LAB_GUIDE; put implementation details here and operational procedures in MAINTAINERS. Edit source files and regenerate affected outputs rather than changing generated browser assets directly. Include corresponding client/backend changes when a pack or API contract changes.

Describe the problem, resulting behavior and checks performed when submitting a change through the course team's repository workflow. Do not include real student credentials, personal flags, grading ground truth, captured student traffic or exported work. Use disposable test accounts for integration checks.

Run the checks appropriate to your change from [MAINTAINERS.md](MAINTAINERS.md#validation). For UI changes, also verify the affected browser interactions, narrow layouts, keyboard focus and terminal persistence. Documentation-only changes need link/path and command review; they do not require rebuilding unchanged app assets.
