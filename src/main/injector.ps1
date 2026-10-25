# Injetor de texto: protocolo de linhas em stdin, responde OK / ERR <msg> em stdout.
# Comandos: PING | PASTE | TYPE <base64 utf8>
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class StaInjector {
    // IMPORTANTE: a union precisa conter MOUSEINPUT (o maior membro), senão
    // sizeof(INPUT) = 32 em vez de 40 no x64 e SendInput retorna 0 silenciosamente.
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion u; }

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const ushort VK_CONTROL = 0x11, VK_V = 0x56, VK_RETURN = 0x0D;

    static INPUT Key(ushort vk, ushort scan, uint flags) {
        INPUT i = new INPUT();
        i.type = INPUT_KEYBOARD;
        i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags;
        return i;
    }

    static void Send(INPUT[] inputs) {
        uint n = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        if (n != inputs.Length) throw new Exception("SendInput failed (" + Marshal.GetLastWin32Error() + ", size=" + Marshal.SizeOf(typeof(INPUT)) + ")");
    }

    public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }

    public static void Paste() {
        Send(new INPUT[] {
            Key(VK_CONTROL, 0, 0), Key(VK_V, 0, 0),
            Key(VK_V, 0, KEYEVENTF_KEYUP), Key(VK_CONTROL, 0, KEYEVENTF_KEYUP)
        });
    }

    public static void Type(string text) {
        foreach (char c in text) {
            if (c == '\r') continue;
            if (c == '\n') {
                Send(new INPUT[] { Key(VK_RETURN, 0, 0), Key(VK_RETURN, 0, KEYEVENTF_KEYUP) });
            } else {
                Send(new INPUT[] { Key(0, c, KEYEVENTF_UNICODE), Key(0, c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP) });
            }
            Thread.Sleep(2);
        }
    }
}
'@

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq '') { continue }
    try {
        $sp = $line.IndexOf(' ')
        if ($sp -ge 0) { $cmd = $line.Substring(0, $sp); $arg = $line.Substring($sp + 1) } else { $cmd = $line; $arg = '' }
        switch ($cmd.ToUpperInvariant()) {
            'PING'  { [Console]::Out.WriteLine('OK') }
            'PASTE' { [StaInjector]::Paste(); [Console]::Out.WriteLine('OK') }
            'TYPE'  {
                $text = ''
                if ($arg -ne '') { $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg)) }
                [StaInjector]::Type($text)
                [Console]::Out.WriteLine('OK')
            }
            'SIZE'  { [Console]::Out.WriteLine('OK ' + [StaInjector]::InputSize()) }
            'EXIT'  { [Console]::Out.WriteLine('OK'); [Console]::Out.Flush(); exit 0 }
            default { [Console]::Out.WriteLine('ERR unknown command ' + $cmd) }
        }
    } catch {
        $msg = ($_.Exception.Message -replace '[\r\n]+', ' ')
        [Console]::Out.WriteLine('ERR ' + $msg)
    }
    [Console]::Out.Flush()
}
