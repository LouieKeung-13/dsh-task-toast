# scripts/card.ps1
# dsh-task-toast —— 独立置顶小卡片（WinForms 原生窗口）
#
# 与 topmost.ps1 的区别：
#   · topmost.ps1 只是把「dsh 主窗口」抬到最上层（大窗口会盖住别的应用）
#   · 本脚本创建一个**独立的无边框浮窗**：只占右下角一小块，压在所有应用之上，
#     不抢占焦点，带亚克力模糊 / 圆角 / 三按钮，点按钮后把结果 POST 回 Host。
#
# 由 Host（lib/index.js）在每条通知到达时 spawn 一次；窗口关闭后进程自然退出。
#
# 参数全部来自 Host，注意保持与 src/static/host.js 中的 showCard() 一致。

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
  [int]$SelfTest = 0
)

$ErrorActionPreference = 'Stop'

# ---------- 主题：auto 时读系统设置 ----------
$dark = $false
if ($Theme -eq 'dark') {
  $dark = $true
} elseif ($Theme -eq 'auto') {
  try {
    $v = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name 'AppsUseLightTheme' -ErrorAction Stop
    if ($null -ne $v.AppsUseLightTheme -and $v.AppsUseLightTheme -eq 0) { $dark = $true }
  } catch { $dark = $false }
}

# 强调色：#RRGGBB → 0xFFRRGGBB（按 int32 有符号存储）
# 注意：PowerShell 里 [int] 强转一个 > 2^31-1 的 uint32 会抛异常，必须先降到 int64 再回绕。
$accentArgb = [int]-16745729  # 0xFF007AFF 兜底
try {
  $hex = ($Accent -replace '#', '').Trim()
  if ($hex.Length -eq 6) {
    $r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
    $g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
    $b = [Convert]::ToInt32($hex.Substring(4, 2), 16)
    $raw = [int64]([int64]0xFF000000 -bor ($r -shl 16) -bor ($g -shl 8) -bor $b)
    if ($raw -gt 0x7FFFFFFF) { $raw = $raw - 0x100000000 }
    $accentArgb = [int]$raw
  }
} catch { }

$src = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
// 注意：不要 using System.Threading —— 否则 Timer 与 System.Windows.Forms.Timer 歧义。
// 需要线程池的地方一律写全限定名 System.Threading.ThreadPool。
using System.Windows.Forms;

namespace DshToast
{
    public static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct AccentPolicy
        {
            public int AccentState;
            public int AccentFlags;
            public int GradientColor;
            public int AnimationId;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct WindowCompositionAttributeData
        {
            public int Attribute;
            public IntPtr Data;
            public int SizeOfData;
        }

        [DllImport("user32.dll")]
        public static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WindowCompositionAttributeData data);

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        [DllImport("shcore.dll")]
        public static extern int SetProcessDpiAwareness(int value);

        public const int WCA_ACCENT_POLICY = 19;
        public const int ACCENT_ENABLE_BLURBEHIND = 3;
        public const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        public const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        public const int DWMWCP_ROUND = 2;

        public static void EnableAcrylic(IntPtr hwnd, int gradientColor)
        {
            try
            {
                AccentPolicy policy = new AccentPolicy();
                policy.AccentState = ACCENT_ENABLE_ACRYLICBLURBEHIND;
                policy.AccentFlags = 2;
                policy.GradientColor = gradientColor;
                policy.AnimationId = 0;
                int size = Marshal.SizeOf(typeof(AccentPolicy));
                IntPtr ptr = Marshal.AllocHGlobal(size);
                try
                {
                    Marshal.StructureToPtr(policy, ptr, false);
                    WindowCompositionAttributeData data = new WindowCompositionAttributeData();
                    data.Attribute = WCA_ACCENT_POLICY;
                    data.SizeOfData = size;
                    data.Data = ptr;
                    int hr = SetWindowCompositionAttribute(hwnd, ref data);
                    if (hr == 0)
                    {
                        policy.AccentState = ACCENT_ENABLE_BLURBEHIND;
                        Marshal.StructureToPtr(policy, ptr, false);
                        data.Data = ptr;
                        SetWindowCompositionAttribute(hwnd, ref data);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(ptr);
                }
            }
            catch { }
        }

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
    }

    public class CardForm : Form
    {
        private CardArgs A;
        private float S = 1f;

