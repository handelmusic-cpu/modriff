#!/usr/bin/env python3
"""Regression checks for Xcode's SDK records, including signed=false files."""
import contextlib
import copy
import importlib.util
import io
from pathlib import Path
import plistlib
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('sdk_signatures', Path(__file__).resolve().parents[2] / 'ios/sdk-signatures.py')
sdk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk)


class SignatureRecords(unittest.TestCase):
    def setUp(self):
        self.hashes = {name: {bytes.fromhex('12' * 20), bytes.fromhex('34' * 20)} for name in sdk.NAMES}
        self.records = {
            f'Signatures/{name}.xcframework-ios.signature': {
                'signed': True,
                'signatureIdentifier': sdk.PIN['team'],
                'signatureType': 'AppleDeveloperProgram',
                'metadata': {'library': f'{name}.framework', 'platform': 'ios'},
                'cdhashes': list(self.hashes[name]),
                'certificates': [b'certificate'],
            } for name in sdk.NAMES
        }

    def verify(self):
        with contextlib.redirect_stdout(io.StringIO()):
            sdk.signature_records(lambda path: plistlib.dumps(self.records[path]), self.hashes)

    def test_valid_pair(self):
        self.verify()

    def test_reject_each_invalid_record_even_when_file_exists(self):
        changes = {
            'unsigned': {'signed': False},
            'app_team_instead_of_vendor': {'signatureIdentifier': '6985K934BS'},
            'ad_hoc': {'signatureType': 'AdHoc'},
            'wrong_platform': {'metadata': {'library': 'Capacitor.framework', 'platform': 'maccatalyst'}},
            'wrong_binary': {'cdhashes': [bytes.fromhex('ab' * 20)]},
            'missing_hashes': {'cdhashes': []},
            'missing_certificates': {'certificates': []},
        }
        original = copy.deepcopy(self.records)
        for name in sdk.NAMES:
            for label, values in changes.items():
                with self.subTest(sdk=name, failure=label):
                    self.records = copy.deepcopy(original)
                    self.records[f'Signatures/{name}.xcframework-ios.signature'].update(values)
                    with self.assertRaises(ValueError):
                        self.verify()

    def test_missing_record(self):
        del self.records['Signatures/Cordova.xcframework-ios.signature']
        with self.assertRaises(KeyError):
            self.verify()


if __name__ == '__main__':
    unittest.main()
