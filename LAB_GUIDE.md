# Working with the NET412 lab

This guide covers using the student lab client after installation: signing in, starting an activity, working in container terminals, capturing traffic, and submitting answers and files. Complete the [setup guide](README.md) first. Follow your activity workbook for the actual lab tasks and commands.

## Open the app

Start Docker Desktop on Windows, or ensure Docker Engine is running on Linux. In a terminal in your client project folder, run `npm.cmd start` on Windows or `npm start` on Linux. Leave that terminal open and visit **http://127.0.0.1:4174**, or the URL printed by the client.

Keep the instructor server reachable while working, including when opening terminals and submitting answers.

- [Sign in and start an activity](#sign-in-and-start-an-activity)
- [Terminals and packet captures](#terminals-and-packet-captures)
- [Save and submit your work](#save-and-submit-your-work)
- [Lab troubleshooting](#lab-troubleshooting)

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

## Lab troubleshooting

| Problem | What to check |
| --- | --- |
| Sign-in, terminal access or submission fails | Check the instructor URL and server/network availability. After an instructor password reset, sign in with your registration number and change it. |
| Network creation reports “Pool overlaps” | Save any existing work. Another lab or Docker network may use the same subnet. Report the full error to your instructor; avoid deleting unrelated networks or running a global Docker prune. |
| PCAP download is missing or incomplete | Start the capture yourself, use the workbook's output path, generate traffic, then stop tcpdump before downloading. |
| ZIP download fails | Keep the current lab running, save files and stop captures, then retry. Include the error and container name when reporting it. |

For Docker, Node.js, Wireshark installation or local client startup problems, see [setup troubleshooting](README.md#setup-troubleshooting).

When asking for help, include your OS, activity name, the full error message and the step you were performing. Never send your password or personal flag.
