"""Usage: python3 scripts/prepare-cities.py /path/to/cities15000.zip"""
import pathlib
import sys
import unicodedata
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    rows = archive.read('cities15000.txt').decode('utf-8').splitlines()
names = set()
for row in rows:
    fields = row.split('\t')
    for name in [fields[1], fields[2], *fields[3].split(',')]:
        name = unicodedata.normalize('NFC', name.strip().lower())
        if name:
            names.add(name)
output = pathlib.Path(__file__).resolve().parents[1] / 'extension/data/cities.txt'
output.write_text('\n'.join(sorted(names)) + '\n', encoding='utf-8')
print(f'{len(rows)} cities; {len(names)} unique names; {output.stat().st_size} bytes')