        private int CW, CH, PAD;

        private Rectangle rView, rLater, rIgnore;
        private int hover = -1;
        private int pressed = -1;

        private Timer anim;
        private Timer life;
        private int remain;
        private int fadeDir = 1;
        private double targetOpacity = 0.93;
        private bool closing = false;

        private Color cBg, cTitle, cBody, cLine, cGhost, cGhostHover, cAccent, cIconFg;
        private Font fTitle, fBody, fBtn;
        private string txtView, txtLater, txtIgnore;

        public CardForm(CardArgs a)
        {
            A = a;
            bool en = string.Equals(a.Locale, "en", StringComparison.OrdinalIgnoreCase);

            txtView = en ? "View result" : "查看结果";
            txtLater = en ? "Later" : "稍后";
            txtIgnore = en ? "Dismiss" : "忽略";

            if (a.Dark)
            {
                cBg = Color.FromArgb(30, 30, 32);
                cTitle = Color.FromArgb(245, 245, 247);
                cBody = Color.FromArgb(166, 166, 174);
                cLine = Color.FromArgb(58, 58, 62);
                cGhost = Color.FromArgb(250, 250, 252);
                cGhostHover = Color.FromArgb(56, 56, 60);
                cAccent = Color.FromArgb(a.AccentArgb);
                cIconFg = Color.White;
            }
            else
            {
                cBg = Color.FromArgb(250, 250, 252);
                cTitle = Color.FromArgb(28, 28, 30);
                cBody = Color.FromArgb(96, 96, 104);
                cLine = Color.FromArgb(226, 226, 232);
                cGhost = Color.FromArgb(28, 28, 30);
                cGhostHover = Color.FromArgb(236, 236, 241);
                cAccent = Color.FromArgb(a.AccentArgb);
                cIconFg = Color.White;
            }

            string family = en ? "Segoe UI" : "Microsoft YaHei UI";
            try
            {
                fTitle = new Font(family, 11.5f, FontStyle.Bold, GraphicsUnit.Point);
                fBody = new Font(family, 9.5f, FontStyle.Regular, GraphicsUnit.Point);
                fBtn = new Font(family, 9f, FontStyle.Regular, GraphicsUnit.Point);
            }
            catch
            {
                fTitle = new Font(FontFamily.GenericSansSerif, 11.5f, FontStyle.Bold);
                fBody = new Font(FontFamily.GenericSansSerif, 9.5f);
                fBtn = new Font(FontFamily.GenericSansSerif, 9f);
            }

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            BackColor = cBg;
            DoubleBuffered = true;
            KeyPreview = false;
            Opacity = 0.0;
            Text = "dsh-task-toast";

            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);

            Layout2();
            PlaceWindow();
            RebuildRegion();

            anim = new Timer();
            anim.Interval = 16;
            anim.Tick += AnimTick;

            remain = a.TimeoutMs > 0 ? a.TimeoutMs : 10000;
            life = new Timer();
            life.Interval = 100;
            life.Tick += LifeTick;
            life.Start();
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        private float Scale()
        {
            try
            {
                if (DeviceDpi > 0) return (float)DeviceDpi / 96f;
            }
            catch { }
            return 1f;
        }

        private void Layout2()
        {
            S = Scale();
            CW = (int)(384 * S);
            CH = (int)(152 * S);
            PAD = (int)(18 * S);
            ClientSize = new Size(CW, CH);

            int bh = (int)(30 * S);
            int by = CH - PAD - bh;

            int wView = Math.Max((int)(84 * S), TextRenderer.MeasureText(txtView, fBtn).Width + (int)(28 * S));
            int wLater = Math.Max((int)(52 * S), TextRenderer.MeasureText(txtLater, fBtn).Width + (int)(26 * S));
            int wIgnore = Math.Max((int)(52 * S), TextRenderer.MeasureText(txtIgnore, fBtn).Width + (int)(26 * S));
            int gap = (int)(8 * S);

            int right = CW - PAD;
            rView = new Rectangle(right - wView, by, wView, bh);
            rLater = new Rectangle(rView.Left - gap - wLater, by, wLater, bh);
            rIgnore = new Rectangle(rLater.Left - gap - wIgnore, by, wIgnore, bh);
        }

