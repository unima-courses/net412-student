# NET412 student lab

Run your NET412 practical labs on your computer and use the workbook in your browser. Docker runs the lab machines, Node.js runs the local client, and Wireshark opens the packet captures you create. Your instructor's server provides your assigned activities and records your marks.

Start here:

1. Check [what you need](#before-you-start).
2. Follow the setup for [Windows](#windows-setup) or [Debian/Ubuntu Linux](#debianubuntu-setup).
3. [Download and start the client](#download-and-start-the-client).
4. Continue with [Working with the lab](LAB_GUIDE.md) to sign in, use terminals, capture traffic and submit your work.

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

Setup is complete when the local sign-in page opens. Continue with [Working with the lab](LAB_GUIDE.md) for sign-in and activity instructions.

## Setup troubleshooting

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

For sign-in, activity, capture or submission problems, see [lab troubleshooting](LAB_GUIDE.md#lab-troubleshooting).

When asking for setup help, include your OS, `node --version`, `docker version`, `docker compose version`, activity name, and the full error message. Never send your password or personal flag.

## Repository documentation

After setup, use [Working with the lab](LAB_GUIDE.md) alongside the activity workbook. Repository work is documented separately:

- [Development and contributions](DEVELOPMENT.md)
- [Maintenance, validation and lab-pack operations](MAINTAINERS.md)

Installation guidance checked against the linked official documentation on 18 October 2026. Follow the upstream requirements if your operating system is newer than this guide.
