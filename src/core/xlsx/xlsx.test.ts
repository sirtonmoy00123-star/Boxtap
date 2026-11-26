import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildXlsx, colName } from './xlsx';

describe('xlsx writer (Excel export)', () => {
  const file = buildXlsx([
    { name: 'Items', rows: [['Item', 'In stock', 'Price'], ['Gold ring <22K> & "co"', 3, 1299.5], ['সোনার আংটি', 0, null]], widths: [30, 10, 12] },
    { name: 'Sales', rows: [['Date', 'Units'], ['2026-11-26', 2]] },
  ]);
  const zip = unzipSync(file);

  it('is a zip with the parts Excel needs', () => {
    expect(Object.keys(zip).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ].sort());
    expect(strFromU8(zip['xl/workbook.xml']!)).toContain('<sheet name="Items" sheetId="1" r:id="rId1"/>');
  });

  it('writes numbers as numbers and text escaped, Bangla intact', () => {
    const s = strFromU8(zip['xl/worksheets/sheet1.xml']!);
    expect(s).toContain('<c r="B2"><v>3</v></c>');
    expect(s).toContain('<c r="C2"><v>1299.5</v></c>');
    expect(s).toContain('Gold ring &lt;22K&gt; &amp; &quot;co&quot;');
    expect(s).toContain('সোনার আংটি');
    expect(s).not.toContain('r="C3"'); // empty cell left out
    expect(s).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
  });

  it('neutralises text that starts like a formula', () => {
    const z = unzipSync(buildXlsx([{ name: 'X', rows: [['=HYPERLINK("x")']] }]));
    expect(strFromU8(z['xl/worksheets/sheet1.xml']!)).toContain("'=HYPERLINK(&quot;x&quot;)");
  });

  it('names columns past Z and keeps sheet names valid', () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(['A', 'Z', 'AA', 'ZZ']);
    const z = unzipSync(buildXlsx([{ name: 'Sales: Nov/Dec [2026]?*', rows: [] }]));
    expect(strFromU8(z['xl/workbook.xml']!)).toContain('name="Sales Nov Dec 2026"');
  });
});
