# NET412 student lab

Run your NET412 practical labs on your computer and use the workbook in your browser. Docker runs the lab machines, Node.js runs the local client, and Wireshark opens the packet captures you create. Your instructor's server provides your assigned activities and records your marks.

Start here:

1. Check [what you need](#before-you-start).
2. Follow the setup for [Windows](#windows-setup) or [Debian/Ubuntu Linux](#debianubuntu-setup).
3. [Download and start the client](#download-and-start-the-client).
4. [Sign in and complete your lab](#sign-in-and-start-an-activity).
5. [Download your work for submission](#save-and-submit-your-work).

## Before you start

You need:

- A 64-bit computer running a supported Windows release or Debian/Ubuntu with a graphical desktop. On Windows, check [Docker Desktop's current system requirements](https://docs.docker.com/desktop/setup/install/windows-install/#system-requirements), including hardware virtualization and WSL 2 support.
- At least 8 GB RAM; 16 GB is recommended. Allow approximately 50 GB of free disk space for Docker, images and saved work.
- Permission to install software. You may need an administrator or lab technician for the initial setup.
- Docker with the Compose plugin, Node.js **24 LTS** with npm, Wireshark, and a current browser. An existing supported Node.js 22 installation must be version 22.12 or newer.
- The client download link and instructor server URL supplied by your instructor, plus your registered email address and registration number.
- Internet access for software installation, npm dependencies and the first container build. Keep the instructor server reachable while using the client, including when opening terminals and submitting work.

Complete setup and start your assigned lab before the practical session if possible: the first build downloads additional software. You do not need to install the instructor backend, Python or the container's networking tools on your computer.

## Windows setup

Use **Windows PowerShell** for the commands in this section. The client and Wireshark run on Windows; Docker Desktop uses WSL 2 to run Linux containers. You do not need a second Docker installation inside Ubuntu/WSL.

### 1. Enable WSL 2

Open PowerShell **as Administrator**, then run:

```powershell
wsl --install
```

Restart your computer when requested. If Ubuntu opens for its first-time setup, complete its username/password prompts; these are separate from your NET412 account. If WSL is already installed, skip the installation command.

Update WSL and check it:

```powershell
wsl --update
wsl --version
wsl --list --verbose
```

A listed Linux distribution should show `VERSION 2`. If an existing Ubuntu installation shows version 1, run `wsl --set-version Ubuntu 2`, substituting its exact listed name. For installation problems, follow [Microsoft's WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install).

### 2. Install Docker Desktop

1. Download and run the [Docker Desktop for Windows installer](https://docs.docker.com/desktop/setup/install/windows-install/), choosing the installer for your computer's architecture.
2. Choose the **WSL 2** backend when offered. Restart if requested.
3. Open Docker Desktop and wait until its engine is running. In **Settings → General**, enable **Use the WSL 2 based engine** if the option is shown.
4. Use **Linux containers**. If the tray menu offers **Switch to Linux containers**, select it.

Keep Docker Desktop running whenever you use the lab. Open a new, ordinary PowerShell window and verify:

```powershell
docker version
docker compose version
docker info --format '{{.OSType}}'
docker run --rm hello-world
```

`docker version` should show both Client and Server, the OS type should be `linux`, and `hello-world` should print a success message. Compose must be available as `docker compose` with a space.

### 3. Install Node.js and npm

Download **Node.js 24 LTS → Windows Installer (.msi)** from the [official Node.js download page](https://nodejs.org/en/download). Choose the architecture matching your computer. Keep npm and the PATH option enabled in the installer; additional native build tools are not needed for this client.

Close and reopen PowerShell, then check:

```powershell
node --version
npm.cmd --version
```

The Node version should begin with `v24.`. These instructions use `npm.cmd` so PowerShell's script execution policy does not block `npm.ps1`.

### 4. Install Wireshark

Download the Windows installer from the [official Wireshark downloads](https://www.wireshark.org/download.html) and install the graphical application. The [Windows installation guide](https://www.wireshark.org/docs/wsug_html_chunked/ChBuildInstallWinInstall.html) explains the components; Npcap enables live capture on Windows, but is not required to read the saved PCAP files used in this lab.

Open Wireshark from the Start menu and check **Help → About Wireshark**. Packet capture will happen in a lab container, and you will open its downloaded PCAP in this Windows application.

Continue to [download and start the client](#download-and-start-the-client).

## Debian/Ubuntu setup

These steps are for a normal Debian or Ubuntu desktop installation, using a **Bash terminal**. Windows users following the Docker Desktop route above should continue with the Windows instructions.

### 1. Install Docker Engine and Compose

If Docker already works, try the verification commands below first and skip installation if they pass. If you have conflicting distribution packages such as `docker.io`, follow the removal guidance in the official [Ubuntu](https://docs.docker.com/engine/install/ubuntu/) or [Debian](https://docs.docker.com/engine/install/debian/) guide before installing Docker's packages.

Install the prerequisites:

```bash
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
```

**Ubuntu only:** add the Ubuntu Docker repository:

```bash
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
```

**Debian only:** add the Debian Docker repository instead:

```bash
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
```

**Both distributions:** install Docker and enable its service:

```bash
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

**Log out of your desktop session completely, then log back in.** This gives your account Docker access. Membership in the Docker group grants powerful administrative access; use your own authorized account. See [Docker's Linux post-installation guide](https://docs.docker.com/engine/install/linux-postinstall/).

In a new terminal, verify **without sudo**:

```bash
docker version
docker compose version
docker info --format '{{.OSType}}'
docker run --rm hello-world
```

Expect Client and Server details, a Compose version, OS type `linux`, and the hello-world success message. The client must be able to use Docker as your ordinary user.

### 2. Install Node.js and npm

Use Node.js **24 LTS**, available from the [official download page](https://nodejs.org/en/download). The following Bash route uses [nvm, a separate Node version manager](https://github.com/nvm-sh/nvm#installing-and-updating), to install it in your user account:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o /tmp/net412-nvm-install.sh
bash /tmp/net412-nvm-install.sh
```

Close and reopen your terminal so it loads nvm, then run:

```bash
nvm install 24
nvm alias default 24
nvm use 24
node --version
npm --version
```

Expect `v24.` for Node and a version number for npm. If `nvm` is not found in Bash, run `source ~/.bashrc` and retry. Run npm commands as your normal user.

### 3. Install Wireshark

```bash
sudo apt update
sudo apt install wireshark
```

If asked whether non-superusers should capture packets, choose **No** for this workflow. You will capture inside the containers and use desktop Wireshark to read the downloaded files, which needs no capture privileges. Open Wireshark from your application menu and check **Help → About Wireshark**. Run it as your normal user. See the [Wireshark Debian/Ubuntu installation guidance](https://www.wireshark.org/docs/wsug_html_chunked/ChBuildInstallUnixInstallBins.html).

## Download and start the client

Get the **student client** ZIP or repository link from your instructor. Extract the ZIP fully into a folder you own; do not run commands inside the archive viewer. If you use Git, clone the instructor-provided repository instead. The project folder must contain `package.json`, `package-lock.json` and `src/`.

Open a terminal **in that project folder**. For example, if you extracted it to the following location:

**Windows PowerShell:**

```powershell
cd "$HOME\Documents\NET412\net412-lab-client"
npm.cmd ci
npm.cmd start
```

**Debian/Ubuntu Bash:**

```bash
cd ~/NET412/net412-lab-client
npm ci
npm start
```

Adjust the `cd` path to your actual extracted folder. `npm ci` downloads the client's dependencies; run it once for a fresh copy and again when instructed after an update. `npm start` prepares the interface and starts the local client.

Leave that terminal open and open **http://127.0.0.1:4174** in your browser. Use the exact URL printed by the client if different. This local page runs on your computer; it is separate from the instructor server. Keep it local rather than opening it to your network.

For later sessions, start Docker, open a terminal in the same project folder, and run `npm.cmd start` on Windows or `npm start` on Linux.

## Sign in and start an activity

1. On the sign-in page, expand **Instructor server settings**, enter the **HTTPS URL supplied by your instructor**, and click **Save**. The default `http://127.0.0.1:8000` is for a backend running on the same computer; it is not your class server address unless your instructor says so.
2. Sign in with your **email address** as username and **registration number** as the initial password.
3. Change your password when prompted, entering your current password and the new password twice. Follow the displayed password rules. If your instructor resets your password, it returns to your registration number and you must change it again.
4. Select an assigned, released activity. Opening it downloads your material and initializes your personal challenge in the background.
5. Read the workbook, then click **Start lab**. Wait for **Running**. The first build may take several minutes. Required lab values are synchronized automatically with the instructor server.

Use one learner lab at a time on a computer. Download your work before switching activities or accounts. If no activities appear, check with your instructor that the activity has been assigned and released to you.

## Terminals and packet captures

Choose a container in **Container terminal**, then click **Open session**. You can open independent sessions on the same container, with tabs such as `host_b S1` and `host_b S2`. Follow the workbook to decide which container should run each command.

Sessions keep their running commands and scrollback when you switch tabs, visit Activities, and return to the workbook. Closing a session, signing out or resetting ends its connection. Avoid refreshing or closing the browser while working: terminal sessions do not persist across browser reloads.

Type the lab commands yourself. Captures start only when you run the capture command in a container terminal. Keep the capture in its own session and use another session for commands that generate traffic.

For L2:

1. Follow the workbook's capture instructions and save the capture at the specified path.
2. Stop the capture with **Ctrl+C** in its terminal before downloading it.
3. Click **Download host_b PCAP for Wireshark** when available.
4. In desktop Wireshark, use **File → Open** to open the downloaded `.pcap`. Follow the workbook to inspect the required request and response.

An empty list of local capture interfaces in desktop Wireshark does not prevent you from opening a PCAP. Clicking a download button does not start a capture.

## Save and submit your work

Enter your observations and personal `NET412{...}` flag under **Submit answers and flag**, then click **Submit task**. For L2.A, five questions earn **1 mark each** and the flag earns **5 marks**, for **10 marks total**. Your flag is specific to your account and task.

The **Automation record** shows question completion, marks, accepted/retry/unanswered feedback and attempts. Accepted answers remain credited across retries. Use its refresh button to fetch the latest progress. If a submission is queued after an error, restore connectivity and use **Sync pending**; confirm that the server has recorded your result.

For the separate Google Classroom submission:

1. Save any files open in container editors and stop captures with **Ctrl+C**.
2. Keep the lab running and click **Download work ZIP**.
3. Save `studentUsername-task.zip`, for example `student@example.edu-l2.a.zip`. Files are grouped by container name, such as `host_a/`, `host_b/` and `server_1/`; the ZIP includes all topology containers' work directories.
4. Open the ZIP to confirm your expected scripts and captures are present. Keep a backup on your computer.
5. Upload this ZIP to the Google Classroom assignment specified by your instructor. The client does **not** upload it for you.

**Download before using Reset lab.** Reset deletes the lab containers and their local files; marks already recorded by the instructor server remain saved. When finished, export your work, reset the lab, sign out, then stop the local client with **Ctrl+C** in the host terminal where you ran `npm start`.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `docker` is not found, or Compose is missing | Reopen your terminal after installation. On Windows, check Docker Desktop is installed. On Linux, check that `docker-ce-cli` and `docker-compose-plugin` are installed. |
| Cannot connect to Docker / no Server section in `docker version` | Start Docker Desktop on Windows. On Linux, run `sudo systemctl start docker`, then retry `docker version` without sudo. |
| Docker permission denied on Linux | Confirm you completed `sudo usermod -aG docker "$USER"`, then fully logged out and back in. Do not run the client with sudo. |
| Docker reports Windows containers | Switch Docker Desktop to Linux containers and retry the verification commands. |
| WSL reports virtualization errors | Enable hardware virtualization in BIOS/UEFI and restart; ask your technician if the setting is managed. Check the official WSL/Docker guides above. |
| `node` or `npm` is not found | Reopen the terminal. On Linux, check `nvm use 24`. On Windows, check the Node installer added Node to PATH. |
| PowerShell says `npm.ps1` cannot run | Use `npm.cmd ci` and `npm.cmd start` as shown above. |
| `npm ci` cannot find `package.json` or the lockfile | Change into the extracted project folder containing both files. |
| Dependency/build downloads fail | Check internet access and any campus proxy settings, then retry. Save the full error if it persists. |
| Browser cannot open the local page | Keep the `npm start` terminal open and check its printed URL. If port 4174 is already in use, stop your earlier client instance before restarting. |
| Sign-in, terminal access or submission fails | Check the instructor URL and server/network availability. After an instructor password reset, sign in with your registration number and change it. |
| Network creation reports “Pool overlaps” | Save any existing work. Another lab or Docker network may use the same subnet. Report the full error to your instructor; avoid deleting unrelated networks or running a global Docker prune. |
| PCAP download is missing or incomplete | Start the capture yourself, use the workbook's output path, generate traffic, then stop tcpdump before downloading. |
| ZIP download fails | Keep the current lab running, save files and stop captures, then retry. Include the error and container name when reporting it. |

When asking for help, include your OS, `node --version`, `docker version`, `docker compose version`, activity name, and the full error message. Never send your password or personal flag.

## Repository documentation

Students can complete the lab using this guide and the activity workbook. Repository work is documented separately:

- [Development and contributions](DEVELOPMENT.md)
- [Maintenance, validation and lab-pack operations](MAINTAINERS.md)

Installation guidance checked against the linked official documentation on 18 October 2026. Follow the upstream requirements if your operating system is newer than this guide.
