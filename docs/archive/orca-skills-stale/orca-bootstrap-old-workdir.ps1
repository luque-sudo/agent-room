param(
    [string]$Model = "claude-haiku-4-5-20251001",
    [string]$Role = "worker",
    [string]$OrchestratorHandle = "",
    [string]$WorkDir = "C:\Users\ricar\Desk\Orca\Test Project for Orca"
)

$ORCA = 'C:\Users\ricar\AppData\Local\Programs\Orca\bin\orca.cmd'

# Step 1: Get orchestrator handle if not provided
if (-not $OrchestratorHandle) {
    $terminals = (& $ORCA terminal list --json | ConvertFrom-Json).result.terminals
    Write-Host "`nAvailable terminals:"
    $terminals | ForEach-Object { Write-Host "  $($_.handle) — $($_.title)" }
    $OrchestratorHandle = Read-Host "`nEnter orchestrator terminal handle"
}

# Step 2: Create new terminal for the agent
$created = & $ORCA terminal create --json | ConvertFrom-Json
$agentHandle = $created.result.terminal.handle
Write-Host "`n[+] Agent terminal created: $agentHandle"

# Step 3: Launch Claude model
& $ORCA terminal send --terminal $agentHandle --text "claude --model $Model" --enter --json | Out-Null
Write-Host "[+] Launched $Model"
Start-Sleep -Seconds 5

# Step 4: Send context briefing
$brief = @"
you are a $Role agent in a Claude multi-agent pipeline running on Orca ADE.
CONTEXT:
(1) ORCA CLI: $ORCA
(2) ORCHESTRATOR handle: $OrchestratorHandle
(3) YOUR handle: $agentHandle
(4) WORKING DIR: $WorkDir
(5) TO REPORT BACK: & '$ORCA' terminal send --terminal $OrchestratorHandle --text 'your message' --enter
(6) ROLE: receive tasks, execute them, report back when done.
Acknowledge by messaging the orchestrator now.
"@

& $ORCA terminal send --terminal $agentHandle --text $brief --enter --json | Out-Null
Write-Host "[+] Context briefed to agent"

# Output handles for orchestrator to use
Write-Host "`n=== AGENT READY ==="
Write-Host "Model:               $Model"
Write-Host "Role:                $Role"
Write-Host "Agent handle:        $agentHandle"
Write-Host "Orchestrator handle: $OrchestratorHandle"
