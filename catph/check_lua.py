import os
import sys
import shutil

BASE = os.path.dirname(os.path.abspath(__file__))

PATHS = [
    os.environ.get("LUA_EXE") or "",
    os.path.join(BASE, "usr", "bin", "lua51.exe"),
    os.path.join(BASE, "usr", "bin", "lua.exe"),
    os.path.join(BASE, "usr", "bin", "lua5.1"),
    os.path.join(BASE, "usr", "bin", "lua"),
    r"C:\Program Files (x86)\Lua\5.1\lua.exe",
    r"C:\Program Files\Lua\5.1\lua.exe",
    "/usr/local/bin/lua5.1",
    "/usr/bin/lua5.1",
    "/usr/bin/lua5.3",
    "/usr/bin/lua5.4",
    "/usr/bin/lua",
    "/usr/local/bin/lua",
    "/usr/bin/luajit",
]

DLL_NOTE = ("PE/Win32 exe nhung thieu {d} can dat cung thu muc voi file exe"
            .format(d="lua5.1.dll"))


def is_native(path, kind):
    if os.name == "nt":
        return kind == "PE/Win32 exe"
    return kind == "ELF/Linux"


def probe(path):
    if not path:
        return None
    if not os.path.exists(path):
        return f"{path} => MISSING"
    if os.path.isdir(path):
        return f"{path} => IS_A_DIRECTORY"
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            head = f.read(4)
    except Exception as e:
        return f"{path} => UNREADABLE ({type(e).__name__}: {e})"

    if head[:2] == b"MZ":
        kind = "PE/Win32 exe"
    elif head[:4] == b"\x7fELF":
        kind = "ELF/Linux"
    elif head[:1] == b"#":
        kind = "SCRIPT/shebang (khong phai binary)"
    else:
        kind = f"UNKNOWN magic={head!r}"

    note = ""
    if kind == "PE/Win32 exe":
        dll_dir = os.path.dirname(os.path.abspath(path))
        for dll in ("lua5.1.dll", "lua51.dll"):
            if not os.path.isfile(os.path.join(dll_dir, dll)):
                note += f" [THIEU {dll}]"

    ok = is_native(path, kind)
    return f"{path} => {kind} size={size}{note}{'  <- USABLE' if ok else '  <- KHONG DUNG DUOC'}"


def main():
    print(f"os.name={os.name}  platform={sys.platform}")
    print(f"python={sys.executable}")
    print(f"BOT_DIR={BASE}")
    print("-" * 72)

    for p in PATHS:
        line = probe(p)
        if line:
            print(line)

    for name in ("lua5.1", "lua", "lua51", "luajit"):
        p = shutil.which(name)
        if p:
            print(probe(p) + "  [from PATH]")

    print("-" * 72)
    print("Ket luan:")
    if os.name == "nt":
        print("  Host Windows: can file .exe (PE) + 2 file DLL cung thu muc.")
    else:
        print("  Host Linux: can file ELF trong usr/bin/ (lua5.1), KHONG dung .exe.")
    print("  Neu tat ca MISSING -> thu muc usr/ chua duoc upload day du.")


main()
