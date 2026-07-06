#!/usr/bin/env node
/**
 * Auto-detect GPU and run Tauri with appropriate features
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Get the command (dev or build)
const command = process.argv[2];
if (!command || !['dev', 'build'].includes(command)) {
  console.error('Usage: node tauri-auto.js [dev|build]');
  process.exit(1);
}

// Detect GPU feature
let feature = '';

// Check for environment variable override first
if (process.env.TAURI_GPU_FEATURE) {
  feature = process.env.TAURI_GPU_FEATURE;
  console.log(`🔧 Using forced GPU feature from environment: ${feature}`);
} else {
  try {
    const result = execSync('node scripts/auto-detect-gpu.js', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'inherit']
    });
    feature = result.trim();
  } catch (err) {
    // If detection fails, continue with no features
  }
}

console.log(''); // Empty line for spacing

// Platform-specific environment variables
const platform = os.platform();
const env = { ...process.env };

// CUDA builds (whisper.cpp + llama.cpp compiled via cmake/nvcc) need these CMake flags
// on both Linux and Windows. Defaults below can be overridden by pre-setting the env vars.
if (feature === 'cuda' && (platform === 'linux' || platform === 'win32')) {
  console.log('🚀 CUDA detected: setting CMake flags for NVIDIA GPU build');
  env.CMAKE_CUDA_ARCHITECTURES = env.CMAKE_CUDA_ARCHITECTURES || '75';
  env.CMAKE_CUDA_STANDARD = env.CMAKE_CUDA_STANDARD || '17';
  env.CMAKE_POSITION_INDEPENDENT_CODE = env.CMAKE_POSITION_INDEPENDENT_CODE || 'ON';
  if (platform === 'win32') {
    // CUDA 12.4+/13 CCCL headers abort unless the MSVC host compiler uses its
    // standard-conforming preprocessor.
    env.CMAKE_CUDA_FLAGS = env.CMAKE_CUDA_FLAGS || '-Xcompiler=/Zc:preprocessor';
  }
}

// On Windows, build and stage the llama-helper sidecar here. On Linux/macOS the
// build-gpu.sh / dev-gpu.sh scripts do this before invoking tauri; there is no such
// script on Windows, so `pnpm tauri:build|dev` must handle it to work out of the box.
if (platform === 'win32') {
  buildLlamaHelperSidecar(command, feature, env);
}

// Build the tauri command
let tauriCmd = `tauri ${command}`;
if (feature && feature !== 'none') {
  tauriCmd += ` -- --features ${feature}`;
  console.log(`🚀 Running: tauri ${command} with features: ${feature}`);
} else {
  console.log(`🚀 Running: tauri ${command} (CPU-only mode)`);
}
console.log('');

// Execute the command
try {
  execSync(tauriCmd, { stdio: 'inherit', env });
} catch (err) {
  process.exit(err.status || 1);
}

// Build the llama-helper sidecar and stage it as a Tauri external binary at
// src-tauri/binaries/llama-helper-<target-triple>.exe. Mirrors build-gpu.sh (release)
// and dev-gpu.sh (debug). Windows only; pass the CUDA-aware env so llama.cpp compiles.
function buildLlamaHelperSidecar(command, feature, env) {
  const helperDir = path.resolve(__dirname, '..', '..', 'llama-helper');
  if (!fs.existsSync(helperDir)) {
    console.error(`❌ Could not find llama-helper directory at ${helperDir}`);
    process.exit(1);
  }

  // llama-cpp-2 only supports metal/cuda/vulkan backends; map/skip anything else.
  let llamaFeature = '';
  if (feature === 'cuda' || feature === 'vulkan' || feature === 'metal') {
    llamaFeature = feature;
  } else if (feature === 'coreml') {
    llamaFeature = 'metal'; // llama-cpp-2 has no CoreML backend
  }

  const isRelease = command === 'build';
  const profile = isRelease ? 'release' : 'debug';
  const releaseArg = isRelease ? ' --release' : '';
  const featureArg = llamaFeature ? ` --features ${llamaFeature}` : '';

  console.log(`🦙 Building llama-helper sidecar (${profile}${llamaFeature ? ', ' + llamaFeature : ''})...`);
  try {
    execSync(`cargo build${releaseArg}${featureArg}`, { cwd: helperDir, stdio: 'inherit', env });
  } catch (err) {
    console.error('❌ Failed to build llama-helper sidecar');
    process.exit(err.status || 1);
  }

  const triple = execSync('rustc -vV', { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host:'))
    .split(' ')[1]
    .trim();

  const binariesDir = path.resolve(__dirname, '..', 'src-tauri', 'binaries');
  fs.mkdirSync(binariesDir, { recursive: true });
  for (const f of fs.readdirSync(binariesDir)) {
    if (f.startsWith('llama-helper')) fs.rmSync(path.join(binariesDir, f), { force: true });
  }

  const srcPath = path.resolve(helperDir, '..', 'target', profile, 'llama-helper.exe');
  const destPath = path.join(binariesDir, `llama-helper-${triple}.exe`);
  if (!fs.existsSync(srcPath)) {
    console.error(`❌ Sidecar binary not found at ${srcPath}`);
    process.exit(1);
  }
  fs.copyFileSync(srcPath, destPath);
  console.log(`✅ Staged sidecar -> ${destPath}`);
  console.log('');
}
