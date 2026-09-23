# NET412 Lab desktop client

Installed local client for NET412 2026. Electron supplies a native window, xterm.js a container shell, and DaisyUI the `corporate` light and `dark` themes. The lab containers, packet captures and code run on the student's Windows or Ubuntu computer; the configurable Django instructor server stores tasks and progress. The first complete pack is L2 ARP poisoning.

## Student machine requirements

- Windows 10/11 with Docker Desktop running **Linux containers** through WSL 2, or Ubuntu with Docker Engine and Compose v2. The student OS account must be able to use Docker. Enabling virtualization/WSL and installing Docker may require administrator or sudo rights; this is machine setup, not a step inside the app.
- 8–16 GB RAM and approximately 50 GB free disk. The L2 image measured about 127 MB; allow additional space for Docker Desktop/WSL, images and exported PCAPs. Pre-pull/build the pack before a one-hour session.
- Reachable instructor server over HTTPS. `http://127.0.0.1:8000` is accepted for local development. Wireshark is optional and opens exported PCAPs outside the client.

The client runs no host-network or privileged containers. It does need Docker access, which is equivalent to powerful local machine access; lab PCs should use appropriate student OS accounts. Do not run two learner sessions simultaneously under one OS account. Reset removes the lab's own containers and network, and preserves saved submissions on the instructor server.

## Build and run from source

Node.js 22+ and npm are needed to build the app, not for students using a packaged binary. From this folder:

```bash
npm ci
npx install-electron
npm run build
npm start
```

For browser-only development, run `npm run start:web` and open `http://127.0.0.1:4174`. The default instructor URL is `http://127.0.0.1:8000`; set the lab's HTTPS URL under **Instructor server settings** before signing in. The local server listens only on loopback.

Build a Linux AppImage with `npm run dist:linux` or a portable Windows ZIP with `npm run dist:win`. For a Windows NSIS installer, run `npm run dist:win-installer` on Windows, or on a Linux packaging host with Wine available. Outputs go in `release/`. On Ubuntu, make the AppImage executable and launch it; on Windows, extract the ZIP and run `NET412 Lab.exe`. Docker must already be installed and running.

## Learner flow

Sign in, open a published activity, start the lab, then use the workbook actions and victim/attacker/service terminal. Baseline measures the genuine mapping. In the attacker terminal, edit the two TODO values in `/work/poison_student.py` with `vi`. The bounded ARP action runs that scaffold, captures traffic at the attacker and makes the victim request the service; export the PCAP before reset if you want to inspect it in Wireshark. Session B starts from a reset baseline, applies a permanent neighbour entry only inside the victim container, and compares the supplied ICMP evidence. The answer form sends concise observations, the completed source and explanations for provisional checks; the instructor assigns final marks. Unsent submissions stay queued in the OS user data folder and can be retried with **Sync pending**.

The source topology is in `lab/`. The Docker image needs network access for its first build; after pre-staging the built image, activities run without fetching lab assets. Terminal access is deliberately limited to the three disposable containers. Stop a running command with Ctrl+C, and use **Reset lab** to remove the environment.

## Maintainer checks

```bash
npm run build
docker compose -f lab/compose.yaml config --quiet
node scripts/smoke-lab.mjs
npm audit
```

The smoke script builds, exercises, and removes only the `net412l2` test topology. Check that no other learner is using that project name before running it. L2 uses a reusable pack interface in `src/labs/l2-arp.js`; the task text, actions and solution release are controlled by the instructor server spec.
