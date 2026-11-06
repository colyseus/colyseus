#!/bin/bash
# Builds the tunnel agent into each platform package (npm/<platform>/bin/)
# from a routez checkout: ROUTEZ=../routez scripts/build-agents.sh
#
# Linux builds are static (musl), for glibc and Alpine alike. x86_64 needs
# AES-NI and PCLMUL (CPUs since 2010); arm64 assumes no crypto extensions,
# which a Raspberry Pi 4 lacks.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
ROUTEZ=$(cd "${ROUTEZ:?set ROUTEZ to a routez checkout}" && pwd)

build() {
    local dir=$1 target=$2 cpu=$3 out exe=routez-tunnel-agent
    [[ $target == *windows* ]] && exe=routez-tunnel-agent.exe
    out=$(mktemp -d)
    (cd "$ROUTEZ" && zig build tunnel-agent -Dtarget="$target" -Dcpu="$cpu" -Doptimize=ReleaseSafe -Dstrip -p "$out")
    mkdir -p "$here/npm/$dir/bin"
    mv "$out/bin/$exe" "$here/npm/$dir/bin/"
    rm -rf "$out"
    echo "$dir: $(wc -c < "$here/npm/$dir/bin/$exe") bytes"
}

build darwin-arm64 aarch64-macos apple_m1
build darwin-x64 x86_64-macos x86_64_v2+aes+pclmul
build linux-arm64 aarch64-linux-musl baseline
build linux-x64 x86_64-linux-musl x86_64_v2+aes+pclmul
build win32-x64 x86_64-windows x86_64_v2+aes+pclmul
