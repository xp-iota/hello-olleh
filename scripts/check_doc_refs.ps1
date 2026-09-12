param(
  [string[]]$DocDirs = @(
    "hello-claude-code",
    "hello-codex",
    "hello-gemini-cli",
    "hello-opencode",
    "hello-harness"
  )
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]
$lineCountCache = @{}
$normalizedDocDirs = @(
  foreach ($docDir in $DocDirs) {
    $docDir -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  }
)

foreach ($docDir in $normalizedDocDirs) {
  $dir = Join-Path $repoRoot (Join-Path "docs" $docDir)
  if (-not (Test-Path -LiteralPath $dir)) {
    $failures.Add("missing doc directory: docs/$docDir")
    continue
  }

  Get-ChildItem -LiteralPath $dir -Filter "*.md" -Recurse | ForEach-Object {
    $doc = $_
    $text = Get-Content -LiteralPath $doc.FullName -Raw
    $matches = [regex]::Matches($text, 'sources/[^\s`),;、]+:\d+(?:-\d+)?')

    foreach ($match in $matches) {
      $value = $match.Value
      $splitAt = $value.LastIndexOf(":")
      $pathPart = $value.Substring(0, $splitAt)
      $lineText = $value.Substring($splitAt + 1)
      $lineParts = $lineText -split "-", 2
      $lineNumber = [int]$lineParts[0]
      $endLineNumber = if ($lineParts.Count -gt 1) { [int]$lineParts[1] } else { $lineNumber }
      $sourcePath = Join-Path $repoRoot ($pathPart -replace "/", [IO.Path]::DirectorySeparatorChar)

      if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        $relativeDoc = Resolve-Path -LiteralPath $doc.FullName -Relative
        $failures.Add("${relativeDoc}: missing source anchor $value")
        continue
      }

      if (-not $lineCountCache.ContainsKey($sourcePath)) {
        $lineCountCache[$sourcePath] = [System.IO.File]::ReadAllLines($sourcePath).Length
      }
      $lineCount = $lineCountCache[$sourcePath]
      if ($lineNumber -lt 1 -or $endLineNumber -lt $lineNumber -or $endLineNumber -gt $lineCount) {
        $relativeDoc = Resolve-Path -LiteralPath $doc.FullName -Relative
        $failures.Add("${relativeDoc}: line range $lineText outside $pathPart ($lineCount lines)")
      }
    }
  }
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Output $_ }
  exit 1
}

Write-Host "All source anchors resolved."
