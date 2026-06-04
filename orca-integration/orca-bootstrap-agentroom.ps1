# orca-bootstrap-agentroom.ps1
# Spawns a Claude agent and briefs it for BOTH Orca orchestration AND AgentRoom MCP.
# This is the merged bootstrap — the connection between the two sibling systems.
#
# Usage:
#   & .\orca-bootstrap-agentroom.ps1 -OrchestratorHandle <handle>
#   & .\orca-bootstrap-agentroom.ps1 -OrchestratorHandle <handle> -Model claude-haiku-4-5-20251001 -Channel backend -Role worker

param(
    [string]$Model              = "claude-haiku-4-5-20251001",
    [string]$Role               = "worker",
    [string]$OrchestratorHandle = "",
    [string]$Channel            = "general",
    [string]$AgentName          = "",
    [string]$WorkDir            = "C:\Users\ricar\Desk\Orca\agentroom"
)

$ORCA     = 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd'
$EnvFile  = Join-Path $WorkDir ".env"
$McpUrl   = "http://localhost:3002/mcp"
$WsUrl    = "ws://localhost:3001"
$ApiUrl   = "http://localhost:3000"

# ── Read AGENT_TOKEN from .env ──────────────────────────────────────────────
$AgentToken = ""
if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^AGENT_TOKEN=(.+)$') { $AgentToken = $Matches[1].Trim() }
    }
}
if (-not $AgentToken) {
    Write-Warning "[!] AGENT_TOKEN not found in .env. Run 'pnpm setup' first to provision one."
    Write-Warning "    Agent will be spawned without AgentRoom credentials — MCP auth will fail."
}

# ── Resolve agent name ──────────────────────────────────────────────────────
if (-not $AgentName) {
    $AgentName = "$Role-$(Get-Random -Maximum 9999)"
}

# ── Step 1: Discover orchestrator handle ────────────────────────────────────
if (-not $OrchestratorHandle) {
    $terminals = (& $ORCA terminal list --json | ConvertFrom-Json).result.terminals
    Write-Host "`nAvailable terminals:"
    $terminals | ForEach-Object { Write-Host "  $($_.handle) — $($_.title)" }
    $OrchestratorHandle = Read-Host "`nEnter orchestrator terminal handle"
}

# ── Step 2: Spawn agent terminal ─────────────────────────────────────────────
$created     = & $ORCA terminal create --json | ConvertFrom-Json
$AgentHandle = $created.result.terminal.handle
Write-Host "`n[+] Agent terminal: $AgentHandle"

# ── Step 3: Launch Claude ────────────────────────────────────────────────────
& $ORCA terminal send --terminal $AgentHandle --text "claude --model $Model" --enter --json | Out-Null
Write-Host "[+] Launched $Model"
Start-Sleep -Seconds 5

# ── Step 4: Write context briefing to temp file (avoids 3KB PTY limit) ──────
# Writing to file because the full briefing exceeds 3KB and double-quotes are
# stripped by the PTY. See edge-test-findings.md T1 and T2.
$BriefPath = Join-Path $env:TEMP "agentroom-brief-$AgentHandle.md"

$Brief = @"
# Agent Briefing — $Role

## Orca Context
- ORCA CLI: $ORCA
- YOUR handle: $AgentHandle
- ORCHESTRATOR handle: $OrchestratorHandle
- WORKING DIR: $WorkDir
- REPORT BACK via Orca: ``& '$ORCA' orchestration send --to $OrchestratorHandle --from $AgentHandle --subject 'RESULT' --body 'your result'``

## AgentRoom MCP Context
- MCP endpoint: $McpUrl
- Agent token: $AgentToken
- Assigned channel: #$Channel
- Agent name: $AgentName
- WS server: $WsUrl
- API server: $ApiUrl

## Init Sequence (run in this order)

### Step 1 — Orca handles (already done — you have them above)
Acknowledge receipt to orchestrator:
``& '$ORCA' orchestration send --to $OrchestratorHandle --from $AgentHandle --subject 'READY' --body '$AgentName online'``

### Step 2 — AgentRoom MCP auth
Use the MCP tool: authenticate with token ``$AgentToken``

### Step 3 — Join channel
Use the MCP tool: connect_service to channel ``$Channel``

### Step 4 — Wait for tasks
Use the MCP tool: wait_for_mention
You are now addressable as @$AgentName in #$Channel

## Post-Compaction Resume
If context compacts: call get_context first, then get_unread, then read any files they reference.

## Role: $Role
Receive tasks via @$AgentName mention in #$Channel or via Orca orchestration send.
When done, post to #$Channel: ``[$AgentName][task-id] COMPLETE — see path/to/output.md``
Then resume wait_for_mention.
"@

Set-Content -Path $BriefPath -Value $Brief -Encoding UTF8
Write-Host "[+] Brief written to: $BriefPath"

# ── Step 5: Inject briefing path (short message, stays under 3KB) ────────────
$WakePrompt = "Read your full briefing at $BriefPath and follow the init sequence exactly."
& $ORCA terminal send --terminal $AgentHandle --text $WakePrompt --enter --json | Out-Null
Write-Host "[+] Agent briefed"

# ── Output summary ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== AGENT READY ==="
Write-Host "Model:               $Model"
Write-Host "Role:                $Role"
Write-Host "Agent name:          $AgentName"
Write-Host "Channel:             #$Channel"
Write-Host "Agent handle:        $AgentHandle"
Write-Host "Orchestrator handle: $OrchestratorHandle"
Write-Host "AgentRoom token:     $(if ($AgentToken) { $AgentToken.Substring(0, [Math]::Min(8,$AgentToken.Length)) + '...' } else { 'MISSING — run pnpm setup' })"
Write-Host "Brief file:          $BriefPath"
