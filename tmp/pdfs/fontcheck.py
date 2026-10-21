from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from pathlib import Path
for family,file in [('Arial','arial.ttf'),('Tahoma','tahoma.ttf'),('Calibri','calibri.ttf'),('Segoe','segoeui.ttf')]:
 p=Path('C:/Windows/Fonts')/file
 if p.exists():
  try:
   pdfmetrics.registerFont(TTFont(family,str(p)))
   c=Canvas(f'tmp/pdfs/font-{family}.pdf'); c.setFont(family,12); c.drawString(40,780,'Український текст: Media Converter, тестування'); c.save()
  except Exception as e: print(family,e)
