#!/usr/bin/env python3
"""Rebuilds plaits/resources.cc and plaits/resources.h from upstream's, dropping the
three data sets whose origin cannot be shown (docs/macro-osc.md, "Left out"):
  - syx_bank_0..2 / fm_patches_table: DX7 factory cartridge patches (six-operator FM engine)
  - lut_lpc_excitation_pulse: the LPC10 speech engine's table
  - wav_integrated_waves / wavetables_table: the wavetable engine's data (no documented origin)
Every other table is computed by upstream's lookup_tables.py (sine, folds, waveshapers,
filters) and stays. Usage: trim-resources.py <upstream plaits dir> <this plaits dir>"""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
DROP = ['syx_bank_0', 'syx_bank_1', 'syx_bank_2', 'fm_patches_table',
        'lut_lpc_excitation_pulse', 'lookup_table_i8_table',
        'wav_integrated_waves', 'wavetables_table']
cc = open(src + '/resources.cc').read()
for name in DROP:
    # a definition: "const <type> name[] = {" ... first line that is exactly "};"
    cc, n = re.subn(r'(?:^//[^\n]*\n)*^const [^\n=]*\b' + name + r'\[\] = \{\n.*?^\};\n', '', cc, flags=re.S | re.M)
    assert n == 1, (name, n)
open(dst + '/resources.cc', 'w').write(cc)
h = open(src + '/resources.h').read()
for name in DROP:
    h, n = re.subn(r'^extern const [^\n]*\b' + name + r'\[\];\n\n?', '', h, flags=re.M)
    assert n == 1, (name, n)
h = re.sub(r'^#define (SYX_BANK_\d|LUT_LPC_EXCITATION_PULSE|WAV_INTEGRATED_WAVES)\w*[^\n]*\n', '', h, flags=re.M)
open(dst + '/resources.h', 'w').write(h)
