"""Dependency-free checks for the static site; no App or database writes."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import json, hashlib, re
PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT / "public"
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
class Page(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path=path; self.ids=set(); self.refs=[]; self.tags=[]; self.stack=[]; self.sections=[]; self.lang=''; self.h1=0; self.main=0; self.text=[]; self.alternates={}
        self.feed(path.read_text()); self.close()
        assert not self.stack, (path,self.stack)
    def handle_starttag(self, tag, pairs):
        a=dict(pairs); self.tags.append(tag)
        assert not any(k.startswith('on') for k in a), (self.path,'inline event')
        assert tag not in ['script','form','iframe','object','embed'], (self.path,'active content')
        if tag not in VOID:self.stack.append(tag)
        if 'id' in a:
            assert a['id'] not in self.ids,(self.path,'duplicate ID',a['id']);self.ids.add(a['id'])
        if tag=='html':self.lang=a.get('lang','')
        if tag=='h1':self.h1+=1
        if tag=='main':self.main+=1
        if tag=='section' and 'id' in a:self.sections.append(a['id'])
        if tag=='img':assert 'alt' in a and 'width' in a and 'height' in a
        for key in ['href','src']:
            if key in a:self.refs.append(a[key])
        if tag=='link' and a.get('rel')=='alternate':self.alternates[a['hreflang']]=a['href']
    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1]==tag,(self.path,'invalid nesting',tag,self.stack[-4:]);self.stack.pop()
    def handle_data(self, data):self.text.append(data)
    def handle_decl(self, decl):assert decl.lower()=='doctype html'
PAGES={}
for path in ROOT.rglob('*.html'):
    p=Page(path);PAGES[path.resolve()]=p
    assert p.lang in ['zh-HK','en'] and p.h1==1 and p.main==1,path
    assert {'header','nav','main','footer','title'}.issubset(set(p.tags)),path
    assert 'SUPPORT_EMAIL_REQUIRED' not in ''.join(p.text)
    assert 'lenny996@163.com' in ''.join(p.text)
for path,p in PAGES.items():
    for ref in p.refs:
        u=urlsplit(ref)
        if u.scheme:
            assert u.scheme in ['https','mailto'],(path,ref)
            if u.scheme=='mailto':assert u.path=='lenny996@163.com'
            continue
        target=(ROOT/unquote(u.path).lstrip('/')) if u.path else path
        if target.is_dir():target=target/'index.html'
        assert target.is_file(),(path,'broken reference',ref)
        if u.fragment:assert unquote(u.fragment) in PAGES[target.resolve()].ids,(path,ref)
for route in ['privacy','support']:
    zh=PAGES[(ROOT/route/'index.html').resolve()];en=PAGES[(ROOT/'en'/route/'index.html').resolve()]
    assert zh.sections==en.sections,(route,'bilingual sections differ')
    assert zh.alternates['en']==f'/en/{route}/' and en.alternates['zh-HK']==f'/{route}/'
    for value in ['Apple','Pro','PNG','SHA-256'] if route=='privacy' else ['15','256','512','HKD','Apple','PNG']:
        assert value in ''.join(zh.text) and value in ''.join(en.text),(route,value)
config=json.loads((PROJECT/'vercel.json').read_text())
assert config['framework'] is None and config['buildCommand']=='' and config['installCommand']=='' and config['outputDirectory']=='public' and config['trailingSlash'] is True
assert not any(k in config for k in ['functions','rewrites','crons','env'])
headers={h['key']:h['value'] for h in config['headers'][0]['headers']}
assert "script-src 'none'" in headers['Content-Security-Policy'] and "connect-src 'none'" in headers['Content-Security-Policy']
css=(ROOT/'styles.css').read_text();assert '@media(max-width:620px)' in css and '@media(max-width:860px)' in css
assert 'https://' not in css and '@import' not in css
assert hashlib.sha256((ROOT/'assets/app-icon.png').read_bytes()).digest()==hashlib.sha256((PROJECT.parent/'assets/branding/app-icon.png').read_bytes()).digest()
assert {'README.md','AUDIT.md','verify.py'}.issubset(set((PROJECT/'.vercelignore').read_text().splitlines()))
print(f'PASS: {len(PAGES)} HTML pages; semantic structure, local links/fragments, language counterparts, contact email, paired content sections, static Vercel settings, no active scripts/forms, and unchanged icon.')
print('Browser layout and cloud routing/headers must be checked separately; no deployment is performed.')
