# scripts/card.ps1
# dsh-task-toast WinForms
#
# topmost.ps1
# topmost.ps1 dsh
# ** **
# POST Host
#
# Windows + 1px +
# / / v1.7.0
#
# ** ** DPI
# v1.6.x
#
# Host lib/index.js spawn
#
# Host src/static/host.js spawnCard()

param(
  [string]$Title = '',
  [string]$Body = '',
  [string]$SessionId = '',
  [string]$Locale = 'zh',
  [string]$Position = 'bottom-right',
  [string]$Theme = 'auto',
  [string]$Accent = '#007AFF',
  [int]$Timeout = 10000,
  [int]$Slot = 0,
  [string]$CallbackUrl = '',
  [string]$Id = '',
  [int]$SelfTest = 0,
  [int]$Toast = 0,
  [int]$ToastOnly = 0,
  [string]$Snapshot = '',
 # Host ** ** / C#
 # PS 5.1 UTF-8 BOM .ps1 GBK
 # v1.6.x Unicode
  [string]$BtnView = '',
  [string]$BtnLater = '',
  [string]$BtnIgnore = ''
)

$ErrorActionPreference = 'Stop'

# ---------- + ----------
# stdout {"stage":"..."} Host
# %LOCALAPPDATA%\dsh-task-toast\card.log
# stdout v1.6.0
# $env:LOCALAPPDATA Electron Node
# 4~5
function Get-CacheDir {
  $cand = @($env:LOCALAPPDATA, $env:APPDATA)
  if ($env:USERPROFILE) {
    $cand += (Join-Path $env:USERPROFILE 'AppData\Local')
    $cand += (Join-Path $env:USERPROFILE 'AppData\Roaming')
  }
  $cand += $env:TEMP
  $cand += [IO.Path]::GetTempPath()
  foreach ($c in $cand) {
    if (-not [string]::IsNullOrWhiteSpace($c)) { return $c }
  }
  return '.'
}
$script:BaseDir = Join-Path (Get-CacheDir) 'dsh-task-toast'
$script:LogPath = ''
try {
  if (-not (Test-Path $script:BaseDir)) { New-Item -ItemType Directory -Path $script:BaseDir -Force | Out-Null }
  $script:LogPath = Join-Path $script:BaseDir 'card.log'
} catch { $script:LogPath = '' }
$script:T0 = [DateTime]::UtcNow

function Trace($stage, $extra) {
  $ms = [int]([DateTime]::UtcNow - $script:T0).TotalMilliseconds
  $line = '{"stage":"' + $stage + '","ms":' + $ms + ($(if ($extra) { ',' + $extra } else { '' })) + '}'
  try { [Console]::Out.WriteLine($line); [Console]::Out.Flush() } catch { }
  if ($script:LogPath) {
    try {
      $txt = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $line
      if ($extra -and $extra.Length -gt 400) { $txt += ' (truncated)' }
      [IO.File]::AppendAllText($script:LogPath, $txt + [Environment]::NewLine)
    } catch { }
  }
}
function TraceErr($stage, $msg) {
  $m = [string]$msg
  if ($m.Length -gt 400) { $m = $m.Substring(0, 400) }
  Trace $stage ('"error":"' + ($m -replace '"', "'" -replace "`r|`n", ' ') + '"')
}

Trace 'boot' ('"pid":' + $PID + ',"selfTest":' + $SelfTest + ',"toast":' + $Toast)

# ---------- auto ----------
$dark = $false
if ($Theme -eq 'dark') {
  $dark = $true
} elseif ($Theme -eq 'auto') {
  try {
    $v = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name 'AppsUseLightTheme' -ErrorAction Stop
    if ($null -ne $v.AppsUseLightTheme -and $v.AppsUseLightTheme -eq 0) { $dark = $true }
  } catch { $dark = $false }
}

