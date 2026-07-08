# READ-ONLY calendar lookup for Meetily.
#
# Reads the default Outlook calendar (Classic Outlook, via COM) and returns the
# events overlapping an instant supplied through the MEETILY_QUERY_TIME
# environment variable (ISO-8601). Emits a JSON array of candidate events,
# ranked most-specific first (real meetings before all-day blocks, shorter
# before longer). Emits '[]' when nothing matches or on any error.
#
# This script performs NO writes. It only reads properties; it never calls
# Save, Send, Delete, Move, or any other mutating method on any Outlook object.

$ErrorActionPreference = 'Stop'
$GRACE_MINUTES = 5           # allow starting a recording a few minutes early/late

function Emit-Empty { Write-Output '[]'; exit 0 }

# Parse the query instant (accepts trailing 'Z' / offset) as local wall-clock time.
try {
    $q = [datetimeoffset]::Parse($env:MEETILY_QUERY_TIME).LocalDateTime
} catch { Emit-Empty }

function Split-Attendees([string]$s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return @() }
    return @($s -split ';' | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

# JSON string (quoted + escaped) for a scalar; ConvertTo-Json handles escaping.
function J([string]$s) { return ([string]$s | ConvertTo-Json -Compress) }

# JSON array string. Built by hand because Windows PowerShell's ConvertTo-Json
# serializes a 1-element array as a scalar and an empty array as '{}'.
function JArray($items) {
    $arr = @($items)
    if ($arr.Count -eq 0) { return '[]' }
    return '[' + (($arr | ForEach-Object { J $_ }) -join ',') + ']'
}

try {
    $ol    = New-Object -ComObject Outlook.Application
    $ns    = $ol.GetNamespace('MAPI')
    $cal   = $ns.GetDefaultFolder(9)         # olFolderCalendar
    $items = $cal.Items
    $items.IncludeRecurrences = $true
    $items.Sort('[Start]')

    # Restrict to a +/-24h window around the query instant so recurrences expand
    # and iteration stays fast. (.Count is unreliable with IncludeRecurrences, so
    # we always iterate rather than trust it.)
    $lo = $q.AddHours(-24)
    $hi = $q.AddHours(24)
    $filter = "[Start] >= '" + $lo.ToString('MM/dd/yyyy hh:mm tt') + "' AND [Start] <= '" + $hi.ToString('MM/dd/yyyy hh:mm tt') + "'"
    $restricted = $items.Restrict($filter)

    $grace = New-TimeSpan -Minutes $GRACE_MINUTES
    $cands = New-Object System.Collections.ArrayList
    foreach ($a in $restricted) {
        $s = $a.Start; $e = $a.End
        if ($q -ge $s.Add(-$grace) -and $q -le $e.Add($grace)) {
            if ($q -lt $s)     { $dist = ($s - $q).TotalSeconds }
            elseif ($q -gt $e) { $dist = ($q - $e).TotalSeconds }
            else               { $dist = 0 }
            [void]$cands.Add([pscustomobject]@{
                appt   = $a
                allDay = [bool]$a.AllDayEvent
                dur    = ($e - $s).TotalMinutes
                dist   = $dist
            })
        }
    }
    if ($cands.Count -eq 0) { Emit-Empty }

    # Rank: real meetings before all-day blocks, then tightest fit, then nearest.
    $sorted = $cands | Sort-Object `
        @{ Expression = { [int]$_.allDay } }, `
        @{ Expression = { $_.dur } }, `
        @{ Expression = { $_.dist } }

    # Build each candidate's JSON by hand so attendee arrays are always valid
    # JSON arrays regardless of count.
    $jsonItems = foreach ($c in $sorted) {
        $a = $c.appt
        $joinUrl = 'null'
        if ($a.Body) {
            $m = [regex]::Match($a.Body, 'https://[^\s>"'']*(teams\.microsoft\.com|zoom\.us|meet\.google\.com)[^\s>"'']*')
            if ($m.Success) { $joinUrl = J $m.Value }
        }
        '{' +
            '"subject":'    + (J $a.Subject) + ',' +
            '"start":'      + (J $a.Start.ToString('o')) + ',' +
            '"end":'        + (J $a.End.ToString('o')) + ',' +
            '"organizer":'  + (J $a.Organizer) + ',' +
            '"location":'   + (J $a.Location) + ',' +
            '"is_online":'  + ([bool]$a.IsOnlineMeeting).ToString().ToLower() + ',' +
            '"is_all_day":' + ([bool]$c.allDay).ToString().ToLower() + ',' +
            '"join_url":'   + $joinUrl + ',' +
            '"required":'   + (JArray (Split-Attendees ([string]$a.RequiredAttendees))) + ',' +
            '"optional":'   + (JArray (Split-Attendees ([string]$a.OptionalAttendees))) +
        '}'
    }
    # Join per-item JSON so a single candidate still yields a valid JSON array.
    '[' + ($jsonItems -join ',') + ']'
} catch {
    Emit-Empty
}