        private void PlaceWindow()
        {
            // 注意：Cursor.Position 是静态成员，不能用窗体的 Cursor 属性去点（CS0176）
            Rectangle wa = Screen.FromPoint(System.Windows.Forms.Cursor.Position).WorkingArea;
            int margin = (int)(20 * S);
            int gap = (int)(12 * S);
            int off = A.Slot * (CH + gap);
            int x, y;

            string p = A.Position == null ? "bottom-right" : A.Position;
            bool left = p.IndexOf("left", StringComparison.OrdinalIgnoreCase) >= 0;
            bool top = p.IndexOf("top", StringComparison.OrdinalIgnoreCase) >= 0;

            x = left ? (wa.Left + margin) : (wa.Right - CW - margin);
            y = top ? (wa.Top + margin + off) : (wa.Bottom - CH - margin - off);

            Location = new Point(x, y);
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

        private void RebuildRegion()
        {
            try
            {
                using (GraphicsPath p = RoundPath(new Rectangle(0, 0, CW, CH), (int)(14 * S)))
                {
                    Region old = Region;
                    Region = new Region(p);
                    if (old != null) old.Dispose();
                }
            }
            catch { }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.RoundCorners(Handle);
            Native.SetDark(Handle, A.Dark);
            int tint = A.Dark ? unchecked((int)0xC818181A) : unchecked((int)0xD0F2F2F6);
            Native.EnableAcrylic(Handle, tint);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            anim.Start();
        }

        private void AnimTick(object sender, EventArgs e)
        {
            double op = Opacity + fadeDir * 0.13;
            if (fadeDir > 0)
            {
                if (op >= targetOpacity) { op = targetOpacity; anim.Stop(); }
            }
            else
            {
                if (op <= 0.0)
                {
                    op = 0.0;
                    anim.Stop();
                    try { life.Stop(); } catch { }
                    Close();
                    return;
                }
            }
            try { Opacity = op; } catch { anim.Stop(); }
        }

        private void LifeTick(object sender, EventArgs e)
        {
            if (closing) return;
            bool inside = ClientRectangle.Contains(PointToClient(System.Windows.Forms.Cursor.Position));
            if (inside) return; // 鼠标停在卡片上时暂停倒计时
            remain -= life.Interval;
            if (remain <= 0)
            {
                closing = true;
                life.Stop();
                fadeDir = -1;
                anim.Start();
            }
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

            // 顶部内高光（毛玻璃质感的关键细节）
            using (Pen hl = new Pen(Color.FromArgb(A.Dark ? 26 : 150, 255, 255, 255), 1f))
            {
                g.DrawLine(hl, 1, 1, CW - 2, 1);
            }

            // 外描边
            using (GraphicsPath edge = RoundPath(new Rectangle(0, 0, CW - 1, CH - 1), (int)(14 * S)))
            using (Pen pen = new Pen(cLine, 1f))
            {
                g.DrawPath(pen, edge);
            }

            // 图标：圆角方块 + 对勾
            int iconSize = (int)(24 * S);
            Rectangle rIcon = new Rectangle(PAD, (int)(20 * S), iconSize, iconSize);
            using (GraphicsPath ip = RoundPath(rIcon, (int)(7 * S)))
            using (SolidBrush ib = new SolidBrush(cAccent))
            {
                g.FillPath(ib, ip);
            }
            using (Pen check = new Pen(cIconFg, 2.2f * S))
            {
                check.StartCap = LineCap.Round;
                check.EndCap = LineCap.Round;
                check.LineJoin = LineJoin.Round;
                float cx = rIcon.X, cy = rIcon.Y;
                g.DrawLines(check, new PointF[] {
                    new PointF(cx + 6.5f * S, cy + 12.2f * S),
                    new PointF(cx + 10.4f * S, cy + 16.2f * S),
                    new PointF(cx + 17.4f * S, cy + 8.0f * S)
                });
            }

            // 标题
            int tx = PAD + iconSize + (int)(10 * S);
            int tw = CW - tx - PAD;
            Rectangle rTitle = new Rectangle(tx, (int)(19 * S), tw, (int)(24 * S));
            TextRenderer.DrawText(g, A.Title, fTitle, rTitle, cTitle,
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix
                | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);

            // 正文
            if (!string.IsNullOrEmpty(A.Body))
            {
                Rectangle rBody = new Rectangle(PAD, (int)(54 * S), CW - PAD * 2, (int)(42 * S));
                TextRenderer.DrawText(g, A.Body, fBody, rBody, cBody,
                    TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak);
            }

            DrawButton(g, rIgnore, txtIgnore, false, hover == 2);
            DrawButton(g, rLater, txtLater, false, hover == 1);
            DrawButton(g, rView, txtView, true, hover == 0);
        }

        private void DrawButton(Graphics g, Rectangle r, string text, bool primary, bool isHover)
        {
            using (GraphicsPath p = RoundPath(r, (int)(9 * S)))
            {
                if (primary)
                {
                    Color fill = cAccent;
                    if (isHover) fill = Lighten(cAccent, A.Dark ? 0.12f : -0.06f);
                    if (pressed == 0 && isHover) fill = Lighten(cAccent, -0.12f);
                    using (SolidBrush b = new SolidBrush(fill))
                    {
                        g.FillPath(b, p);
                    }
                }
                else
                {
                    if (isHover)
                    {
                        using (SolidBrush b = new SolidBrush(cGhostHover))
                        {
                            g.FillPath(b, p);
                        }
                    }
                }
            }

            Color fg = primary ? Color.White : cGhost;
            TextRenderer.DrawText(g, text, fBtn, r, fg,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter
                | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
        }

        private static Color Lighten(Color c, float amount)
        {
            float r = c.R, g = c.G, b = c.B;
            if (amount >= 0)
            {
                r = r + (255 - r) * amount;
                g = g + (255 - g) * amount;
                b = b + (255 - b) * amount;
            }
            else
            {
                float k = 1 + amount;
                r = r * k;
                g = g * k;
                b = b * k;
            }
            return Color.FromArgb(c.A, Clamp((int)r), Clamp((int)g), Clamp((int)b));
        }

        private static int Clamp(int v)
        {
            if (v < 0) return 0;
            if (v > 255) return 255;
            return v;
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
            // Esc = 忽略，Enter = 查看结果
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
            fadeDir = -1;
            anim.Start();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            try { life.Stop(); } catch { }
            try { anim.Stop(); } catch { }
            base.OnFormClosing(e);
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

# ---------- 编译缓存：避免每次通知都等 CodeDom 编译（约 0.5s） ----------
$asms = $null
try {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $hash = [BitConverter]::ToString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($src))).Replace('-', '').Substring(0, 12)
  $cacheDir = Join-Path $env:LOCALAPPDATA 'dsh-task-toast'
  if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }
  $dll = Join-Path $cacheDir ("DshToastCard-$hash.dll")
  if (-not (Test-Path $dll)) {
    # 先清理旧缓存，避免堆积
    Get-ChildItem -Path $cacheDir -Filter 'DshToastCard-*.dll' -ErrorAction SilentlyContinue |
      Remove-Item -Force -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $src -ReferencedAssemblies $referenced -OutputAssembly $dll -ErrorAction Stop
  }
  $asms = Add-Type -Path $dll -PassThru -ErrorAction Stop
} catch {
  # 缓存不可用（权限 / 路径）→ 退回即时编译
  try {
    $asms = Add-Type -TypeDefinition $src -ReferencedAssemblies $referenced -PassThru -ErrorAction Stop
  } catch {
    [Console]::Error.WriteLine('dsh-task-toast card: 编译失败 ' + $_.Exception.Message)
    exit 1
  }
}

# ---------- 自检：只验证能否编译 / 载入，不创建任何窗口 ----------
# Host 在启动几秒后会跑一次 `-SelfTest 1`，把结果写进 dsh 日志，
# 这样「卡片能不能用」不必等到真的来一条通知才知道。
if ($SelfTest -eq 1) {
  try { [DshToast.Native]::SetDpiAware() } catch { }
  '{"ok":true,"stage":"compiled","card":"DshToast.CardForm"}'
  exit 0
}

# ---------- 启动前确保 DPI 感知 ----------
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
$a.AccentArgb = $accentArgb
$a.TimeoutMs = $Timeout
$a.Slot = $Slot
$a.CallbackUrl = $CallbackUrl
$a.Id = $Id

$form = New-Object -TypeName DshToast.CardForm -ArgumentList (,$a)
try {
  [System.Windows.Forms.Application]::Run($form)
} finally {
  try { $form.Dispose() } catch { }
}
