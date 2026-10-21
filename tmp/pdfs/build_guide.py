from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image, Flowable, Preformatted, KeepTogether
from reportlab.pdfgen import canvas
from PIL import Image as PILImage

ROOT=Path.cwd(); TMP=ROOT/'tmp'/'pdfs'; OUT=ROOT/'output'/'pdf'/'media-converter-project-guide-uk.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
PAPER=colors.HexColor('#FDF6EC'); BLUE=colors.HexColor('#1C446F'); INK=colors.HexColor('#111D2B'); MUTED=colors.HexColor('#777971'); LINE=colors.HexColor('#D8D2C8'); PALE=colors.HexColor('#F3EBDD')
reg=Path('C:/Windows/Fonts/segoeui.ttf'); bold=Path('C:/Windows/Fonts/segoeuib.ttf')
if reg.exists():
    pdfmetrics.registerFont(TTFont('Segoe',str(reg))); pdfmetrics.registerFont(TTFont('Segoe-Bold',str(bold))); BODY='Segoe'; BOLD='Segoe-Bold'
else: BODY='Helvetica'; BOLD='Helvetica-Bold'
# Crop the live page to its masthead and task selector so the screenshot remains legible.
home=TMP/'01-home.png'
if home.exists():
    im=PILImage.open(home); im.crop((0,0,im.width,min(1120,im.height))).save(TMP/'01-overview-crop.png')

class Pages(canvas.Canvas):
    def __init__(self,*a,**kw): super().__init__(*a,**kw); self.states=[]
    def showPage(self): self.states.append(dict(self.__dict__)); self._startPage()
    def save(self):
        total=len(self.states)
        for state in self.states:
            self.__dict__.update(state)
            if self._pageNumber>1:
                self.setStrokeColor(LINE); self.setLineWidth(.5); self.line(18*mm,17*mm,A4[0]-18*mm,17*mm)
                self.setFillColor(MUTED); self.setFont(BODY,7.5); self.drawString(18*mm,11*mm,'MEDIA CONVERTER  ·  ТЕХНІЧНИЙ ПОСІБНИК'); self.drawRightString(A4[0]-18*mm,11*mm,f'{self._pageNumber} / {total}')
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)
class Diagram(Flowable):
    def __init__(self): super().__init__(); self.width=174*mm; self.height=72*mm
    def draw(self):
        c=self.canv; u=mm
        boxes=[(2,54,28,14,'Браузер','React / REST / SSE'),(38,54,26,14,'Nginx','80 / 443'),(75,61,29,12,'API 1','Express'),(75,44,29,12,'API 2','Express'),(113,59,25,14,'PostgreSQL','Prisma'),(113,39,25,14,'Redis','BullMQ + Pub/Sub'),(147,44,25,19,'Storage','uploads / outputs'),(74,19,30,12,'Worker 1','concurrency 1'),(74,2,30,12,'Worker 2','concurrency 1')]
        for x,y,w,h,t,s in boxes:
            c.setFillColor(PALE if t in ('Браузер','Storage') else colors.white); c.setStrokeColor(BLUE); c.roundRect(x*u,y*u,w*u,h*u,2*u,fill=1,stroke=1)
            c.setFillColor(BLUE); c.setFont(BOLD,7); c.drawCentredString((x+w/2)*u,(y+h-5)*u,t)
            c.setFillColor(MUTED); c.setFont(BODY,5.8); c.drawCentredString((x+w/2)*u,(y+3)*u,s)
        c.setStrokeColor(BLUE); c.setFillColor(BLUE); c.setLineWidth(.8)
        for a,b,d,e in [(30,61,38,61),(64,63,75,67),(64,59,75,50),(104,67,113,66),(104,50,113,46),(104,63,147,57),(104,48,147,50),(113,39,104,25),(113,39,104,8),(104,24,147,57),(104,8,147,49)]:
            c.line(a*u,b*u,d*u,e*u); c.circle(d*u,e*u,.8*u,fill=1,stroke=0)
        c.setFillColor(MUTED); c.setFont(BODY,6); c.drawCentredString(self.width/2,0,'HTTP до API · job/progress через Redis · двосторонній доступ до спільного volume')