$src = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace DshToast
{
    public static class Native
    {
        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("shcore.dll")]
        public static extern int SetProcessDpiAwareness(int value);

        [DllImport("user32.dll")]
        public static extern int GetDpiForWindow(IntPtr hwnd);

        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        public const int DWMWCP_ROUND = 2;

        public static void SetDark(IntPtr hwnd, bool dark)
        {
            try
            {
                int v = dark ? 1 : 0;
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref v, 4);
            }
            catch { }
        }

        public static void RoundCorners(IntPtr hwnd)
        {
            try
            {
                int v = DWMWCP_ROUND;
                DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, ref v, 4);
            }
            catch { }
        }

        public static void SetDpiAware()
        {
            try { SetProcessDpiAwareness(2); }
            catch { try { SetProcessDpiAwareness(1); } catch { } }
        }

 /// <summary> DPI 0 </summary>
        public static int WindowDpi(IntPtr hwnd)
        {
            try
            {
                int d = GetDpiForWindow(hwnd);
                if (d > 0) return d;
            }
            catch { }
            return 0;
        }
    }

    public class CardArgs
    {
        public string Title = "";
        public string Body = "";
        public string SessionId = "";
        public string Locale = "zh";
        public string Position = "bottom-right";
        public bool Dark = false;
        public int AccentArgb = unchecked((int)0xFF007AFF);
        public int TimeoutMs = 10000;
        public int Slot = 0;
        public string CallbackUrl = "";
        public string Id = "";
 // Host Unicode GBK
        public string BtnView = "";
        public string BtnLater = "";
        public string BtnIgnore = "";
    }

    /// <summary>
 /// Windows
 /// + 1px + / /
 /// DPI
    /// </summary>
    public class CardForm : Form
    {
        private CardArgs A;
        private float S = 1f;

        private int CW = 0, CH = 0, PAD = 0;
        private Rectangle rIcon, rTitle, rBody, rIgnore, rLater, rView;

        private int hover = -1;
        private int pressed = -1;
        private bool closing = false;

        private Timer life;
        private int remain = 0;

        private Color cBg, cTitle, cBody, cBorder, cGhost, cGhostHover, cPrimary, cPrimaryFg, cIconBg, cIconFg;
        private Font fTitle, fBody, fBtn;
        private string txtView, txtLater, txtIgnore;

        public CardForm(CardArgs a)
        {
            A = a;
            bool en = string.Equals(a.Locale, "en", StringComparison.OrdinalIgnoreCase);

 // Host ASCII
            txtView = !string.IsNullOrEmpty(a.BtnView) ? a.BtnView : (en ? "View result" : "View result");
            txtLater = !string.IsNullOrEmpty(a.BtnLater) ? a.BtnLater : "Later";
            txtIgnore = !string.IsNullOrEmpty(a.BtnIgnore) ? a.BtnIgnore : "Dismiss";

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;
            KeyPreview = true;
            AutoScaleMode = AutoScaleMode.None;
            Opacity = 1.0;
            Text = "dsh-task-toast";

            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);

            remain = a.TimeoutMs > 0 ? a.TimeoutMs : 10000;
            life = new Timer();
            life.Interval = 100;
            life.Tick += LifeTick;
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

 // DPI
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                InitScale();
                InitTheme();
                InitFonts();
                LayoutCard();
                PlaceWindow();
                Native.RoundCorners(Handle);
                Native.SetDark(Handle, A.Dark);
            }
            catch { }
        }

        private void InitScale()
        {
            float d = 0f;
            try
            {
                int w = Native.WindowDpi(Handle);
                if (w > 0) d = (float)w;
            }
            catch { }
            if (d <= 0f)
            {
                try { if (DeviceDpi > 0) d = (float)DeviceDpi; } catch { }
            }
            if (d <= 0f)
            {
                try { using (Graphics g = CreateGraphics()) { d = g.DpiX; } } catch { }
            }
            if (d < 96f) d = 96f;
            S = d / 96f;
        }

        private void InitTheme()
        {
            if (A.Dark)
            {
                cBg = Color.FromArgb(43, 43, 43);
                cTitle = Color.FromArgb(255, 255, 255);
                cBody = Color.FromArgb(201, 201, 201);
                cBorder = Color.FromArgb(63, 63, 63);
                cGhost = Color.FromArgb(255, 255, 255);
                cGhostHover = Color.FromArgb(58, 58, 58);
                cPrimary = Color.FromArgb(243, 243, 243);
                cPrimaryFg = Color.FromArgb(31, 31, 31);
                cIconBg = Color.FromArgb(243, 243, 243);
                cIconFg = Color.FromArgb(31, 31, 31);
            }
            else
            {
                cBg = Color.FromArgb(247, 247, 247);
                cTitle = Color.FromArgb(26, 26, 26);
                cBody = Color.FromArgb(95, 95, 95);
                cBorder = Color.FromArgb(220, 220, 220);
                cGhost = Color.FromArgb(26, 26, 26);
                cGhostHover = Color.FromArgb(233, 233, 233);
                cPrimary = Color.FromArgb(26, 26, 26);
                cPrimaryFg = Color.FromArgb(255, 255, 255);
                cIconBg = Color.FromArgb(26, 26, 26);
                cIconFg = Color.FromArgb(255, 255, 255);
            }
        }

 /// <summary> 96dpi </summary>
        private float Pix(float pt)
        {
            return (float)Math.Round(pt * 96f / 72f * S, 0);
        }

        private void InitFonts()
        {
            bool en = string.Equals(A.Locale, "en", StringComparison.OrdinalIgnoreCase);
            string[] fams = en
                ? new string[] { "Segoe UI", "Microsoft YaHei UI", "Arial" }
                : new string[] { "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", "Arial" };
            string fam = null;
            foreach (string f in fams)
            {
                try
                {
                    using (Font tmp = new Font(f, 12f))
                    {
                        if (string.Equals(tmp.Name, f, StringComparison.OrdinalIgnoreCase)) { fam = f; break; }
                    }
                }
                catch { }
            }
            if (fam == null) fam = FontFamily.GenericSansSerif.Name;
            try
            {
                fTitle = new Font(fam, Pix(11.5f), FontStyle.Bold, GraphicsUnit.Pixel);
                fBody = new Font(fam, Pix(9.5f), FontStyle.Regular, GraphicsUnit.Pixel);
                fBtn = new Font(fam, Pix(9f), FontStyle.Regular, GraphicsUnit.Pixel);
            }
            catch
            {
                fTitle = new Font(FontFamily.GenericSansSerif, Pix(11.5f), FontStyle.Bold, GraphicsUnit.Pixel);
                fBody = new Font(FontFamily.GenericSansSerif, Pix(9.5f), FontStyle.Regular, GraphicsUnit.Pixel);
                fBtn = new Font(FontFamily.GenericSansSerif, Pix(9f), FontStyle.Regular, GraphicsUnit.Pixel);
            }
        }

        private int MeasureBtn(string t)
        {
            int w = TextRenderer.MeasureText(t, fBtn).Width;
            return w + (int)Math.Round(22f * S);
        }

        private void LayoutCard()
        {
            PAD = (int)Math.Round(16f * S);
            int iconSize = (int)Math.Round(22f * S);
            int gapIcon = (int)Math.Round(10f * S);
            int gapTitleBody = (int)Math.Round(8f * S);
            int gapBodyBtn = (int)Math.Round(16f * S);
            int btnH = (int)Math.Round(30f * S);
            int btnGap = (int)Math.Round(8f * S);

            Rectangle wa = Screen.FromPoint(System.Windows.Forms.Cursor.Position).WorkingArea;
            CW = (int)Math.Round(380f * S);
            int maxW = wa.Width - (int)Math.Round(40f * S);
            if (CW > maxW) CW = maxW;
            if (CW < (int)Math.Round(200f * S)) CW = (int)Math.Round(200f * S);

            int contentW = CW - PAD * 2;

 //
            int titleH = fTitle.Height;
            string body = A.Body == null ? "" : A.Body.Trim();
            int bodyH = 0;
            if (body.Length > 0)
            {
                Size sz = TextRenderer.MeasureText(body, fBody, new Size(contentW, int.MaxValue),
                    TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
                bodyH = sz.Height;
            }

            int headH = Math.Max(iconSize, titleH);
            CH = PAD + headH + (bodyH > 0 ? gapTitleBody + bodyH : 0) + gapBodyBtn + btnH + PAD;

            ClientSize = new Size(CW, CH);

            rIcon = new Rectangle(PAD, PAD + (headH - iconSize) / 2, iconSize, iconSize);
            int tx = rIcon.Right + gapIcon;
            int titleW = CW - PAD - tx;
            if (titleW < (int)Math.Round(40f * S)) titleW = (int)Math.Round(40f * S);
            rTitle = new Rectangle(tx, PAD + (headH - titleH) / 2, titleW, titleH);

            rBody = new Rectangle(PAD, PAD + headH + gapTitleBody, contentW, bodyH);

            int wView = MeasureBtn(txtView);
            int wLater = MeasureBtn(txtLater);
            int wIgnore = MeasureBtn(txtIgnore);
            int by = CH - PAD - btnH;
            int bx = CW - PAD - wView;
            rView = new Rectangle(bx, by, wView, btnH);
            rLater = new Rectangle(bx - btnGap - wLater, by, wLater, btnH);
            rIgnore = new Rectangle(rLater.Left - btnGap - wIgnore, by, wIgnore, btnH);
        }

        private void PlaceWindow()
        {
            Rectangle wa = Screen.FromPoint(System.Windows.Forms.Cursor.Position).WorkingArea;
            int margin = (int)Math.Round(20f * S);
            int gap = (int)Math.Round(12f * S);
            int off = A.Slot * (CH + gap);
            int x, y;

            string p = A.Position == null ? "bottom-right" : A.Position;
            bool left = p.IndexOf("left", StringComparison.OrdinalIgnoreCase) >= 0;
            bool top = p.IndexOf("top", StringComparison.OrdinalIgnoreCase) >= 0;

            x = left ? (wa.Left + margin) : (wa.Right - CW - margin);
            y = top ? (wa.Top + margin + off) : (wa.Bottom - CH - margin - off);
            if (y < wa.Top) y = wa.Top + margin;

            Location = new Point(x, y);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            using (SolidBrush bg = new SolidBrush(cBg))
            {
                g.FillRectangle(bg, ClientRectangle);
            }

 // 1px Windows
            using (Pen pen = new Pen(cBorder, 1f))
            {
                g.DrawRectangle(pen, 0, 0, CW - 1, CH - 1);
            }

 // +
            using (GraphicsPath ip = RoundPath(rIcon, (int)Math.Round(6f * S)))
            using (SolidBrush ib = new SolidBrush(cIconBg))
            {
                g.FillPath(ib, ip);
            }
            using (Pen check = new Pen(cIconFg, (float)Math.Round(1.9f * S, 1)))
            {
                check.StartCap = LineCap.Round;
                check.EndCap = LineCap.Round;
                check.LineJoin = LineJoin.Round;
                float cx = rIcon.X, cy = rIcon.Y;
                g.DrawLines(check, new PointF[] {
                    new PointF(cx + 6.0f * S, cy + 11.6f * S),
                    new PointF(cx + 9.4f * S, cy + 15.2f * S),
                    new PointF(cx + 16.2f * S, cy + 7.4f * S)
                });
            }

 //
            TextRenderer.DrawText(g, A.Title == null ? "" : A.Title, fTitle, rTitle, cTitle,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix
                | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);

 //
            if (rBody.Height > 0)
            {
                TextRenderer.DrawText(g, A.Body == null ? "" : A.Body, fBody, rBody, cBody,
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak);
            }

            DrawButton(g, rIgnore, txtIgnore, false, hover == 2);
            DrawButton(g, rLater, txtLater, false, hover == 1);
            DrawButton(g, rView, txtView, true, hover == 0);
        }

        private void DrawButton(Graphics g, Rectangle r, string text, bool primary, bool isHover)
        {
            using (GraphicsPath p = RoundPath(r, (int)Math.Round(8f * S)))
            {
                if (primary)
                {
                    Color fill = cPrimary;
                    if (pressed == 0 && isHover) fill = ControlPaint.Dark(cPrimary, 0.06f);
                    else if (isHover) fill = ControlPaint.Light(cPrimary, 0.06f);
                    using (SolidBrush b = new SolidBrush(fill))
                    {
                        g.FillPath(b, p);
                    }
                }
                else if (isHover)
                {
                    using (SolidBrush b = new SolidBrush(cGhostHover))
                    {
                        g.FillPath(b, p);
                    }
                }
            }

            Color fg = primary ? cPrimaryFg : cGhost;
            TextRenderer.DrawText(g, text, fBtn, r, fg,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter
                | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
        }

        private static GraphicsPath RoundPath(Rectangle r, int radius)
        {
            GraphicsPath path = new GraphicsPath();
            int d = radius * 2;
            if (d > r.Width) d = r.Width;
            if (d > r.Height) d = r.Height;
            if (d <= 0)
            {
                path.AddRectangle(r);
                return path;
            }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private int HitTest(Point p)
        {
            if (rView.Contains(p)) return 0;
            if (rLater.Contains(p)) return 1;
            if (rIgnore.Contains(p)) return 2;
            return -1;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int h = HitTest(e.Location);
            if (h != hover)
            {
                hover = h;
                Cursor = h >= 0 ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (hover != -1) { hover = -1; Invalidate(); }
            pressed = -1;
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            pressed = HitTest(e.Location);
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            int h = HitTest(e.Location);
            pressed = -1;
            Invalidate();
            if (h < 0) return;
            if (h == 0) Act("view");
            else if (h == 1) Act("later");
            else Act("ignore");
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Escape) { Act("ignore"); return true; }
            if (keyData == Keys.Enter) { Act("view"); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        private void Act(string action)
        {
            if (closing) return;
            closing = true;
            try { life.Stop(); } catch { }
            string url = A.CallbackUrl;
            if (!string.IsNullOrEmpty(url))
            {
                string json = "{\"id\":\"" + Card.Esc(A.Id) + "\",\"action\":\"" + action
                    + "\",\"sessionId\":\"" + Card.Esc(A.SessionId) + "\",\"slot\":" + A.Slot + "}";
                System.Threading.ThreadPool.QueueUserWorkItem(delegate(object o)
                {
                    Card.Post(url, json);
                });
            }
            Close();
        }

        private void LifeTick(object sender, EventArgs e)
        {
            if (closing) return;
            bool inside = ClientRectangle.Contains(PointToClient(System.Windows.Forms.Cursor.Position));
            if (inside) return; // pause the countdown while the cursor rests on the card
            remain -= life.Interval;
            if (remain <= 0)
            {
                closing = true;
                life.Stop();
                Close();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            try { life.Stop(); } catch { }
            base.OnFormClosing(e);
        }

 /// <summary> PNG </summary>
        public void SaveSnapshot(string path)
        {
            try
            {
                using (Bitmap bmp = new Bitmap(Math.Max(1, CW), Math.Max(1, CH)))
                {
                    DrawToBitmap(bmp, new Rectangle(0, 0, CW, CH));
                    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            catch { }
        }
    }

    public static class Card
    {
        public static string Esc(string s)
        {
            if (s == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < ' ') sb.Append(' ');
                        else sb.Append(ch);
                        break;
                }
            }
            return sb.ToString();
        }

        public static void Post(string url, string json)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "POST";
                req.ContentType = "application/json";
                req.Timeout = 2000;
                req.ReadWriteTimeout = 2000;
                req.Proxy = null;
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                req.ContentLength = bytes.Length;
                using (Stream s = req.GetRequestStream())
                {
                    s.Write(bytes, 0, bytes.Length);
                }
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    resp.Close();
                }
            }
            catch { }
        }
    }
}
'@

$referenced = @('System', 'System.Core', 'System.Drawing', 'System.Windows.Forms')

# ---------- CodeDom 0.5s ----------
$asms = $null
try {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $hash = [BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($src))).Replace('-', '').Substring(0, 12)
  $cacheDir = $script:BaseDir
  if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
  Trace 'cache-dir' ('"dir":"' + ($cacheDir -replace '\\', '\\') + '"')
  $dll = Join-Path $cacheDir ("DshToastCard-$hash.dll")
  if (-not (Test-Path $dll)) {
    Trace 'compile-start' '"cached":false'
 #
    Get-ChildItem -Path $cacheDir -Filter 'DshToastCard-*.dll' -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $src -ReferencedAssemblies $referenced -OutputAssembly $dll -ErrorAction Stop
    Trace 'compile-done' '"cached":false'
  } else {
    Trace 'compile-start' '"cached":true'
  }
 # -PassThru
  Add-Type -Path $dll -ErrorAction Stop
  Trace 'compiled' ('"cached":' + $(if (Test-Path $dll) { 'true' } else { 'false' }))
} catch {
  TraceErr 'compile-fail' $_.Exception.Message
 # /
  try {
    Add-Type -TypeDefinition $src -ReferencedAssemblies $referenced -ErrorAction Stop
    Trace 'compiled' '"cached":false,"fallback":true'
  } catch {
    TraceErr 'compile-fail-final' $_.Exception.Message
    [Console]::Error.WriteLine('dsh-task-toast card: compile failed ' + $_.Exception.Message)
    exit 1
  }
}

