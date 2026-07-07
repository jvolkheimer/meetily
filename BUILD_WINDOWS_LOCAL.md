# Building & Running Meetily Locally (Windows + CUDA)

Personal cheat-sheet for building this fork on Windows with NVIDIA CUDA acceleration.
For the general/upstream guide see [docs/BUILDING.md](docs/BUILDING.md).

## Prerequisites (one-time)

- **Node.js** + **pnpm**
- **Rust** (rustup, MSVC toolchain)
- **CMake**
- **Visual Studio Build Tools 2022** with the "Desktop development with C++" workload
- **NVIDIA CUDA Toolkit** (so `nvcc` is on `PATH` and `CUDA_PATH` is set)
- **libclang ≤ 18** — only needed for a *clean* rebuild of `whisper.cpp` (see caveat below)

First checkout also needs the submodule:

```powershell
git submodule update --init --recursive   # pulls backend/whisper.cpp
```

## Run the app (no compile)

Launch from **File Explorer** (double-click) or a **normal** terminal so it inherits the machine
`PATH` (which has the CUDA runtime DLLs in `...\CUDA\vXX.X\bin\x64`):

```powershell
& "$PSScriptRoot\target\release\meetily.exe"
# or the absolute path:
# & "C:\Users\jvolk\OneDrive\Documents\coding projects\meetily\target\release\meetily.exe"
```

## Compile

Work from the `frontend` folder, and **close the running app first** — a running `meetily.exe`
locks the binary and the final link step fails:

```powershell
cd "C:\Users\jvolk\OneDrive\Documents\coding projects\meetily\frontend"
```

### Dev mode (best for iterating — hot reload, no installer)

```powershell
pnpm install        # first time only
pnpm tauri:dev
```

### Production build (produces target\release\meetily.exe + installers)

```powershell
pnpm tauri:build
```

### Fast production exe (skips the installer bundler)

Best when you just want the runnable app after a code change. Rebuilds the embedded frontend and
relinks the binary without the (occasionally flaky/slow) MSI/NSIS bundling step:

```powershell
pnpm build
cargo build --release --features cuda --manifest-path src-tauri/Cargo.toml
# result: ..\target\release\meetily.exe
```

## Caveats specific to this setup

- **Use a fresh terminal.** A newly opened PowerShell picks up `cargo`, `nvcc`, `cmake`, and
  `CUDA_PATH` from the machine environment automatically. The required GPU CMake flags
  (`CMAKE_CUDA_ARCHITECTURES`, `CMAKE_CUDA_STANDARD`, `-Xcompiler=/Zc:preprocessor`, …) are set for
  you by `frontend/scripts/tauri-auto.js` on Windows — you don't set them manually.
- **libclang only matters for a clean whisper rebuild.** `whisper.cpp` is already compiled and
  cached in `target`, so normal incremental builds never touch it. If you ever `cargo clean`,
  install **libclang 18** and set `LIBCLANG_PATH` to its `bin`/`native` folder *before* building —
  the newest LLVM (22) breaks `whisper-rs-sys`'s old `bindgen` (produces opaque bindings). A
  no-admin way to get libclang 18:
  ```powershell
  pip install "libclang==18.1.1" --target C:\tools\libclang18
  $env:LIBCLANG_PATH = "C:\tools\libclang18\clang\native"
  ```
- **Don't judge a build as "hung" from console silence.** The `meetily` crate has a multi-minute
  *silent* optimization/codegen phase where `rustc` pins several cores but prints nothing. That's
  normal — wait for it. (Check `rustc` CPU is climbing if unsure.)
- **Build output is kept off OneDrive** via a directory junction so OneDrive's filesystem filter
  driver can't stall build writes:
  `...\meetily\target`  →  `C:\Users\jvolk\meetily-build\target`.
  It's transparent to cargo/tauri; leave it in place. Recreate it if needed:
  ```powershell
  # from an empty/removed target:
  cmd /c mklink /J "C:\Users\jvolk\OneDrive\Documents\coding projects\meetily\target" "C:\Users\jvolk\meetily-build\target"
  ```
- **GPU backend**: this fork builds with `--features cuda`. To target your exact GPU, override the
  arch once (RTX 40-series = compute 8.9): `$env:CMAKE_CUDA_ARCHITECTURES = "89"` before building.

## Meetily-specific commands (reference)

- `pnpm tauri:dev` / `pnpm tauri:build` → `node scripts/tauri-auto.js dev|build` (auto-detects GPU,
  builds the `llama-helper` sidecar, stages it, sets CUDA flags, runs Tauri).
- Preferences (Auto Record, timeout, notification toggle, etc.) live in `%APPDATA%\Meetily\`.
