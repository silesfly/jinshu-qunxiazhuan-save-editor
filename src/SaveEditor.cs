using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Jinshu Qunxiazhuan Save Editor")]
[assembly: AssemblyProduct("Jinshu Qunxiazhuan Save Editor")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace JinshuSaveEditor
{
    internal sealed class Program
    {
        private const string GameRunningMessage = "게임 실행 중이 감지되었습니다. 게임을 종료한 뒤 저장하세요.";

        public static Form MainForm;
        public static WebView2 Web;
        public static string RuntimeFolder;
        public static string TestRoot;
        public static string SeedSourceSav;
        public static bool TestRootOwned;

        private static string activePath;
        private static string activeHash;
        private static string activeSession;
        private static string lastFolder;
        public static int ExitCode;
        private static bool closingAllowed;
        private static bool selfTestStarted;
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024, RecursionLimit = 32 };

        [STAThread]
        private static int Main(string[] args)
        {
            if (args != null && args.Length >= 2 && args[0] == "--self-test")
            {
                if (args.Length != 2 && args.Length != 3)
                {
                    Console.Error.WriteLine("usage: JinshuSaveEditor.exe --self-test <test-root> [<seed-sav>]");
                    return 2;
                }
                TestRoot = Path.GetFullPath(args[1]);
                if (Directory.Exists(TestRoot) || File.Exists(TestRoot))
                {
                    Console.Error.WriteLine("self-test root already exists: " + TestRoot);
                    return 2;
                }
                Directory.CreateDirectory(TestRoot);
                TestRootOwned = true;
                RuntimeFolder = TestRoot;
                if (args.Length == 3)
                {
                    SeedSourceSav = Path.GetFullPath(args[2]);
                }
            }
            else if (args != null && args.Length != 0)
            {
                Console.Error.WriteLine("usage: JinshuSaveEditor.exe [--self-test <root> [<seed-sav>]]");
                return 2;
            }
            else
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                RuntimeFolder = Path.Combine(localAppData, "JinshuSaveEditor", "runtime-1.1.0");
            }

            AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;

            try
            {
                Run();
            }
            catch (Exception ex)
            {
                Fail(ex);
                return ExitCode;
            }

            return ExitCode;
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static void Run()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Directory.CreateDirectory(RuntimeFolder);
            ExtractLoaderDll();

            CoreWebView2Environment.SetLoaderDllFolderPath(RuntimeFolder);

            MainForm = new Form();
            MainForm.Text = "Jinshu Qunxiazhuan Save Editor v1.1";
            MainForm.Width = 1180;
            MainForm.Height = 820;
            MainForm.MinimumSize = new Size(880, 600);
            MainForm.StartPosition = FormStartPosition.CenterScreen;
            MainForm.FormClosing += OnFormClosing;

            if (TestRoot != null)
            {
                MainForm.WindowState = FormWindowState.Minimized;
                MainForm.ShowInTaskbar = false;
            }

            Web = new WebView2();
            Web.Dock = DockStyle.Fill;
            MainForm.Controls.Add(Web);
            MainForm.FormClosed += delegate { Web.Dispose(); };

            MainForm.Shown += async delegate
            {
                try
                {
                    await InitWebViewAsync();
                }
                catch (Exception ex)
                {
                    Fail(ex);
                }
            };

            Application.Run(MainForm);
        }

        private static void ExtractLoaderDll()
        {
            byte[] embedded = ReadResource("WebView2Loader.dll");
            if (embedded == null)
            {
                throw new InvalidOperationException("WebView2Loader.dll is not embedded in this build.");
            }
            string expected = SaveStore.Hash(embedded);
            string destination = Path.Combine(RuntimeFolder, "WebView2Loader.dll");

            bool needWrite = true;
            if (File.Exists(destination))
            {
                try
                {
                    byte[] existing = File.ReadAllBytes(destination);
                    if (String.Equals(SaveStore.Hash(existing), expected, StringComparison.Ordinal))
                    {
                        needWrite = false;
                    }
                }
                catch (Exception)
                {
                    needWrite = true;
                }
            }

            if (needWrite)
            {
                if (File.Exists(destination))
                {
                    File.SetAttributes(destination, FileAttributes.Normal);
                    File.Delete(destination);
                }
                File.WriteAllBytes(destination, embedded);
            }

            byte[] check = File.ReadAllBytes(destination);
            if (!String.Equals(SaveStore.Hash(check), expected, StringComparison.Ordinal))
            {
                throw new IOException("WebView2Loader.dll SHA-256 verification failed.");
            }
        }

        private static void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!closingAllowed && Program.TestRoot != null)
            {
                e.Cancel = true;
            }
        }

        private static async Task InitWebViewAsync()
        {
            string profileFolder = Path.Combine(RuntimeFolder, "Profile");
            SaveStore.NoLinks(profileFolder);
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions("--disable-background-networking");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, profileFolder, options);
            await Web.EnsureCoreWebView2Async(environment);

            CoreWebView2Settings settings = Web.CoreWebView2.Settings;
            settings.AreDevToolsEnabled = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.IsPasswordAutosaveEnabled = false;
            settings.IsWebMessageEnabled = true;
            try
            {
                settings.AreHostObjectsAllowed = false;
            }
            catch (Exception)
            {
                // older runtimes
            }

            Web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
            };
            Web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e)
            {
                e.State = CoreWebView2PermissionState.Deny;
                e.Handled = true;
            };

            bool initialNavigationSeen = false;
            Web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e)
            {
                string uri = e.Uri == null ? "" : e.Uri;
                if (!initialNavigationSeen && (uri.StartsWith("about:blank", StringComparison.OrdinalIgnoreCase)
                    || uri.StartsWith("data:text/html", StringComparison.OrdinalIgnoreCase)))
                {
                    initialNavigationSeen = true;
                    return;
                }
                e.Cancel = true;
            };

            Web.CoreWebView2.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            Web.CoreWebView2.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs e)
            {
                string uri = e.Request.Uri == null ? "" : e.Request.Uri;
                if (uri.StartsWith("http:", StringComparison.OrdinalIgnoreCase)
                    || uri.StartsWith("https:", StringComparison.OrdinalIgnoreCase))
                {
                    MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes("Offline"));
                    e.Response = Web.CoreWebView2.Environment.CreateWebResourceResponse(
                        stream, 403, "Offline", "Content-Type: text/plain");
                }
            };

            Web.CoreWebView2.WebMessageReceived += delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e)
            {
                string raw = e.WebMessageAsJson;
                try
                {
                    HandleRequest(raw);
                }
                catch (Exception ex)
                {
                    try
                    {
                        Dictionary<string, object> failure = new Dictionary<string, object>();
                        failure["ok"] = false;
                        failure["error"] = ex.Message;
                        string replyId = null;
                        object replySeq = null;
                        try
                        {
                            object parsed = Json.DeserializeObject(raw);
                            Dictionary<string, object> root = parsed as Dictionary<string, object>;
                            if (root != null)
                            {
                                replyId = GetString(root, "id");
                                object seqValue;
                                if (root.TryGetValue("seq", out seqValue))
                                {
                                    replySeq = seqValue;
                                }
                            }
                        }
                        catch (Exception)
                        {
                        }
                        Reply(replyId, replySeq, failure);
                    }
                    catch (Exception)
                    {
                    }
                }
            };

            string html = Encoding.UTF8.GetString(ReadResource("editor.html"));
            Web.CoreWebView2.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (!e.IsSuccess)
                {
                    Fail(new InvalidOperationException("WebView2 navigation failed: " + e.WebErrorStatus));
                    return;
                }

                if (Program.TestRoot != null && !selfTestStarted)
                {
                    selfTestStarted = true;
                    try
                    {
                        await SelfTest();
                    }
                    catch (Exception ex)
                    {
                        Fail(ex);
                    }
                }
            };
            Web.CoreWebView2.NavigateToString(html);
        }

        private static void Fail(Exception ex)
        {
            ExitCode = 1;
            if (Program.TestRoot != null)
            {
                try
                {
                    string path = Path.Combine(Program.TestRoot, "failure.txt");
                    File.WriteAllText(path, ex.ToString(), Encoding.UTF8);
                }
                catch (Exception)
                {
                }
            }
            else
            {
                try
                {
                    MessageBox.Show(ex.ToString(), "Jinshu Qunxiazhuan Save Editor", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                catch (Exception)
                {
                }
            }

            closingAllowed = true;
            if (MainForm != null)
            {
                try
                {
                    MainForm.Close();
                }
                catch (Exception)
                {
                }
            }
        }

        private static Assembly OnAssemblyResolve(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (name == "Microsoft.Web.WebView2.Core" || name == "Microsoft.Web.WebView2.WinForms")
            {
                byte[] bytes = ReadResource(name + ".dll");
                if (bytes != null)
                {
                    return Assembly.Load(bytes);
                }
            }
            return null;
        }

        public static byte[] Resource(string name)
        {
            return ReadResource(name);
        }

        private static byte[] ReadResource(string name)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            Stream stream = assembly.GetManifestResourceStream(name);
            if (stream == null)
            {
                return null;
            }
            using (stream)
            {
                long length = stream.Length;
                byte[] buffer = new byte[(int)length];
                int read = 0;
                while (read < buffer.Length)
                {
                    int n = stream.Read(buffer, read, buffer.Length - read);
                    if (n <= 0)
                    {
                        break;
                    }
                    read += n;
                }
                return buffer;
            }
        }

        public static void CheckGameNotRunning()
        {
            if (Environment.GetEnvironmentVariable("JSSE_SIMULATE_GAME_RUNNING") == "1")
            {
                throw new IOException(GameRunningMessage);
            }
            Process[] processes = Process.GetProcesses();
            try
            {
                for (int i = 0; i < processes.Length; i++)
                {
                    string pname = processes[i].ProcessName;
                    if (pname == null)
                    {
                        continue;
                    }
                    string lower = pname.ToLowerInvariant();
                    if (lower.IndexOf("jinshuqunxiazhuan", StringComparison.Ordinal) >= 0
                        || lower.IndexOf("qunxia52", StringComparison.Ordinal) >= 0)
                    {
                        throw new IOException(GameRunningMessage);
                    }
                }
            }
            finally
            {
                for (int i = 0; i < processes.Length; i++)
                {
                    try
                    {
                        processes[i].Dispose();
                    }
                    catch (Exception)
                    {
                    }
                }
            }
        }

        public static string GetDefaultJinshuSaveDir()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;

            string direct = Path.Combine(baseDir, "save");
            if (Directory.Exists(direct))
            {
                return direct;
            }

            string parent = Path.GetDirectoryName(baseDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (!String.IsNullOrEmpty(parent))
            {
                string parentSave = Path.Combine(parent, "save");
                if (Directory.Exists(parentSave))
                {
                    return parentSave;
                }
            }

            string desktopCandidate;
            if (TrySetDesktopCandidate(baseDir, out desktopCandidate))
            {
                return desktopCandidate;
            }

            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
            if (!String.IsNullOrEmpty(desktop) && Directory.Exists(desktop))
            {
                try
                {
                    string[] children = Directory.GetDirectories(desktop);
                    for (int i = 0; i < children.Length; i++)
                    {
                        string candidate = children[i];
                        string name = Path.GetFileName(candidate);
                        if (name != null && name.StartsWith("JINSHU", StringComparison.OrdinalIgnoreCase))
                        {
                            string save = Path.Combine(candidate, "save");
                            if (Directory.Exists(save))
                            {
                                return save;
                            }
                        }
                    }
                    string desktopSave = Path.Combine(desktop, "save");
                    if (Directory.Exists(desktopSave))
                    {
                        return desktopSave;
                    }
                    return desktop;
                }
                catch (Exception)
                {
                }
            }

            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!String.IsNullOrEmpty(userProfile))
            {
                return userProfile;
            }
            return baseDir;
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        private static bool TrySetDesktopCandidate(string baseDir, out string output)
        {
            output = baseDir;
            return false;
        }

        private static string GetString(Dictionary<string, object> root, string key)
        {
            object value;
            if (root == null || !root.TryGetValue(key, out value) || value == null)
            {
                return null;
            }
            return value as string;
        }

        private static void Reply(string id, object seq, Dictionary<string, object> payload)
        {
            if (payload == null)
            {
                payload = new Dictionary<string, object>();
            }
            payload["id"] = id;
            if (seq != null)
            {
                payload["seq"] = seq;
            }
            Web.CoreWebView2.PostWebMessageAsJson(Json.Serialize(payload));
        }

        private static void HandleRequest(string raw)
        {
            object parsed = Json.DeserializeObject(raw);
            Dictionary<string, object> root = parsed as Dictionary<string, object>;
            if (root == null)
            {
                return;
            }

            string id = GetString(root, "id");
            object seqValue = null;
            object rawSeq;
            if (root.TryGetValue("seq", out rawSeq))
            {
                seqValue = rawSeq;
            }
            string kind = GetString(root, "kind");

            if (kind == "ready")
            {
                if (Program.TestRoot == null)
                {
                    string folder = lastFolder;
                    if (String.IsNullOrEmpty(folder))
                    {
                        folder = GetDefaultJinshuSaveDir();
                    }
                    if (!String.IsNullOrEmpty(folder))
                    {
                        string candidate = Path.Combine(folder, "Save_1.sav");
                        if (File.Exists(candidate))
                        {
                            byte[] bytes = SaveStore.Read(candidate);
                            activePath = Path.GetFullPath(candidate);
                            activeHash = SaveStore.Hash(bytes);
                            activeSession = Guid.NewGuid().ToString("N");
                            lastFolder = Path.GetDirectoryName(activePath);
                            Dictionary<string, object> reply = new Dictionary<string, object>();
                            reply["ok"] = true;
                            reply["session"] = activeSession;
                            reply["name"] = "Save_1.sav";
                            reply["path"] = activePath;
                            reply["base64"] = Convert.ToBase64String(bytes);
                            Reply(id, seqValue, reply);
                            return;
                        }
                    }
                }
                Dictionary<string, object> ready = new Dictionary<string, object>();
                ready["ok"] = true;
                Reply(id, seqValue, ready);
                return;
            }

            if (kind == "open")
            {
                string fullPath = null;
                if (Program.TestRoot != null)
                {
                    fullPath = Path.Combine(Path.Combine(Program.TestRoot, "save"), "Save_1.sav");
                }
                else
                {
                    using (OpenFileDialog dialog = new OpenFileDialog())
                    {
                        dialog.Filter = "금서군협전 세이브 (*.sav)|*.sav";
                        dialog.CheckFileExists = true;
                        if (!String.IsNullOrEmpty(lastFolder))
                        {
                            dialog.InitialDirectory = lastFolder;
                        }
                        if (dialog.ShowDialog(MainForm) != DialogResult.OK)
                        {
                            Dictionary<string, object> cancelled = new Dictionary<string, object>();
                            cancelled["ok"] = true;
                            cancelled["cancelled"] = true;
                            Reply(id, seqValue, cancelled);
                            return;
                        }
                        fullPath = dialog.FileName;
                    }
                }

                byte[] bytes = SaveStore.Read(fullPath);
                activePath = Path.GetFullPath(fullPath);
                activeHash = SaveStore.Hash(bytes);
                activeSession = Guid.NewGuid().ToString("N");
                lastFolder = Path.GetDirectoryName(activePath);
                Dictionary<string, object> reply = new Dictionary<string, object>();
                reply["ok"] = true;
                reply["session"] = activeSession;
                reply["name"] = Path.GetFileName(activePath);
                reply["path"] = activePath;
                reply["base64"] = Convert.ToBase64String(bytes);
                Reply(id, seqValue, reply);
                return;
            }

            if (kind == "save")
            {
                CheckGameNotRunning();
                if (activePath == null)
                {
                    throw new IOException("먼저 세이브 파일을 열어야 합니다.");
                }
                string requestSession = GetString(root, "session");
                if (!String.Equals(requestSession, activeSession, StringComparison.Ordinal))
                {
                    throw new IOException("세션 토큰이 일치하지 않습니다. 세이브 파일을 다시 열어주세요.");
                }
                string b64 = GetString(root, "base64");
                if (b64 == null)
                {
                    throw new IOException("저장 데이터가 비어 있습니다.");
                }
                byte[] data = Convert.FromBase64String(b64);

                string backup = SaveStore.ReplaceWithBackup(activePath, activeHash, data);
                activeHash = SaveStore.Hash(data);
                activeSession = Guid.NewGuid().ToString("N");

                Dictionary<string, object> reply = new Dictionary<string, object>();
                reply["ok"] = true;
                reply["session"] = activeSession;
                reply["path"] = activePath;
                reply["backup"] = backup;
                Reply(id, seqValue, reply);
                return;
            }

            if (kind == "save-copy")
            {
                CheckGameNotRunning();
                string dest = null;
                using (SaveFileDialog dialog = new SaveFileDialog())
                {
                    dialog.Filter = "금서군협전 세이브 (*.sav)|*.sav";
                    dialog.DefaultExt = "sav";
                    dialog.AddExtension = true;
                    dialog.OverwritePrompt = true;
                    if (!String.IsNullOrEmpty(lastFolder))
                    {
                        dialog.InitialDirectory = lastFolder;
                    }
                    string suggested = GetString(root, "name");
                    if (suggested == null)
                    {
                        suggested = "Save_1_copy.sav";
                    }
                    dialog.FileName = suggested;
                    if (dialog.ShowDialog(MainForm) != DialogResult.OK)
                    {
                        Dictionary<string, object> cancelled = new Dictionary<string, object>();
                        cancelled["ok"] = true;
                        cancelled["cancelled"] = true;
                        Reply(id, seqValue, cancelled);
                        return;
                    }
                    dest = dialog.FileName;
                }

                if (!SaveStore.IsSaveExtension(dest))
                {
                    throw new IOException("세이브 확장자(.sav)만 허용됩니다: " + dest);
                }

                string b64 = GetString(root, "base64");
                if (b64 == null)
                {
                    throw new IOException("복사할 데이터가 비어 있습니다.");
                }
                byte[] data = Convert.FromBase64String(b64);

                string backup = null;
                if (activePath != null && File.Exists(activePath))
                {
                    backup = SaveStore.CopyWithBackup(activePath, dest, activeHash, data);
                }
                else
                {
                    SaveStore.WriteNew(dest, data);
                }

                Dictionary<string, object> reply = new Dictionary<string, object>();
                reply["ok"] = true;
                reply["path"] = Path.GetFullPath(dest);
                reply["backup"] = backup;
                Reply(id, seqValue, reply);
                return;
            }

            throw new IOException("알 수 없는 요청입니다: " + kind);
        }

        private static async Task Until(string expression)
        {
            Stopwatch watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < 30000)
            {
                string result = await Web.CoreWebView2.ExecuteScriptAsync(expression);
                if (result != null && result.Trim() == "true")
                {
                    return;
                }
                await Task.Delay(100);
            }
            throw new TimeoutException("조건 대기 실패: " + expression);
        }

        private static async Task<string> Eval(string expression)
        {
            return await Web.CoreWebView2.ExecuteScriptAsync(expression);
        }

        private static async Task SelfTest()
        {
            await Until("typeof window.JinshuEditorUI === 'object' && typeof window.JinshuEditorCore === 'object' && typeof window.JinshuSavCodec === 'object'");

            string saveDir = Path.Combine(Program.TestRoot, "save");
            Directory.CreateDirectory(saveDir);
            string savPath = Path.Combine(saveDir, "Save_1.sav");

            string sourceMode = "demo";
            byte[] seedBytes;
            if (Program.SeedSourceSav != null)
            {
                sourceMode = "seed";
                seedBytes = SaveStore.Read(Program.SeedSourceSav);
            }
            else
            {
                await Eval("(function(){window.__demoB64=null;window.__demoErr=null;try{window.JinshuEditorCore.createDemoSavBytes(window.JinshuCatalog).then(function(u){var bin='';for(var i=0;i<u.length;i++)bin+=String.fromCharCode(u[i]);window.__demoB64=btoa(bin);}).catch(function(e){window.__demoErr=String(e);});}catch(e){window.__demoErr=String(e);}return true;})()");
                await Until("window.__demoB64 !== null || window.__demoErr !== null");
                string demoErr = UnquoteJson(await Eval("window.__demoErr || ''"));
                if (demoErr.Length > 0)
                {
                    throw new IOException(demoErr);
                }
                string b64 = UnquoteJson(await Eval("window.__demoB64"));
                seedBytes = Convert.FromBase64String(b64);
            }

            if (File.Exists(savPath))
            {
                File.Delete(savPath);
            }
            SaveStore.WriteNew(savPath, seedBytes);
            string originalSavHash = SaveStore.Hash(seedBytes);

            await Eval("window.__getSGrpSig = function(b64){ var bin=atob(b64), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); var es=window.JinshuSavCodec.parseZip(u); var count=0, sig=null; for(var j=0;j<es.length;j++){ if(es[j].name.toLowerCase()==='s.grp'){ count++; sig=es[j].crc32+':'+es[j].rawCompBytes.length+':'+window.JinshuSavCodec.crc32(es[j].rawCompBytes); } } if(count>1) return 'DUP:'+count; if(count===0) return 'NONE'; return sig; };");

            string seedB64 = Convert.ToBase64String(seedBytes);
            string origSig = UnquoteJson(await Eval("window.__getSGrpSig('" + seedB64 + "')"));
            if (origSig == "NONE" || origSig.StartsWith("DUP:", StringComparison.Ordinal))
            {
                throw new IOException("원본 세이브의 s.grp 항목이 유일하지 않습니다: " + origSig);
            }

            await Eval("document.getElementById('btn-native-open').click()");
            await Until("!window.JinshuEditorUI.isBusy() && window.JinshuEditorUI.getNativeSession() !== null && window.JinshuEditorUI.getSession().isLoaded()");

            await Eval("document.querySelector('[data-preset=\"wealth_max\"]').click()");
            await Until("window.hasUnsavedChanges() === true && window.JinshuEditorUI.getSession().validate().valid === true");

            await Eval("window.__prevSession = window.JinshuEditorUI.getNativeSession(); document.getElementById('btn-native-save').click();");
            await Until("!window.JinshuEditorUI.isBusy() && window.hasUnsavedChanges() === false && window.JinshuEditorUI.getNativeSession() !== window.__prevSession");

            string[] baks = Directory.GetFiles(saveDir, "Save_1.sav.backup-*.bak");
            if (baks.Length != 1)
            {
                throw new IOException("백업 파일 수가 예상과 다릅니다: " + baks.Length);
            }
            string backupHash = SaveStore.Hash(File.ReadAllBytes(baks[0]));
            bool backupVerified = String.Equals(backupHash, originalSavHash, StringComparison.Ordinal);
            if (!backupVerified)
            {
                throw new IOException("백업 파일 SHA-256 검증 실패: " + baks[0]);
            }

            await Eval("window.__prevSession = window.JinshuEditorUI.getNativeSession(); document.getElementById('btn-native-open').click();");
            await Until("!window.JinshuEditorUI.isBusy() && window.JinshuEditorUI.getNativeSession() !== null && window.JinshuEditorUI.getNativeSession() !== window.__prevSession && window.JinshuEditorUI.getSession().isLoaded()");

            string summaryJson = UnquoteJson(await Eval("(function(){var s=window.JinshuEditorUI.getSession();var sum=s.getSummary();return JSON.stringify({valid:s.validate().valid,gold:sum.gold,mjcz:sum.mjcz,sp:sum.sp});})()"));
            Dictionary<string, object> summary = Json.DeserializeObject(summaryJson) as Dictionary<string, object>;
            if (summary == null)
            {
                throw new IOException("요약 파싱 실패: " + summaryJson);
            }
            bool valid = summary["valid"] is bool && (bool)summary["valid"];
            int goldAfterReload = ToInt(summary["gold"]);
            int mjczAfterReload = ToInt(summary["mjcz"]);
            int spAfterReload = ToInt(summary["sp"]);

            if (!valid || goldAfterReload != 500000 || mjczAfterReload != 999 || spAfterReload != 30000)
            {
                throw new IOException("재로드 후 검증 실패: valid=" + valid + " gold=" + goldAfterReload + " mjcz=" + mjczAfterReload + " sp=" + spAfterReload);
            }

            byte[] afterBytes = File.ReadAllBytes(savPath);
            string afterSig = UnquoteJson(await Eval("window.__getSGrpSig('" + Convert.ToBase64String(afterBytes) + "')"));
            bool sGrpPassthroughVerified = String.Equals(origSig, afterSig, StringComparison.Ordinal);
            if (!sGrpPassthroughVerified)
            {
                throw new IOException("s.grp 패스스루 검증 실패: " + origSig + " vs " + afterSig);
            }

            Dictionary<string, object> receipt = new Dictionary<string, object>();
            receipt["status"] = "PASS";
            receipt["sourceMode"] = sourceMode;
            receipt["goldAfterReload"] = goldAfterReload;
            receipt["mjczAfterReload"] = mjczAfterReload;
            receipt["spAfterReload"] = spAfterReload;
            receipt["backupVerified"] = true;
            receipt["sGrpPassthroughVerified"] = true;
            byte[] htmlResource = Program.Resource("editor.html");
            receipt["htmlHash"] = SaveStore.Hash(htmlResource);

            string receiptJson = Json.Serialize(receipt);
            File.WriteAllText(Path.Combine(Program.TestRoot, "receipt.json"), receiptJson, Encoding.UTF8);

            closingAllowed = true;
            MainForm.Close();
        }

        private static int ToInt(object value)
        {
            if (value == null)
            {
                return 0;
            }
            if (value is int)
            {
                return (int)value;
            }
            if (value is long)
            {
                return (int)(long)value;
            }
            if (value is double)
            {
                return (int)(double)value;
            }
            if (value is string)
            {
                int parsed;
                if (Int32.TryParse((string)value, out parsed))
                {
                    return parsed;
                }
            }
            return 0;
        }

        private static string UnquoteJson(string value)
        {
            if (value == null)
            {
                return null;
            }
            string trimmed = value.Trim();
            if (trimmed.Length >= 2 && trimmed[0] == '"' && trimmed[trimmed.Length - 1] == '"')
            {
                try
                {
                    object parsed = Json.DeserializeObject(trimmed);
                    string strValue = parsed as string;
                    if (strValue != null)
                    {
                        return strValue;
                    }
                }
                catch (Exception)
                {
                }
                return trimmed.Substring(1, trimmed.Length - 2);
            }
            return trimmed;
        }
    }
}
