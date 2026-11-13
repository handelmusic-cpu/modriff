#!/bin/bash
# Fetches Ableton's LinkKit SDK into ios/link/LinkKit/ (gitignored).
#
# Why a script and not a committed framework: the Ableton Link SDK License forbids
# redistributing the SDK, and this repository is public. The SDK is pinned by tag
# and sha256 so every Mac links the same bytes; a new release is a deliberate edit
# of the two lines below.
#
# Running this script is "using LinkKit", which is what accepts Ableton's licence
# (ios/link/LinkKit/License.md after the fetch). The owner said yes on 2026-11-13.
set -euo pipefail

TAG="LinkKit-4.1.3"
SHA256="526be70a4b776c3935f8d8b4054dd44bf2bf68cb384c41b0100fa60608fd53bf"
URL="https://github.com/Ableton/LinkKit/releases/download/${TAG}/LinkKit.zip"

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${HERE}/LinkKit"
STAMP="${DEST}/.fetched"

if [ -f "${STAMP}" ] && [ "$(cat "${STAMP}")" = "${TAG} ${SHA256}" ] && [ -d "${DEST}/LinkKit.xcframework" ]; then
  echo "LinkKit ${TAG} already in ${DEST}"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "downloading ${URL}"
curl -fL --retry 3 -o "${TMP}/LinkKit.zip" "${URL}"

GOT="$(shasum -a 256 "${TMP}/LinkKit.zip" | awk '{print $1}')"
if [ "${GOT}" != "${SHA256}" ]; then
  echo "sha256 mismatch for ${TAG}: expected ${SHA256}, got ${GOT}" >&2
  exit 1
fi

mkdir "${TMP}/x"
unzip -q "${TMP}/LinkKit.zip" -d "${TMP}/x"

# The zip holds one top-level folder with LinkKit.xcframework inside; find it
# rather than trusting the folder name, which has changed between releases.
FW="$(find "${TMP}/x" -maxdepth 3 -name LinkKit.xcframework -type d | head -1)"
if [ -z "${FW}" ]; then
  echo "LinkKit.xcframework not found in the ${TAG} zip" >&2
  exit 1
fi

rm -rf "${DEST}"
mkdir -p "${DEST}"
cp -R "${FW}" "${DEST}/"
for f in License.md LICENSE.md README.md; do
  [ -f "$(dirname "${FW}")/${f}" ] && cp "$(dirname "${FW}")/${f}" "${DEST}/" || true
done
echo "${TAG} ${SHA256}" > "${STAMP}"
echo "LinkKit ${TAG} is in ${DEST}"
