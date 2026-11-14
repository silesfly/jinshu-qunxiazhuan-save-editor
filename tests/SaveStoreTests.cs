using System;
using System.IO;
using System.Runtime.InteropServices;

namespace JinshuSaveEditor
{
    public static class SaveStoreTests
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

        private sealed class FaultStream : MemoryStream
        {
            private readonly bool persistent;
            private int writes;

            public FaultStream(byte[] initial, bool persistentFault)
                : base()
            {
                base.Write(initial, 0, initial.Length);
                Position = 0;
                persistent = persistentFault;
                writes = 0;
            }

            public override void Write(byte[] buffer, int offset, int count)
            {
                if (persistent || writes == 0)
                {
                    writes++;
                    int n = count > 0 ? 1 : 0;
                    if (n > 0)
                    {
                        base.Write(buffer, offset, n);
                    }
                    throw new IOException("injected write fault");
                }
                writes++;
                base.Write(buffer, offset, count);
            }
        }

        public static int Main(string[] args)
        {
            Assert(args != null && args.Length == 1, "usage: SaveStoreTests <new-fixture-dir>");
            string root = Path.GetFullPath(args[0]);
            Assert(!Directory.Exists(root) && !File.Exists(root), "fixture directory already exists");
            Directory.CreateDirectory(root);
            try
            {
                Case1_ReplacePreservesBackups(root);
                Case2_StaleHash(root);
                Case3_LocksAndReadOnly(root);
                Case4_EmptyAndMissing(root);
                Case5_WriteNewFault(root);
                Case6_InvalidExtensionsAdsReserved(root);
                Case7_HardLinks(root);
                Case8_UpdateRollback();
                Case9_UpdateRollbackFailure();
                Case10_CopyBackupAndPending(root);
                Console.WriteLine("ALL PASS");
                return 0;
            }
            finally
            {
                try
                {
                    if (Directory.Exists(root))
                    {
                        Directory.Delete(root, true);
                    }
                }
                catch
                {
                }
            }
        }

        private static void Assert(bool ok, string why)
        {
            if (!ok)
            {
                throw new Exception("ASSERT: " + why);
            }
            Console.WriteLine("PASS " + why);
        }

        private static void Reject(Action action, string why)
        {
            try
            {
                action();
            }
            catch (IOException)
            {
                Console.WriteLine("PASS " + why);
                return;
            }
            catch (UnauthorizedAccessException)
            {
                Console.WriteLine("PASS " + why);
                return;
            }
            throw new Exception("EXPECTED REJECTION: " + why);
        }

        private static byte[] B(params byte[] values)
        {
            return values;
        }

        private static string P(string root, string name)
        {
            return Path.Combine(root, name);
        }

        private static string[] Files(string root)
        {
            return Directory.GetFiles(root, "*", SearchOption.AllDirectories);
        }

