$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RawDir = Join-Path $RootDir "raw"
$OutFile = Join-Path $RootDir "songs.json"

$SourceUrl = "https://p.eagate.573.jp/game/bpl/season5/sdvx/about/music/final/list/index.html"

$Inputs = @(
  @{ File = "notes.txt"; Genre = "notes" },
  @{ File = "peak.txt"; Genre = "peak" },
  @{ File = "one-hand.txt"; Genre = "one-hand" },
  @{ File = "tsumami.txt"; Genre = "tsumami" },
  @{ File = "hand-trip.txt"; Genre = "hand-trip" },
  @{ File = "tricky.txt"; Genre = "tricky" },
  @{ File = "namco.txt"; Genre = "namco" },

  # ジャンルではなく、重複可能なフラグ
  @{ File = "popular.txt"; Popular = $true },
  @{ File = "special.txt"; Special = $true }
)

$LevelRegex = "^(17(\.0|\.5)?|18\.[0-9]|17|18)$"
$Culture = [System.Globalization.CultureInfo]::InvariantCulture

function Is-TargetLevel {
  param(
    [double]$LevelRaw
  )

  return ($LevelRaw -ge 17.0 -and $LevelRaw -lt 19.0)
}

function Normalize-Title {
  param(
    [string]$Title
  )

  return $Title `
    -replace "\s+", " " `
    -replace "[“”]", '"' `
    -replace "[’]", "'" `
    .Trim()
}

function Clean-Line {
  param(
    [string]$Line
  )

  return $Line `
    -replace "`r", "" `
    -replace "^\s*[・●]\s*", "" `
    -replace "^\s*[-–—]\s*", "" `
    .Trim()
}

function Parse-Level {
  param(
    [string]$Value
  )

  $Text = (Clean-Line $Value) -replace "^\*\s*", ""
  $Text = $Text.Trim()

  if($Text -match $script:LevelRegex){
    return [double]::Parse($Text, $script:Culture)
  }

  return $null
}

function Is-Noise {
  param(
    [string]$Line
  )

  $Text = Clean-Line $Line

  if([string]::IsNullOrWhiteSpace($Text)){
    return $true
  }

  $Upper = $Text.ToUpperInvariant()

  $NoiseUpper = @(
    "NOTES",
    "PEAK",
    "ONE-HAND",
    "TSUMAMI",
    "HAND-TRIP",
    "TRICKY",
    "NAMCO",
    "POPULAR",
    "SPECIAL",
    "FREE",
    "SOUND VOLTEX",
    "課題曲",
    "課題曲（決勝トーナメント）",
    "レギュラーステージ",
    "決勝トーナメント",
    "シングルバトル･タッグバトル",
    "メガミックスバトル",
    "曲名",
    "レベル",
    "LEVEL"
  )

  $NoiseText = @(
    "本戦課題曲",
    "トップ",
    "ニュース一覧",
    "大会について",
    "大会スケジュール",
    "ドラフト会議"
  )

  return (($NoiseUpper -contains $Upper) -or ($NoiseText -contains $Text))
}

function Parse-Text {
  param(
    [string]$Text
  )

  $Records = @()
  $PendingTitle = $null

  $Lines = $Text -split "`n"

  foreach($RawLine in $Lines){
    $Line = Clean-Line $RawLine

    if(Is-Noise $Line){
      continue
    }

    $RowRegex = "^(.+?)\s+(17(\.0|\.5)?|18\.[0-9]|17|18)$"

    if($Line -match $RowRegex){
      $Title = Normalize-Title $Matches[1]
      $LevelRaw = [double]::Parse($Matches[2], $script:Culture)

      if(Is-TargetLevel $LevelRaw){
        $Records += [pscustomobject]@{
          Title = $Title
          LevelRaw = $LevelRaw
        }
      }

      $PendingTitle = $null
      continue
    }

    $ParsedLevel = Parse-Level $Line

    if($null -ne $ParsedLevel){
      if($null -ne $PendingTitle -and (Is-TargetLevel $ParsedLevel)){
        $Records += [pscustomobject]@{
          Title = Normalize-Title $PendingTitle
          LevelRaw = $ParsedLevel
        }
      }

      $PendingTitle = $null
      continue
    }

    $PendingTitle = $Line
  }

  return $Records
}

function Add-Record {
  param(
    [hashtable]$Map,
    [pscustomobject]$Record,
    [hashtable]$Source
  )

  if(-not (Is-TargetLevel $Record.LevelRaw)){
    return
  }

  $NormalizedTitle = Normalize-Title $Record.Title
  $LevelText = $Record.LevelRaw.ToString("0.0", $script:Culture)
  $Key = "$NormalizedTitle@@$LevelText"

  if(-not $Map.ContainsKey($Key)){
    $Map[$Key] = [pscustomobject]@{
      Id = 0
      Title = $NormalizedTitle
      Genres = @()
      Popular = $false
      Special = $false
      LevelRaw = $Record.LevelRaw
      Url = $script:SourceUrl
    }
  }

  $Song = $Map[$Key]

  if($Source.ContainsKey("Genre")){
    if(-not ($Song.Genres -contains $Source.Genre)){
      $Song.Genres += $Source.Genre
    }
  }

  if($Source.ContainsKey("Popular") -and $Source.Popular){
    $Song.Popular = $true
  }

  if($Source.ContainsKey("Special") -and $Source.Special){
    $Song.Special = $true
  }
}

if(-not (Test-Path $RawDir)){
  New-Item -ItemType Directory -Path $RawDir | Out-Null
}

$SongMap = @{}
$TotalRecords = 0

foreach($Source in $Inputs){
  $FilePath = Join-Path $RawDir $Source.File

  if(-not (Test-Path $FilePath)){
    New-Item -ItemType File -Path $FilePath | Out-Null
    Write-Host "作成しました: raw/$($Source.File)"
    continue
  }

  $Text = Get-Content -Path $FilePath -Raw -Encoding UTF8
  $Records = Parse-Text $Text

  $TotalRecords += $Records.Count

  Write-Host "$($Source.File): $($Records.Count)件"

  foreach($Record in $Records){
    Add-Record -Map $SongMap -Record $Record -Source $Source
  }
}

if($TotalRecords -eq 0){
  Write-Host ""
  Write-Host "raw/*.txt が空です。songs.json は更新しませんでした。"
  Write-Host "BPLサイトや本戦課題曲リストからテキストを貼り付けて、もう一度実行してください。"
  exit
}

$SortedSongs = $SongMap.Values | Sort-Object LevelRaw, Title

$Result = @()
$Id = 1

foreach($Song in $SortedSongs){
  $Result += [ordered]@{
    id = $Id
    title = $Song.Title
    genres = @($Song.Genres)
    popular = [bool]$Song.Popular
    special = [bool]$Song.Special
    levelRaw = [double]$Song.LevelRaw
    url = $Song.Url
  }

  $Id++
}

$Json = $Result | ConvertTo-Json -Depth 10

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutFile, $Json, $Utf8NoBom)

Write-Host ""
Write-Host "songs.json を作成しました: $($Result.Count)件"