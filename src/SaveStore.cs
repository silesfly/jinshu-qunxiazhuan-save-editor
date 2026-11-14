using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace JinshuSaveEditor
{
    public static class SaveStore
    {
        public const long MaxSaveBytes = 32L * 1024L * 1024L;

        private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;

        [StructLayout(LayoutKind.Sequential)]
        private struct BY_HANDLE_FILE_INFORMATION
        {
            public uint dwFileAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
            public uint dwVolumeSerialNumber;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint nNumberOfLinks;
            public uint nFileIndexHigh;
            public uint nFileIndexLow;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandle(
            IntPtr hFile,
            out BY_HANDLE_FILE_INFORMATION lpFileInformation);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            IntPtr hFile,
            StringBuilder lpszFilePath,
            uint cchFilePath,
            uint dwFlags);

        public static bool IsSaveExtension(string path)
        {
            try
            {
                if (String.IsNullOrEmpty(path) || HasInvalidColon(path))
                {
                    return false;
                }

                string name = Path.GetFileName(path);
                if (String.IsNullOrEmpty(name))
                {
                    return false;
                }

                if (name.IndexOf(':') >= 0)
                {
                    return false;
                }

                int dot = name.IndexOf('.');
                string stem;
                if (dot >= 0)
                {
                    stem = name.Substring(0, dot);
                }
                else
                {
                    stem = name;
                }
                stem = stem.TrimEnd(' ', '.');

                if (IsReservedDeviceName(stem))
                {
                    return false;
                }

                string ext = Path.GetExtension(name);
                return String.Equals(ext, ".sav", StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        public static string Hash(byte[] bytes)
        {
            if (bytes == null)
            {
                throw new ArgumentNullException("bytes");
            }

            using (SHA256 sha = SHA256.Create())
            {
                byte[] digest = sha.ComputeHash(bytes);
                StringBuilder sb = new StringBuilder(digest.Length * 2);
                for (int i = 0; i < digest.Length; i++)
                {
                    sb.Append(digest[i].ToString("x2"));
                }
                return sb.ToString();
            }
        }

        public static void NoLinks(string path)
        {
            if (String.IsNullOrEmpty(path))
            {
                throw new IOException("경로가 비어 있습니다.");
            }

            string trimmed = path.TrimStart();
            if (trimmed.StartsWith("\\\\", StringComparison.Ordinal) ||
                trimmed.StartsWith("//", StringComparison.Ordinal))
            {
                throw new IOException("UNC 경로는 허용되지 않습니다: " + path);
            }

            string full;
            try
            {
                full = Path.GetFullPath(path);
            }
            catch (Exception ex)
            {
                throw new IOException("유효하지 않은 경로입니다: " + path, ex);
            }

            int colon = full.IndexOf(':', 2);
            if (colon >= 0)
            {
                throw new IOException("NTFS 대체 데이터 스트림 경로는 허용되지 않습니다: " + path);
            }

            CheckNoReparse(full);

            string current = full;
            while (!String.IsNullOrEmpty(current))
            {
                string parent = Path.GetDirectoryName(current);
                if (String.IsNullOrEmpty(parent))
                {
                    break;
                }

                if (Directory.Exists(parent))
                {
                    CheckNoReparse(parent);
                }

                if (String.Equals(Path.GetPathRoot(parent), parent, StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }

                current = parent;
            }
        }

        public static byte[] Read(string path)
        {
            NoLinks(path);
            if (!IsSaveExtension(path))
            {
                throw new IOException("세이브 확장자(.sav)만 읽을 수 있습니다: " + path);
            }

            string full = Path.GetFullPath(path);
            using (FileStream stream = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                VerifyHandle(stream, full);
                if (stream.Length <= 0 || stream.Length > MaxSaveBytes)
                {
                    throw new IOException("세이브 파일 크기가 허용 범위를 벗어났습니다: " + full);
                }

                long len = stream.Length;
                byte[] bytes = new byte[(int)len];
                int read = 0;
                while (read < bytes.Length)
                {
                    int n = stream.Read(bytes, read, bytes.Length - read);
                    if (n <= 0)
                    {
                        throw new IOException("세이브 파일을 끝까지 읽지 못했습니다: " + full);
                    }
                    read += n;
                }
                return bytes;
            }
        }

        public static void WriteNew(string path, byte[] data, Action<Stream, byte[]> writer = null)
        {
            if (path == null)
            {
                throw new ArgumentNullException("path");
            }
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }
            if (data.Length <= 0 || data.Length > MaxSaveBytes)
            {
                throw new IOException("세이브 데이터 크기가 허용 범위를 벗어났습니다.");
            }

            NoLinks(path);
            if (!IsAllowedWritePath(path, true))
            {
                throw new IOException("쓰기 가능한 세이브 확장자(.sav/.bak)가 아닙니다: " + path);
            }

            string full = Path.GetFullPath(path);
            bool created = false;
            try
            {
                using (FileStream stream = new FileStream(full, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
                {
                    created = true;
                    VerifyHandle(stream, full);

                    if (writer != null)
                    {
                        writer(stream, data);
                        FlushStream(stream);
                    }
                    else
                    {
                        WriteAndVerify(stream, data);
                    }
                }
            }
            catch
            {
                if (created)
                {
                    try
                    {
                        if (File.Exists(full))
                        {
                            File.Delete(full);
                        }
                    }
                    catch
                    {
                    }
                }
                throw;
            }
        }

        public static string ReplaceWithBackup(string path, string expectedHash, byte[] data)
        {
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }
            if (data.Length <= 0 || data.Length > MaxSaveBytes)
            {
                throw new IOException("세이브 데이터 크기가 허용 범위를 벗어났습니다.");
            }

            NoLinks(path);
            if (!IsSaveExtension(path))
            {
                throw new IOException("세이브 확장자(.sav)만 교체할 수 있습니다: " + path);
            }

            string full = Path.GetFullPath(path);
            using (FileStream target = new FileStream(full, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                VerifyHandle(target, full);

                byte[] before = ReadAllFromStream(target);
                if (!String.Equals(Hash(before), expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    throw new IOException("세이브 파일 해시가 예상 값과 다릅니다: " + full);
                }

                string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture);
                string backup = full + ".backup-" + stamp + "-" + Guid.NewGuid().ToString("N") + ".bak";

                WriteNew(backup, before);

                using (FileStream backupStream = new FileStream(backup, FileMode.Open, FileAccess.Read, FileShare.Read))
                {
                    VerifyHandle(backupStream, backup);
                    byte[] backupBytes = ReadAllFromStream(backupStream);
                    if (!String.Equals(Hash(backupBytes), expectedHash, StringComparison.OrdinalIgnoreCase))
                    {
                        throw new IOException("백업 파일 검증에 실패했습니다: " + backup);
                    }
                }

                target.Position = 0;
                UpdateOrRestore(target, before, data, backup);
                return backup;
            }
        }

        public static string CopyWithBackup(
            string source,
            string destination,
            string expectedHash,
            byte[] data,
            Action<Stream, byte[]> writer = null)
        {
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }
            if (data.Length <= 0 || data.Length > MaxSaveBytes)
            {
                throw new IOException("세이브 데이터 크기가 허용 범위를 벗어났습니다.");
            }
            if (!IsSaveExtension(source))
            {
                throw new IOException("원본 세이브 확장자(.sav)가 아닙니다: " + source);
            }
            if (!IsSaveExtension(destination))
            {
                throw new IOException("대상 세이브 확장자(.sav)가 아닙니다: " + destination);
            }

            NoLinks(source);
            NoLinks(destination);

            string sourceFull = Path.GetFullPath(source);
            string destFull = Path.GetFullPath(destination);

            if (String.Equals(sourceFull, destFull, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("원본과 대상 경로가 같습니다: " + destFull);
            }
            if (File.Exists(destFull))
            {
                throw new IOException("대상 파일이 이미 존재합니다: " + destFull);
            }

            byte[] original = Read(sourceFull);
            if (!String.Equals(Hash(original), expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("원본 세이브 해시가 예상 값과 다릅니다: " + sourceFull);
            }

            string guid = Guid.NewGuid().ToString("N");
            string backup = destFull + ".original-" + guid + ".bak";
            WriteNew(backup, original);

            string pending = destFull + ".pending-" + guid;
            bool pendingCreated = false;
            try
            {
                using (FileStream stream = new FileStream(pending, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None))
                {
                    pendingCreated = true;
                    VerifyHandle(stream, pending);

                    if (writer != null)
                    {
                        writer(stream, data);
                        FlushStream(stream);
                    }
                    else
                    {
                        WriteAndVerify(stream, data);
                    }
                }

                if (File.Exists(destFull))
                {
                    throw new IOException("대상 파일이 이미 존재합니다: " + destFull);
                }
                File.Move(pending, destFull);
                pendingCreated = false;
                return backup;
            }
            catch (IOException ex)
            {
                if (pendingCreated)
                {
                    try
                    {
                        if (File.Exists(pending))
                        {
                            File.Delete(pending);
                        }
                    }
                    catch
                    {
                    }
                }
                throw new IOException("복사 저장 실패 (원본 백업 보존됨: " + backup + "): " + ex.Message, ex);
            }
            catch
            {
                if (pendingCreated)
                {
                    try
                    {
                        if (File.Exists(pending))
                        {
                            File.Delete(pending);
                        }
                    }
                    catch
                    {
                    }
                }
                throw;
            }
        }

        public static void UpdateOrRestore(Stream target, byte[] before, byte[] data, string backup)
        {
            if (target == null)
            {
                throw new ArgumentNullException("target");
            }
            if (before == null)
            {
                throw new ArgumentNullException("before");
            }
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }

            try
            {
                WriteAndVerify(target, data);
            }
            catch (Exception ex)
            {
                try
                {
                    target.Position = 0;
                    target.SetLength(0);
                    target.Write(before, 0, before.Length);
                    FlushStream(target);
                }
                catch (Exception rollbackEx)
                {
                    throw new IOException("세이브 갱신 및 자동 원상복구에 실패했습니다. 백업: " + backup, rollbackEx);
                }

                throw new IOException("세이브 갱신 실패로 원본 바이트를 복원했습니다. 백업: " + backup, ex);
            }
        }

        public static void WriteAndVerify(Stream target, byte[] data)
        {
            if (target == null)
            {
                throw new ArgumentNullException("target");
            }
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }
            if (data.Length <= 0 || data.Length > MaxSaveBytes)
            {
                throw new IOException("세이브 데이터 크기가 허용 범위를 벗어났습니다.");
            }

            target.Position = 0;
            target.SetLength(0);
            target.Write(data, 0, data.Length);
            FlushStream(target);

            if (target.Length != data.Length)
            {
                throw new IOException("세이브 데이터 길이 검증에 실패했습니다.");
            }

            target.Position = 0;
            byte[] check = new byte[data.Length];
            int read = 0;
            while (read < check.Length)
            {
                int n = target.Read(check, read, check.Length - read);
                if (n <= 0)
                {
                    throw new IOException("세이브 데이터 다시 읽기에 실패했습니다.");
                }
                read += n;
            }

            if (!String.Equals(Hash(check), Hash(data), StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("세이브 데이터 해시 검증에 실패했습니다.");
            }
        }

        private static void VerifyHandle(FileStream stream, string expectedFullPath)
        {
            if (stream == null)
            {
                throw new ArgumentNullException("stream");
            }

            if (Environment.OSVersion.Platform != PlatformID.Win32NT)
            {
                return;
            }

            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(stream.SafeFileHandle.DangerousGetHandle(), out info))
            {
                throw new IOException("파일 핸들 정보를 얻지 못했습니다: " + expectedFullPath);
            }

            if ((info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            {
                throw new IOException("재분석 지점(심볼릭 링크) 파일은 허용되지 않습니다: " + expectedFullPath);
            }
            if (info.nNumberOfLinks > 1)
            {
                throw new IOException("하드 링크된 파일은 허용되지 않습니다: " + expectedFullPath);
            }

            StringBuilder sb = new StringBuilder(512);
            uint len = GetFinalPathNameByHandleW(
                stream.SafeFileHandle.DangerousGetHandle(),
                sb,
                (uint)sb.Capacity,
                0);
            if (len == 0)
            {
                throw new IOException("최종 경로를 얻지 못했습니다: " + expectedFullPath);
            }
            if (len >= sb.Capacity)
            {
                sb = new StringBuilder((int)len + 1);
                len = GetFinalPathNameByHandleW(
                    stream.SafeFileHandle.DangerousGetHandle(),
                    sb,
                    (uint)sb.Capacity,
                    0);
                if (len == 0 || len >= sb.Capacity)
                {
                    throw new IOException("최종 경로를 얻지 못했습니다: " + expectedFullPath);
                }
            }

            string finalPath = sb.ToString();
            if (finalPath.StartsWith("\\\\?\\UNC\\", StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("UNC 최종 경로는 허용되지 않습니다: " + finalPath);
            }
            if (finalPath.StartsWith("\\\\?\\", StringComparison.Ordinal))
            {
                finalPath = finalPath.Substring(4);
            }

            string expected = Path.GetFullPath(expectedFullPath);
            string actual = Path.GetFullPath(finalPath);
            if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            {
                throw new IOException("파일 핸들의 최종 경로가 예상 경로와 다릅니다: " + actual);
            }
        }

        private static void CheckNoReparse(string path)
        {
            if (!File.Exists(path) && !Directory.Exists(path))
            {
                return;
            }
            FileAttributes attrs = File.GetAttributes(path);
            if ((attrs & FileAttributes.ReparsePoint) != 0)
            {
                throw new IOException("재분석 지점(심볼릭 링크/정션)은 허용되지 않습니다: " + path);
            }
        }

        private static void FlushStream(Stream target)
        {
            FileStream fs = target as FileStream;
            if (fs != null)
            {
                fs.Flush(true);
            }
            else
            {
                target.Flush();
            }
        }

        private static byte[] ReadAllFromStream(Stream stream)
        {
            long pos = stream.Position;
            stream.Position = 0;
            long len = stream.Length;
            if (len <= 0 || len > MaxSaveBytes)
            {
                throw new IOException("파일 크기가 허용 범위를 벗어났습니다.");
            }

            byte[] bytes = new byte[(int)len];
            int read = 0;
            while (read < bytes.Length)
            {
                int n = stream.Read(bytes, read, bytes.Length - read);
                if (n <= 0)
                {
                    throw new IOException("파일을 끝까지 읽지 못했습니다.");
                }
                read += n;
            }

            stream.Position = pos;
            return bytes;
        }

        private static bool HasInvalidColon(string path)
        {
            if (String.IsNullOrEmpty(path))
            {
                return false;
            }

            for (int i = 0; i < path.Length; i++)
            {
                if (path[i] != ':')
                {
                    continue;
                }

                if (i == 1 &&
                    path.Length >= 3 &&
                    ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) &&
                    (path[2] == '\\' || path[2] == '/'))
                {
                    continue;
                }

                return true;
            }

            return false;
        }

        private static bool IsAllowedWritePath(string path, bool allowBackup)
        {
            if (String.IsNullOrEmpty(path) || HasInvalidColon(path))
            {
                return false;
            }

            string name;
            try
            {
                name = Path.GetFileName(path);
            }
            catch
            {
                return false;
            }

            if (String.IsNullOrEmpty(name) || name.IndexOf(':') >= 0)
            {
                return false;
            }

            int dot = name.IndexOf('.');
            string stem = dot >= 0 ? name.Substring(0, dot) : name;
            stem = stem.TrimEnd(' ', '.');
            if (IsReservedDeviceName(stem))
            {
                return false;
            }

            string ext = Path.GetExtension(name);
            if (String.Equals(ext, ".sav", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            if (allowBackup && String.Equals(ext, ".bak", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            return false;
        }

        private static bool IsReservedDeviceName(string stem)
        {
            if (String.IsNullOrEmpty(stem))
            {
                return false;
            }

            string s = stem.TrimEnd(' ', '.').ToUpperInvariant();
            if (s == "CON" || s == "PRN" || s == "AUX" || s == "NUL")
            {
                return true;
            }

            if (s.Length == 4)
            {
                if (s.StartsWith("COM", StringComparison.Ordinal) &&
                    s[3] >= '1' && s[3] <= '9')
                {
                    return true;
                }
                if (s.StartsWith("LPT", StringComparison.Ordinal) &&
                    s[3] >= '1' && s[3] <= '9')
                {
                    return true;
                }
            }

            return false;
        }
    }
}
