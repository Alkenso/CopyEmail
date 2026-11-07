# Address rule coverage

The Addresses rule contains ten OR regexes. These are broad format families,
not a statistically ranked worldwide “top ten.” Postal conventions vary within
countries; regex recognition does not verify delivery or identify a real street.
The examples below are format fixtures, not verified delivery addresses.

| # | Family | Example |
|---|---|---|
| 1 | US / UK number-first street, optional unit | `123 W Main St Apt 12, Springfield, IL 62704` |
| 2 | Polish bare street + building + postcode | `Dubois 9, 00-182, Śródmieście` |
| 3 | Polish street designator + name + building | `Aleja Rzeczypospolitej 18, 02-972 Wilanów` |
| 4 | Germanic compound street suffix + building | `Friedrichstraße 12, 10117 Berlin` |
| 5 | French building + street designator/name | `10 rue de la Paix, 75002 Paris` |
| 6 | Italian / Iberian designator + name + building | `Via Roma 10/bis, 00100 Roma` |
| 7 | Japanese blocks, native or romanized | `東京都新宿区西新宿2丁目8番1号`; `3-16-4 Wakabayashi` |
| 8 | Chinese / Taiwanese road + numbered premises | `北京市朝阳区建国路88号` |
| 9 | Korean road + building, native or romanized | `서울특별시 종로구 세종대로 209`; `188 Dokseodang-ro` |
| 10 | India / Singapore numbered premises + six-digit postcode | `10 Eunos Road 8, #01-38, Singapore 408600` |

Sources informing the format families:

- [USPS Publication 28](https://pe.usps.com/text/pub28/) describes US address components, suffixes, units and numbering variants.
- [Poczta Polska](https://bip.poczta-polska.pl/bez-kategorii/system-pocztowych-numerow-adresowych-pna/) describes street/building and the Polish postal-code/locality line.
- [Deutsche Post](https://www.deutschepost.de/de/b/briefumschlag-richtig-beschriften.html) and [La Poste](https://www.laposte.fr/outils/tester-une-adresse) provide street/building conventions.
- [Poste Italiane technical specifications](https://business.poste.it/business/files/1476567331803/scheda-tecnica-prodotto-posta-easy-full.pdf) describe street qualifiers and civic numbers.
- [Japan Post](https://www.post.japanpost.jp/service/search/zipcode/zipmanual/p06.html) demonstrates numeric block addresses; [international guidance](https://www.post.japanpost.jp/service/send/oversea/use/label/howto_en.html) describes romanized order.
- [Korea Post road-address search](https://parcel.epost.go.kr/parcel/comm/zipcode/street_zipcode.jsp) documents road-name/building-number lookup.
- [India Post](https://www.indiapost.gov.in/mail%26Parcel/mailproducts/domesticservices/domesticaddressing) and [SingPost](https://www.singpost.com/sites/default/files/2021-10/MailQualityGuide_V202012_RGB_%2024Dec20.pdf) describe address lines, units and six-digit postcodes.
- [W3C international address guidance](https://www.w3.org/International/questions/qa-address-formats.en.html) explains native East Asian ordering. The Chinese road/premises regex is an implementation heuristic, not a postal standard validator.

All ten regexes operate on a single visible text run. Inline HTML is supported;
separate block elements are not joined into a postal address. Compact city/country
labels may be appended from up to five parents using the existing dictionaries.
Bare street names need a Polish postcode, or a recognized designator/suffix;
`Dubois 9` alone remains ambiguous. Coverage excludes many rural, named-building,
PO-box, and country-specific variants. Native-script patterns currently require
Arabic digits and do not cover every local numbering convention.

Within a rule, alternatives are compiled separately to preserve capture-group
and backreference semantics, then merged with leftmost/longest overlap handling.
Across rules, earlier rules retain priority. A rule must have a nonblank name and
at least one valid regex. The UI stores one regex per line and deduplicates exact
alternatives. Saved single-regex rules migrate to a one-item list; unnamed legacy
custom rules receive a generated name, and enabled states are preserved.
