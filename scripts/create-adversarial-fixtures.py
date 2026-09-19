"""Create image-only, unfamiliar-layout, and malformed PDFs without client data."""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('output_dir',type=Path)
args=parser.parse_args();args.output_dir.mkdir(parents=True,exist_ok=True)
font=None
for name in ['/System/Library/Fonts/Supplemental/Arial.ttf','DejaVuSans.ttf']:
    try:font=ImageFont.truetype(name,36);break
    except OSError:pass
if font is None:raise SystemExit('Install Arial or DejaVuSans for legible OCR fixture generation')
lines=[
 ['Subject Property','Unexpected Layout Apartments','47 Synthetic Lane','Exampleville, Arizona','117 Units','Built 1998','Source validation token: LANTERN-7319'],
 ['Demographics','DEMOGRAPHIC SUMMARY','Population   3 Mile   1 Mile   5 Mile','2026 Population   9000   1000   20000','Median Household Income   $83,210   $65,000   $95,000','A previously unknown field: solar capacity 317 kW.'],
]
pages=[]
for content in lines:
    page=Image.new('RGB',(1700,2200),'white');draw=ImageDraw.Draw(page)
    for index,line in enumerate(content):draw.text((100,120+110*index),line,font=font,fill='black')
    pages.append(page)
pages[0].save(args.output_dir/'scanned-unfamiliar-report.pdf',save_all=True,append_images=pages[1:],resolution=150)
(args.output_dir/'malformed.pdf').write_bytes(b'%PDF-1.7\nTHIS IS NOT A VALID PDF')
print(args.output_dir.resolve())
