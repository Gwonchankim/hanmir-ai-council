# Windows isolation profiles

AI Council launches prompt-influenced Claude and Codex processes. Isolation is therefore layered: CLI read-only/tool restrictions, a sanitized child environment, a verified non-elevated Windows token, and—when needed—a separately provisioned account or OS boundary.

## Profile 1: standard-user (default local MVP)

Run from a normal, non-elevated Windows terminal:

```powershell
npm run start:safe
```

동일한 launcher를 직접 실행해야 할 때는 `& '.\scripts\start-low-privilege.ps1'`을 사용합니다.

The launcher refuses High/System integrity tokens, non-loopback binding, UNC/network projects, an unwritable checkpoint directory, missing Node 20+, or missing Claude/Codex executables. It clears Node preload/debug hooks and starts only on `127.0.0.1`.

This is a useful guard against accidentally running model CLIs as Administrator. It is **not** a separate-user security boundary: the child processes retain every file permission of the signed-in user.

Audit without starting the server:

```powershell
npm run isolation:check
```

## Profile 2: dedicated-user (stronger local boundary)

Use an existing local account that is not a member of Administrators. Give that account only the project/checkpoint directories it actually needs, and authenticate Claude and Codex inside that account's own profile. Then launch:

```powershell
& '.\scripts\start-dedicated-user.ps1' -User '.\ai-council-worker' -ProjectPath 'C:\AI-Council'
```

The script prompts interactively for the existing account password, loads that profile, and re-runs the fail-closed preflight under the target identity. It never creates accounts, changes group membership, changes ACLs, or writes a password to disk. The target process is rejected if its identity differs from the requested user, it has a High/System token, or it belongs to Administrators.

A project stored below another user's profile (for example, that user's Desktop) will normally be unsuitable. Place a copy in a deliberately provisioned local directory. Do not broadly grant access to the original user profile.

## Profile 3: Windows Sandbox or VM (strong OS boundary)

Windows Sandbox and a VM are external security boundaries, not modes that a Node child process can truthfully attest or enable. `--profile sandbox-vm` therefore fails locally with `EXTERNAL_BOUNDARY_REQUIRED` instead of presenting a false guarantee.

Use a Sandbox/VM when untrusted artifacts or future file-writing agents are in scope. Provision Node and both CLIs inside the guest; authenticate inside the guest; expose only the minimum working/checkpoint directory; keep the web server bound to guest loopback; and use an explicit export directory for completed artifacts. Network access remains necessary for hosted models, so guest egress controls and account scoping still matter. Enabling Windows Sandbox, creating a VM, or changing host sharing/ACL policy is an administrator-controlled operation and is intentionally outside these launchers.

## What every profile still relies on

- Claude runs without tools, slash commands, MCP, or Chrome.
- Codex receives `sandbox_mode="read-only"`, ignores user config/rules, and runs in the isolated agent workspace.
- Child environments are allowlisted; unrelated API keys, PATs, connector secrets, and `NODE_OPTIONS` do not cross the process boundary.
- Prompts go through stdin with no shell, output is bounded, and cancellation terminates the process tree.

The standard-user launcher is the practical default for today's text-only MVP. The dedicated-user profile is the recommended next boundary before file-writing execution is enabled; a VM is the right boundary for hostile inputs or materially sensitive host data.
