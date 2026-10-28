#Requires -Version 5.1
<#
  scripts/topmost.ps1 — 把 dsh 桌面客户端窗口提到「所有应用之上」，或恢复原状。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/topmost.ps1 -ProcessId <pid> -Action topmost
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/topmost.ps1 -ProcessId <pid> -Action restore
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/topmost.ps1 -ProcessId <pid> -Action topmost -Duration 8000

  参数：
    -ProcessId  dsh 桌面客户端主进程 PID（插件 Host 侧传 process.ppid）
    -Action     topmost = 置顶；restore = 取消置顶；restore 之外的别名 none
    -Duration   >0 时，置顶后等待指定毫秒再自动恢复（一次性"临时置顶"）

  输出：stdout 一行 JSON，例如
    {"ok":true,"action":"topmost","windows":1,"handles":[12345],"applied":true}
#>
param(
  [int]$ProcessId = 0,
  [string]$Action = 'topmost',
  [int]$Duration = 0,
  [string]$TitleContains = ''
)

$ErrorActionPreference = 'Stop'

$src = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class DshTopmost
{
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);

  public const int GWL_EXSTYLE = -20;
  public const uint WS_EX_TOPMOST = 0x00000008;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public const int SW_RESTORE = 9;
  public const int SW_SHOWNOACTIVATE = 4;

  public static IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static IntPtr HWND_NOTOPMOST = new IntPtr(-2);

  public static List<IntPtr> FindByPid(uint target)
  {
    var list = new List<IntPtr>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      uint pid = 0;
      GetWindowThreadProcessId(h, out pid);
      if (pid == target && IsWindowVisible(h) && GetWindowTextLength(h) > 0) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static string TitleOf(IntPtr h)
  {
    int len = GetWindowTextLength(h);
    if (len <= 0) return "";
    var sb = new StringBuilder(len + 1);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static List<IntPtr> FindByTitle(string needle)
  {
    var list = new List<IntPtr>();
    if (string.IsNullOrEmpty(needle)) return list;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (IsWindowVisible(h)) {
        string t = TitleOf(h);
        if (t.Length > 0 && t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) list.Add(h);
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static bool IsTopmost(IntPtr h)
  {
    IntPtr ex = GetWindowLongPtr(h, GWL_EXSTYLE);
    return ((ulong)ex.ToInt64() & (ulong)WS_EX_TOPMOST) != 0;
  }

  public static void Apply(IntPtr h, bool topmost)
  {
    if (topmost) {
      if (IsIconic(h)) ShowWindow(h, SW_RESTORE);
      // 不抢焦点：NOACTIVATE，只是把窗口层级抬到最上层
      SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    } else {
      SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
  }
}
'@

try { Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop }
catch { '{"ok":false,"error":"Add-Type failed: ' + ($_.Exception.Message -replace '"', "'") + '"}'; exit 1 }

if ($ProcessId -le 0 -and [string]::IsNullOrWhiteSpace($TitleContains)) {
  '{"ok":false,"error":"ProcessId or TitleContains required"}'
  exit 1
}

$handles = @()
if ($ProcessId -gt 0) { $handles = [DshTopmost]::FindByPid([uint32]$ProcessId) }
if (($handles.Count -eq 0) -and -not [string]::IsNullOrWhiteSpace($TitleContains)) {
  $handles = [DshTopmost]::FindByTitle($TitleContains)
}
if ($handles.Count -eq 0) {
  '{"ok":false,"action":"' + $Action + '","windows":0,"error":"no visible window matched (pid=' + $ProcessId + ', title=' + $TitleContains + ')"}'
  exit 0
}

$doTopmost = $Action -eq 'topmost'
foreach ($h in $handles) { [DshTopmost]::Apply($h, $doTopmost) }

if ($doTopmost -and $Duration -gt 0) {
  Start-Sleep -Milliseconds $Duration
  foreach ($h in $handles) { [DshTopmost]::Apply($h, $false) }
  $doTopmost = $false
}

$ids = @()
$states = @()
foreach ($h in $handles) { $ids += $h.ToInt64(); $states += [DshTopmost]::IsTopmost($h) }

$json = @{
  ok = $true
  action = $Action
  restored = -not $doTopmost
  windows = $handles.Count
  handles = $ids
  topmostStates = $states
} | ConvertTo-Json -Compress
$json