ss=getSampleStyleSheet()
ss.add(ParagraphStyle(name='Cover',fontName=BOLD,fontSize=31,leading=36,textColor=BLUE,spaceAfter=5*mm))
ss.add(ParagraphStyle(name='Sub',fontName=BODY,fontSize=14,leading=20,textColor=MUTED,spaceAfter=4*mm))
ss.add(ParagraphStyle(name='H1x',fontName=BOLD,fontSize=19,leading=24,textColor=BLUE,spaceBefore=2*mm,spaceAfter=5*mm,keepWithNext=True))
ss.add(ParagraphStyle(name='H2x',fontName=BOLD,fontSize=12,leading=16,textColor=INK,spaceBefore=3*mm,spaceAfter=1.5*mm,keepWithNext=True))
ss.add(ParagraphStyle(name='Bodyx',fontName=BODY,fontSize=9.2,leading=14,textColor=INK,spaceAfter=2.4*mm))
ss.add(ParagraphStyle(name='Bulletx',fontName=BODY,fontSize=9,leading=13.5,leftIndent=4*mm,firstLineIndent=-3*mm,textColor=INK,spaceAfter=1.4*mm))
ss.add(ParagraphStyle(name='Captionx',fontName=BODY,fontSize=8,leading=11,textColor=MUTED,alignment=1,spaceBefore=1.5*mm,spaceAfter=3*mm))
ss.add(ParagraphStyle(name='Codex',fontName='Courier',fontSize=7.5,leading=10.5,textColor=INK,backColor=PALE,borderPadding=6,spaceBefore=1*mm,spaceAfter=2.5*mm))
ss.add(ParagraphStyle(name='Meta',fontName=BOLD,fontSize=8.5,leading=12,textColor=BLUE,spaceAfter=5*mm))

story=[]; md=(TMP/'guide.md').read_text(encoding='utf-8-sig').splitlines(); codebuf=[]; in_code=False; cover=True
for raw in md:
    line=raw.rstrip()
    if line.startswith('```'):
        if in_code:
            story.append(Preformatted('\n'.join(codebuf),ss['Codex'])); codebuf=[]; in_code=False
        else: in_code=True
        continue
    if in_code: codebuf.append(line); continue
    if not line.strip(): continue
    if line=='DIAGRAM': story.extend([Diagram(),Spacer(1,4*mm)]); continue
    if line=='PAGEBREAK': story.append(PageBreak()); continue
    if line.startswith('IMAGE '):
        data=line[6:]; name,caption=data.split('|',1); f=TMP/name
        if f.exists():
            im=Image(str(f)); scale=min((174*mm)/im.imageWidth,(110*mm)/im.imageHeight); im.drawWidth*=scale; im.drawHeight*=scale
            story += [im,Paragraph(escape(caption),ss['Captionx'])]
        continue
    if line.startswith('# '):
        if not cover: story.append(PageBreak())
        cover=False
        story.append(Paragraph(escape(line[2:]),ss['Cover'] if line[2:]=='MEDIA CONVERTER' else ss['H1x']))
        continue
    if line.startswith('## '):
        txt=line[3:]
        style=ss['Sub'] if txt=='Повний технічний посібник' else ss['H2x']
        story.append(Paragraph(escape(txt),style)); continue
    if line.startswith('- '):
        story.append(Paragraph('• '+escape(line[2:]),ss['Bulletx'])); continue
    story.append(Paragraph(escape(line),ss['Bodyx']))
if in_code and codebuf: story.append(Preformatted('\n'.join(codebuf),ss['Codex']))

def page(c,doc):
    c.saveState(); c.setFillColor(PAPER); c.rect(0,0,A4[0],A4[1],fill=1,stroke=0)
    if doc.page>1:
        c.setFillColor(BLUE); c.setFont(BOLD,7.5); c.drawString(18*mm,A4[1]-10*mm,'MEDIA / CONVERTER  ·  ІНЖЕНЕРНИЙ ОГЛЯД')
    c.restoreState()
doc=SimpleDocTemplate(str(OUT),pagesize=A4,leftMargin=18*mm,rightMargin=18*mm,topMargin=18*mm,bottomMargin=22*mm,title='MEDIA CONVERTER - Повний технічний посібник',author='Codex',subject='Пояснення структури та коду вебзастосунку')
doc.build(story,onFirstPage=page,onLaterPages=page,canvasmaker=Pages)
print(f'Wrote {OUT} ({OUT.stat().st_size:,} bytes, {len(story)} flowables)')


