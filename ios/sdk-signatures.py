#!/usr/bin/env python3
"""Preserve and verify vendor SDK signatures separately from app code signing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PIN = json.loads((ROOT / 'ios/capacitor-sdk.json').read_text())
NAMES = tuple(PIN['checksums'])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    require(result.returncode == 0, f"{' '.join(map(str, args))}: {result.stderr.strip()}")
    return result.stdout + result.stderr


def check_versions():
    # CLI sync regenerates CapApp-SPM. A new npm version must never silently use
    # old cached binaries, even when they have a perfectly valid vendor signature.
    package = json.loads((ROOT / 'package.json').read_text())
    for name in ('core', 'ios', 'cli'):
        key = f'@capacitor/{name}'
        declared = {**package['dependencies'], **package['devDependencies']}[key]
        installed = json.loads((ROOT / f'node_modules/{key}/package.json').read_text())['version']
        require(declared == installed == PIN['version'],
                f'{key}: declared {declared}, installed {installed}, SDK pin {PIN["version"]}; update ios/capacitor-sdk.json with the upstream checksums')
    manifest = (ROOT / 'ios/App/CapApp-SPM/Package.swift').read_text()
    require(f'exact: "{PIN["version"]}"' in manifest, 'CapApp-SPM version differs from the SDK pin')


def frameworks(directory):
    check_versions()
    hashes = {}
    for name in NAMES:
        sdk = directory / f'{name}.xcframework'
        # Re-signing an embedded .framework with our app identity does not supply
        # the SDK-origin signature that Xcode collects from the outer XCFramework.
        requirement = f'=anchor apple generic and certificate leaf[subject.OU] = "{PIN["team"]}"'
        run('codesign', '--verify', '--strict', '-R', requirement, str(sdk))
        details = run('codesign', '-d', '--verbose=4', str(sdk))
        hashes[name] = {bytes.fromhex(h) for h in re.findall(r'CandidateCDHash (?:sha1|sha256)=([0-9a-f]{40})', details)}
        require(hashes[name], f'{name}: missing SDK code directory hashes')
        privacy = sdk / f'ios-arm64/{name}.framework/PrivacyInfo.xcprivacy'
        plistlib.loads(privacy.read_bytes())
        print(f'{name}: Capacitor {PIN["version"]}, valid vendor signature ({PIN["team"]}), privacy manifest present')
    return hashes


def prepare(destination):
    check_versions()
    destination.mkdir(parents=True, exist_ok=False)
    cache = Path(tempfile.gettempdir()) / 'modriff-capacitor-downloads'
    cache.mkdir(exist_ok=True)
    for name, expected in PIN['checksums'].items():
        archive = cache / f'{name}-{PIN["version"]}.zip'
        if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
            url = f'https://github.com/ionic-team/capacitor-swift-pm/releases/download/{PIN["version"]}/{name}.xcframework.zip'
            fd, download = tempfile.mkstemp(dir=cache, suffix='.zip')
            os.close(fd)
            try:
                run('curl', '-fL', '--retry', '3', '-o', download, url)
                require(hashlib.sha256(Path(download).read_bytes()).hexdigest() == expected,
                        f'{name}: download checksum differs from the pinned upstream Package.swift')
                os.replace(download, archive)
            finally:
                Path(download).unlink(missing_ok=True)
        # Always extract from the checksum-verified zip; never reuse arbitrary
        # DerivedData or an extracted cache whose version cannot be established.
        run('ditto', '-x', '-k', str(archive), str(destination))
    frameworks(destination)


def signature_records(read, hashes):
    for name in NAMES:
        record = plistlib.loads(read(f'Signatures/{name}.xcframework-ios.signature'))
        require(record.get('signed') is True, f'{name}: archive reports an unsigned SDK (ITMS-91065)')
        require(record.get('signatureIdentifier') == PIN['team'], f'{name}: archive SDK signer is not the vendor')
        require(record.get('signatureType') == 'AppleDeveloperProgram', f'{name}: SDK signature is not an Apple developer signature')
        require(record.get('metadata') == {'library': f'{name}.framework', 'platform': 'ios'},
                f'{name}: wrong SDK platform or library')
        require(set(record.get('cdhashes', [])) == hashes[name], f'{name}: SDK signature does not match the pinned artifact')
        require(record.get('certificates'), f'{name}: SDK signing certificates missing')
        print(f'{name}: collected iOS SDK signature matches the pinned vendor artifact')


def archive(directory, sdk):
    hashes = frameworks(sdk)
    signature_records(lambda p: (directory / p).read_bytes(), hashes)
    app = directory / 'Products/Applications/App.app'
    run('codesign', '--verify', '--deep', '--strict', str(app))
    for name in NAMES:
        framework = app / f'Frameworks/{name}.framework'
        run('codesign', '--verify', '--strict', str(framework))
        plistlib.loads((framework / 'PrivacyInfo.xcprivacy').read_bytes())
    print('Archive: app and embedded framework signatures valid')


def ipa(file, sdk, team):
    hashes = frameworks(sdk)
    with zipfile.ZipFile(file) as package, tempfile.TemporaryDirectory(prefix='modriff-ipa-verify-') as tmp:
        signature_records(package.read, hashes)
        # ditto preserves executable modes and symlinks needed by codesign.
        run('ditto', '-x', '-k', str(file), tmp)
        apps = list((Path(tmp) / 'Payload').glob('*.app'))
        require(len(apps) == 1, 'IPA must contain exactly one app')
        app = apps[0]
        run('codesign', '--verify', '--deep', '--strict', str(app))
        for bundle in [app, *app.glob('Frameworks/*.framework'), *app.glob('PlugIns/*.appex')]:
            details = run('codesign', '-d', '--verbose=4', str(bundle))
            require(f'TeamIdentifier={team}\n' in details, f'{bundle.name}: wrong application signing team')
            require('Authority=Apple Distribution:' in details, f'{bundle.name}: not distribution signed')
        entitlements = run('codesign', '-d', '--entitlements', ':-', str(app))
        # codesign diagnostics precede/follow the plist on different Xcode versions.
        start, end = entitlements.index('<?xml'), entitlements.index('</plist>') + len('</plist>')
        require(not plistlib.loads(entitlements[start:end].encode()).get('get-task-allow', False),
                'IPA still has the development get-task-allow entitlement')
        for name in NAMES:
            framework = app / f'Frameworks/{name}.framework'
            require(run('lipo', '-archs', str(framework / name)).strip() == 'arm64', f'{name}: unexpected device architectures')
            plistlib.loads((framework / 'PrivacyInfo.xcprivacy').read_bytes())
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        print(f'IPA verified: {info["CFBundleIdentifier"]} {info["CFBundleShortVersionString"]} build {info["CFBundleVersion"]}, distribution team {team}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('prepare', 'frameworks', 'archive', 'ipa'))
    parser.add_argument('path', type=Path)
    parser.add_argument('--sdk', type=Path)
    parser.add_argument('--team')
    args = parser.parse_args()
    if args.mode in ('archive', 'ipa') and not args.sdk:
        parser.error('--sdk is required for archive and ipa verification')
    if args.mode == 'ipa' and not args.team:
        parser.error('--team is required for IPA verification')
    if args.mode == 'prepare':
        prepare(args.path)
    elif args.mode == 'frameworks':
        frameworks(args.path)
    elif args.mode == 'archive':
        archive(args.path, args.sdk)
    else:
        ipa(args.path, args.sdk, args.team)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, plistlib.InvalidFileException, zipfile.BadZipFile) as error:
        sys.exit(f'error: SDK signature verification failed: {error}')
