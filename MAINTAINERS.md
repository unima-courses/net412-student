# Maintenance and lab-pack operations

Student installation is in [README.md](README.md); lab use is in [LAB_GUIDE.md](LAB_GUIDE.md). Source architecture, local development and contributions are in [DEVELOPMENT.md](DEVELOPMENT.md). Instructor-server administration and activity authoring are documented in the separate `net412-instructor` repository.

## Validation

From the client repository root, with the locked dependencies installed:

```bash
npm run build
npm test
docker compose -f lab/compose.yaml config --quiet
node scripts/smoke-lab.mjs
npm audit
```

The build checks browser compilation; the automated tests cover the client and pack helpers. Compose validation checks the local fixture. The smoke script builds, exercises and removes a disposable Docker lab, so Docker must be running and its first build requires network access. Review dependency audit findings before choosing an update; avoid applying breaking upgrades blindly.

The smoke project is named `net412-smoke-<pid>` and uses subnet `10.77.212.0/24`, leaving the standard learner subnet alone. Set `NET412_TEST_SUBNET` to an available, non-overlapping `10.77.N` three-octet prefix, for example `10.77.213` (not CIDR notation), if necessary. `lab/` is the direct smoke-test fixture; students run the verified instructor bundle instead. Keep the fixture and corresponding instructor-authored bundle behavior consistent when changing pack implementation.

`scripts/browser-smoke.mjs` is an additional integration check requiring a running client, an instructor server, a disposable assigned student account and a Chromium-compatible browser. It reads `NET412_BROWSER_USER`, `NET412_BROWSER_PASSWORD`, optional `NET412_BROWSER_URL` (default `http://127.0.0.1:4174`) and `CHROME_BIN` (default `google-chrome`). Supply credentials through the environment rather than committing them. Inspect the script before running: it starts and exercises a lab, creates test files and writes diagnostic screenshots. Its remote-debugging port is 9223. It refuses to reuse an already-running lab unless `NET412_REUSE_RUNNING=1` is explicitly set; do not point it at a student's active work.

## Learner environments and Docker networks

Learner L2 bundles share the stable Compose project `net412l2` on the standard `10.77.12.0/24` subnet. Content and personal-flag changes reuse the fixed-subnet network. **Start lab** recreates containers whose bundle configuration changed. Containers from another bundle are reported as stopped until the current bundle is started.

Only one learner lab should run per machine. Export work and captures before switching bundles or students. **Reset lab** removes the lab's containers and network, including container-local work, while preserving submissions already stored on the instructor server.

`NET412_L2_PROJECT` is reserved for isolated maintainer tests using a different subnet; merely changing the Compose project name does not avoid a subnet collision. For a “Pool overlaps” failure, inspect the relevant Docker networks and their owners, preserve existing work, and remove only a confirmed obsolete lab through its own reset/Compose cleanup. Do not prescribe global network deletion or Docker pruning as student troubleshooting.

The client binds to loopback. Containers do not use host networking or privileged mode, and terminal targets are limited to the current lab's disposable containers. Docker access nevertheless grants powerful local machine access; provision appropriate OS accounts and keep the client off public interfaces.

## Initialization, assessment and synchronization

L2.A initializes each student's personal challenge when the activity is opened, before build. Starting the lab synchronizes actual container MAC addresses with the instructor server. Reopening a running lab and submitting answers refresh this ground truth in the background.

The server marks five observation questions at one mark each and the personal flag at five marks, for ten marks total. Correct answers accumulate across attempts without duplicate credit. The Automation record shows question and mark progress, per-question feedback and attempt counts. Pending submissions can be retried after connectivity is restored; initialization, runtime synchronization, authenticated local requests and new terminal connections require a reachable instructor server.

The intended L2 discovery workflow is deliberate capture of the request and response, followed by Wireshark analysis. host_a and host_b receive different responses. The flag uses the request comment fragment followed by the response comment fragment from host_a's TCP stream. The workbook guides poisoning host_a first; learners independently adapt the technique to poison server_1. Keep this practice step unsolved in student guidance.

Because students administer their own Docker environment, personalized flags and captures do not make the local environment tamper-proof or prove that a student used Wireshark. Keep grading ground truth on the server and avoid exposing it through UI/topology data. Do not publish real student flags or captures in issue reports.

## Account lifecycle

Students sign in with their email address as username and registration number as initial password. The instructor server requires a password change before activities are accessible. An instructor reset restores the registration-number password and requires a change again. Changes and resets revoke earlier tokens. Verify account access against the instructor server for protected local requests and new terminal connections.

## Work export support

**Download work ZIP** exports every topology container's work directory under its container name. The lab must be running. Students should save files and stop captures first, verify the archive, and submit it separately through Google Classroom before resetting.

The exporter includes hidden/nested files, binary data and empty folders. Symlinks become `.link.txt` records. It uses each Docker `WorkingDir` (fallback `/work`) or the authored `environment.work_directories` mapping, rejects `/`, and errors on missing work directories. Temporary ZIPs are deleted after download. See [workspace implementation details](DEVELOPMENT.md#workspace-exports).

## Documentation upkeep

Keep the README focused on student setup, including both Windows and Debian/Ubuntu routes. Keep sign-in, terminals, captures, submissions and lab troubleshooting in LAB_GUIDE. Recheck upstream installation instructions when changing supported versions; use official Docker, Microsoft, Node.js and Wireshark documentation and the nvm project's own installation instructions. Record the actual verification date.

Preserve local theme provenance and licenses as described in [DEVELOPMENT.md](DEVELOPMENT.md#theme-and-assets). While the app remains undeployed, activity content stays at **v1** as requested by the course owner; do not create new versions merely for these refinements. Any cleanup of duplicate backend definitions must preserve valid assignments and submissions and be handled in the instructor repository.
