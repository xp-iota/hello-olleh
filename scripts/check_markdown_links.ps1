param(
  [string[]]$Roots = @("README.md", "docs", "pages")
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = New-Object System.Collections.Generic.List[string]
$linkPattern = [regex]"\[[^\]]+\]\(([^)]+)\)"

foreach ($root in $Roots) {
  $path = Join-Path $repoRoot $root
  if (-not (Test-Path -LiteralPath $path)) {
    $failures.Add("missing scan root: $root")
    continue
  }

  $files = if (Test-Path -LiteralPath $path -PathType Leaf) {
    @(Get-Item -LiteralPath $path)
  } else {
    @(Get-ChildItem -LiteralPath $path -Filter "*.md" -Recurse -File)
  }

  foreach ($file in $files) {
    $text = Get-Content -LiteralPath $file.FullName -Raw
    # Ignore fenced examples: TypeScript signatures often contain `[name](...)`.
    $text = [regex]::Replace($text, '(?s)```.*?```', '')
    foreach ($match in $linkPattern.Matches($text)) {
      $target = $match.Groups[1].Value.Trim()
      if ($target.StartsWith("http://") -or
          $target.StartsWith("https://") -or
          $target.StartsWith("mailto:") -or
          $target.StartsWith("#") -or
          $target.StartsWith("{{") -or
          $target.Contains("://")) {
        continue
      }

      $pathOnly = ($target -split "#", 2)[0]
      if ([string]::IsNullOrWhiteSpace($pathOnly)) {
        continue
      }

      $resolved = Join-Path $file.DirectoryName $pathOnly
      if (-not (Test-Path -LiteralPath $resolved)) {
        $relativeFile = Resolve-Path -LiteralPath $file.FullName -Relative
        $failures.Add("${relativeFile}: missing markdown link $target")
      }
    }
  }
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Output $_ }
  exit 1
}

Write-Host "All local markdown links resolved."