# ---------- / ----------
# Host `-SelfTest 1` dsh
#
if ($SelfTest -eq 1) {
  try { [DshToast.Native]::SetDpiAware() } catch { }
  Trace 'selftest-ok' ''
 # Host "ok":true
  [Console]::Out.WriteLine('{"ok":true,"stage":"compiled","card":"DshToast.CardForm"}')
  [Console]::Out.Flush()
  exit 0
}

# ---------- DPI ----------
try { [DshToast.Native]::SetDpiAware() } catch { }

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$a = New-Object DshToast.CardArgs
$a.Title = $Title
$a.Body = $Body
$a.SessionId = $SessionId
$a.Locale = $Locale
$a.Position = $Position
$a.Dark = $dark
$a.TimeoutMs = $Timeout
$a.Slot = $Slot
$a.CallbackUrl = $CallbackUrl
$a.Id = $Id
$a.BtnView = $BtnView
$a.BtnLater = $BtnLater
$a.BtnIgnore = $BtnIgnore

# ---------- Windows + ----------
# WinRT Toast
# AppID PowerShell ID
if ($Toast -eq 1) {
  try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
    [void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]

    function Esc-Xml([string]$s) {
      if ($null -eq $s) { return '' }
      return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;').Replace("'", '&apos;')
    }
    $xmlText = '<toast scenario="reminder" duration="long"><visual><binding template="ToastGeneric">'
    $xmlText += '<text>' + (Esc-Xml $Title) + '</text>'
    $xmlText += '<text>' + (Esc-Xml $Body) + '</text>'
    $xmlText += '</binding></visual><audio src="ms-winsoundevent:Notification.Default"/></toast>'

    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xmlText)
    $tn = New-Object Windows.UI.Notifications.ToastNotification $doc
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($tn)
    Trace 'toast-sent' ''
  } catch {
    TraceErr 'toast-fail' $_.Exception.Message
  }
}

#
if ($ToastOnly -eq 1) { exit 0 }

$form = New-Object -TypeName DshToast.CardForm -ArgumentList (,$a)
Trace 'form-created' ''

# Host stdout Host
# /
$form.Add_Shown({ Trace 'shown' '' })

# PNG
if ($Snapshot) {
  $form.Add_Shown({
    try { $form.SaveSnapshot($Snapshot) } catch { }
    $form.Close()
  })
}

try {
  Trace 'run-enter' ''
  [System.Windows.Forms.Application]::Run($form)
  Trace 'run-exit' ''
} catch {
  TraceErr 'run-fail' $_.Exception.Message
  [Console]::Error.WriteLine('dsh-task-toast card: ' + $_.Exception.Message)
} finally {
  try { $form.Dispose() } catch { }
}
