City names derived from GeoNames cities15000.zip, downloaded 2026-11-07.
Source: https://download.geonames.org/export/dump/cities15000.zip
Documentation: https://download.geonames.org/export/dump/readme.txt
License: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/
Attribution: GeoNames, https://www.geonames.org/

cities.txt contains primary, ASCII and alternate names (including translations)
from every row in cities15000, normalized to NFC, lowercased, deduplicated and
sorted by Unicode code point. One name per line; no metadata or headers.
This is the cities15000 dataset, not every settlement in the world. Alternate
names include historical names, abbreviations and transliterations.

Regenerate with `python3 scripts/prepare-cities.py /path/to/cities15000.zip`.