        private static bool HasPattern(string[] files, string part)
        {
            for (int i = 0; i < files.Length; i++)
            {
                if (files[i].IndexOf(part, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        private static void Case1_ReplacePreservesBackups(string root)
        {
            string target = P(root, "case1.sav");
            byte[] a = B(1, 2, 3, 4);
            byte[] b = B(9, 8, 7);
            byte[] c = B(5, 6);
            SaveStore.WriteNew(target, a);
            string first = SaveStore.ReplaceWithBackup(target, SaveStore.Hash(a), b);
            string second = SaveStore.ReplaceWithBackup(target, SaveStore.Hash(b), c);
            Assert(File.Exists(first) && File.Exists(second), "both backup files exist");
            Assert(File.ReadAllBytes(first).Length == a.Length, "first backup length");
            Assert(File.ReadAllBytes(second).Length == b.Length, "second backup length");
            Assert(SaveStore.Hash(File.ReadAllBytes(target)) == SaveStore.Hash(c), "target updated");
            string before = SaveStore.Hash(File.ReadAllBytes(first));
            Reject(delegate { SaveStore.WriteNew(first, B(99, 100)); }, "WriteNew must reject existing backup path");
            Assert(File.Exists(first) && SaveStore.Hash(File.ReadAllBytes(first)) == before, "first backup preserved");
        }

        private static void Case2_StaleHash(string root)
        {
            string target = P(root, "case2.sav");
            byte[] original = B(10, 20, 30);
            SaveStore.WriteNew(target, original);
            string[] before = Files(root);
            Reject(delegate { SaveStore.ReplaceWithBackup(target, SaveStore.Hash(B(1, 2)), B(4, 5)); }, "stale expected hash");
            Assert(SaveStore.Hash(File.ReadAllBytes(target)) == SaveStore.Hash(original), "target unchanged");
            string[] after = Files(root);
            Assert(before.Length == after.Length, "no .bak created");
        }

        private static void Case3_LocksAndReadOnly(string root)
        {
            string target = P(root, "case3.sav");
            byte[] original = B(11, 12, 13);
            SaveStore.WriteNew(target, original);
            using (FileStream fs = new FileStream(target, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                Reject(delegate { SaveStore.Read(target); }, "Read open lock");
                Reject(delegate { SaveStore.ReplaceWithBackup(target, SaveStore.Hash(original), B(1)); }, "Replace open lock");
                GC.KeepAlive(fs);
            }
            File.SetAttributes(target, FileAttributes.ReadOnly);
            try
            {
                Reject(delegate { SaveStore.ReplaceWithBackup(target, SaveStore.Hash(original), B(2)); }, "ReadOnly replace");
                Assert(SaveStore.Hash(File.ReadAllBytes(target)) == SaveStore.Hash(original), "ReadOnly bytes intact");
            }
            finally
            {
                File.SetAttributes(target, FileAttributes.Normal);
            }
        }

        private static void Case4_EmptyAndMissing(string root)
        {
            string target = P(root, "case4.sav");
            Reject(delegate { SaveStore.WriteNew(target, new byte[0]); }, "empty payload");
            Assert(!File.Exists(target), "empty payload no file");
            Reject(delegate { SaveStore.ReplaceWithBackup(P(root, "missing.sav"), SaveStore.Hash(B(1)), B(2)); }, "missing target replace");
            Reject(delegate { SaveStore.Read(P(root, "missing.sav")); }, "missing read");
        }

        private static void Case5_WriteNewFault(string root)
        {
            string a = P(root, "fault.sav");
            string b = P(root, "fault.bak");
            Action<Stream, byte[]> writer = delegate(Stream s, byte[] data)
            {
                s.Write(data, 0, 4);
                throw new IOException("fault");
            };
            Reject(delegate { SaveStore.WriteNew(a, B(1, 2, 3, 4, 5), writer); }, "fault.sav injection");
            Assert(!File.Exists(a), "fault.sav cleanup");
            Reject(delegate { SaveStore.WriteNew(b, B(1, 2, 3, 4, 5), writer); }, "fault.bak injection");
            Assert(!File.Exists(b), "fault.bak cleanup");
        }

        private static void Case6_InvalidExtensionsAdsReserved(string root)
        {
            string[] invalid = { "bad.txt", "bad.exe", "Save_1.sav:evil.sav", "CON.sav", "NUL.sav", "COM1.sav" };
            for (int i = 0; i < invalid.Length; i++)
            {
                string name = invalid[i];
                Assert(!SaveStore.IsSaveExtension(name), "invalid extension: " + name);
                string target = Path.Combine(root, name);
                Reject(delegate { SaveStore.WriteNew(target, B(1, 2)); }, "WriteNew invalid: " + name);
                Reject(delegate { SaveStore.CopyWithBackup(P(root, "case6.sav"), target, "", B(2, 3)); }, "Copy invalid: " + name);
            }
        }

        private static void Case7_HardLinks(string root)
        {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT)
            {
                return;
            }
            string target = P(root, "case7.sav");
            string link = P(root, "case7_link.sav");
            byte[] original = B(21, 22, 23);
            SaveStore.WriteNew(target, original);
            Assert(CreateHardLink(link, target, IntPtr.Zero), "CreateHardLink created");
            try
            {
                Reject(delegate { SaveStore.Read(link); }, "Read hardlink");
                Reject(delegate { SaveStore.ReplaceWithBackup(link, SaveStore.Hash(original), B(1)); }, "Replace hardlink");
            }
            finally
            {
                File.Delete(link);
            }
            Assert(SaveStore.Hash(SaveStore.Read(target)) == SaveStore.Hash(original), "target unchanged after link delete");
        }

        private static void Case8_UpdateRollback()
        {
            byte[] before = B(1, 2, 3, 4, 5);
            byte[] data = B(9, 8, 7, 6, 5, 4);
            using (FaultStream stream = new FaultStream(before, false))
            {
                try
                {
                    SaveStore.UpdateOrRestore(stream, before, data, "backup-8.bak");
                    Assert(false, "UpdateOrRestore should throw");
                }
                catch (IOException ex)
                {
                    Assert(ex.Message.IndexOf("backup-8.bak", StringComparison.Ordinal) >= 0, "rollback message backup");
                }
                byte[] actual = stream.ToArray();
                Assert(actual.Length == before.Length, "rollback length");
                for (int i = 0; i < before.Length; i++)
                {
                    Assert(actual[i] == before[i], "rollback byte " + i);
                }
            }
        }

        private static void Case9_UpdateRollbackFailure()
        {
            byte[] before = B(31, 32, 33);
            byte[] data = B(41, 42, 43, 44);
            using (FaultStream stream = new FaultStream(before, true))
            {
                try
                {
                    SaveStore.UpdateOrRestore(stream, before, data, "backup-9.bak");
                    Assert(false, "UpdateOrRestore should throw");
                }
                catch (IOException ex)
                {
                    Assert(ex.Message.IndexOf("자동 원상복구에 실패", StringComparison.Ordinal) >= 0, "rollback failure text");
                    Assert(ex.Message.IndexOf("backup-9.bak", StringComparison.Ordinal) >= 0, "rollback failure backup");
                }
            }
        }

        private static void Case10_CopyBackupAndPending(string root)
        {
            string source = P(root, "case10_src.sav");
            string destination = P(root, "case10_dst.sav");
            byte[] sourceBytes = B(51, 52, 53);
            byte[] newBytes = B(61, 62, 63, 64);
            SaveStore.WriteNew(source, sourceBytes);
            string backup = SaveStore.CopyWithBackup(source, destination, SaveStore.Hash(sourceBytes), newBytes);
            Assert(File.Exists(destination), "destination created");
            Assert(File.Exists(backup), "original backup created");
            Assert(SaveStore.Hash(File.ReadAllBytes(destination)) == SaveStore.Hash(newBytes), "destination bytes");
            Assert(SaveStore.Hash(File.ReadAllBytes(backup)) == SaveStore.Hash(sourceBytes), "backup bytes");
            Reject(delegate { SaveStore.CopyWithBackup(source, destination, SaveStore.Hash(sourceBytes), B(7)); }, "duplicate destination");
            Reject(delegate { SaveStore.CopyWithBackup(source, source, SaveStore.Hash(sourceBytes), B(8)); }, "same source/dest");
            string retryDest = P(root, "case10_retry.sav");
            Action<Stream, byte[]> fault = delegate(Stream s, byte[] d)
            {
                s.Write(d, 0, 1);
                throw new IOException("copy fault");
            };
            try
            {
                SaveStore.CopyWithBackup(source, retryDest, SaveStore.Hash(sourceBytes), B(71, 72, 73), fault);
                Assert(false, "fault copy should throw");
            }
            catch (IOException ex)
            {
                Assert(ex.Message.IndexOf(".original-", StringComparison.OrdinalIgnoreCase) >= 0, "fault message backup");
            }
            Assert(!File.Exists(retryDest), "failed copy leaves no destination");
            string[] files = Files(root);
            Assert(!HasPattern(files, ".pending-"), "pending files cleaned");
            string retry = SaveStore.CopyWithBackup(source, retryDest, SaveStore.Hash(sourceBytes), B(81, 82));
            Assert(File.Exists(retryDest) && File.Exists(retry), "retry succeeds");
            Assert(SaveStore.Hash(File.ReadAllBytes(retryDest)) == SaveStore.Hash(B(81, 82)), "retry bytes");
        }
    }
}
