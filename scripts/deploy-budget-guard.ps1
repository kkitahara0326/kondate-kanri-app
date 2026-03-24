param(
  [string]$ProjectId = "shushi-kanri-app",
  [string]$Region = "asia-northeast1",
  [string]$Topic = "billing-budget-alerts",
  [string]$Threshold = "0.8"
)

$ErrorActionPreference = "Stop"

Write-Host "Deploying budget guard function..."

gcloud functions deploy budget-guard `
  --quiet `
  --gen2 `
  --runtime=nodejs20 `
  --region=$Region `
  --project=$ProjectId `
  --source="automation/budget-guard-function" `
  --entry-point=budgetGuard `
  --trigger-topic=$Topic `
  --set-env-vars="BUDGET_GUARD_THRESHOLD=$Threshold" `
  --memory=256Mi `
  --timeout=60s

if ($LASTEXITCODE -ne 0) {
  throw "gcloud functions deploy failed."
}

Write-Host "Done."
