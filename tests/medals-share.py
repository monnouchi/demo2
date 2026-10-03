"""Circuit endings, five portraits, medal persistence, and user-invoked local sharing."""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
URL=os.environ.get('TEST_URL','http://localhost:4173')
errors=[];results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
 portraits=set()
 for stage in range(5):
  pg=b.new_page(viewport={'width':320,'height':568},is_mobile=True,has_touch=True)
  pg.add_init_script(f"localStorage.setItem('last-trump-campaign',JSON.stringify({{version:1,stage:{stage},wins:{stage},losses:0,draws:0,clears:0,completed:false}}))")
  pg.goto(URL);pg.locator('#ready').click();portraits.add(pg.locator('#opponent-avatar').inner_html())
  assert pg.locator('#opponent-avatar').get_attribute('aria-label')
  assert pg.evaluate('document.documentElement.scrollWidth<=innerWidth')
  pg.close()
 assert len(portraits)==5
 for theme in ['light','dark']:
  for name,stage,cards,medal,next_stage in [
   ('gold',4,[2,3,4,5,1],'gold',0),('silver',4,[5,1,2,3,4],'silver',0),
   ('bronze',3,[5,1,2,3,4],'bronze',0),('none',2,[5,1,2,3,4],None,0),
   ('draw',4,[1,2,3,4,5],None,4),('advance',1,[2,3,4,5,1],None,2)]:
    pg=b.new_page(viewport={'width':320,'height':568},is_mobile=True,has_touch=True,color_scheme=theme,reduced_motion='reduce',accept_downloads=True)
    pg.on('pageerror',lambda e:errors.append(str(e)))
    pg.add_init_script(f"Math.random=()=>0;if(!localStorage.getItem('last-trump-campaign'))localStorage.setItem('last-trump-campaign',JSON.stringify({{version:1,stage:{stage},wins:{stage},losses:0,draws:0,clears:0,completed:false}}))")
    pg.goto(URL);pg.locator('#ready').click()
    for c in cards[:4]:
      pg.locator(f'[data-card="{c}"]').tap();pg.locator('#action').tap()
      pg.wait_for_function('!document.querySelector("#action").disabled')
    pg.locator('#action').evaluate('(e)=>{for(let i=0;i<12;i++)e.click()}')
    pg.wait_for_function('!document.querySelector("#action").disabled')
    saved=pg.evaluate('JSON.parse(localStorage.getItem("last-trump-campaign"))')
    assert saved['version']==2 and saved['lastResult']['medal']==medal
    assert sum(saved['medals'].values())==(1 if medal else 0)
    assert pg.evaluate('document.documentElement.scrollHeight<=innerHeight')
    if name in ['gold','silver','bronze','none']:assert pg.locator('#completion').is_visible()
    pg.locator('#share-open').tap()
    assert pg.locator('#share-dialog').evaluate('(e)=>e.open')
    text=pg.locator('#share-text').input_value()
    assert text.startswith('Duel Five｜') and 'https://monnouchi.github.io/duel-five/' in text
    with pg.expect_download() as download:pg.locator('#save-image').tap()
    file=download.value
    path=f'artifacts/share-{theme}-{name}.png';file.save_as(path)
    assert Image.open(path).size==(1200,630)
    pg.evaluate("window.shared=[];Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async d=>{window.shared.push({title:d.title,text:d.text,file:d.files[0].name,type:d.files[0].type,size:d.files[0].size,active:navigator.userActivation.isActive})}})")
    pg.locator('#share-image').tap();pg.wait_for_function('shared.length===1')
    shared=pg.evaluate('shared[0]');assert shared['title']=='Duel Five' and shared['type']=='image/png' and shared['size']>10000 and shared['text']==text and shared['active']
    pg.locator('#share-image').evaluate('(e)=>{for(let i=0;i<12;i++)e.click()}')
    pg.wait_for_function('shared.length===2')
    pg.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.copied=t}}})")
    pg.locator('#copy-result').tap();assert pg.evaluate('copied')==text
    pg.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied')}}})")
    pg.locator('#copy-result').tap()
    assert pg.locator('#share-text').evaluate('(e)=>e.selectionStart===0 && e.selectionEnd===e.value.length')
    pg.evaluate("Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('closed','AbortError')}})")
    pg.locator('#share-image').tap();pg.wait_for_function('document.querySelector("#share-status").textContent==="共有を閉じました。"')
    pg.locator('#share-close').tap()
    for _ in range(2):
      pg.reload();assert pg.locator('#completion').is_visible()
      assert pg.evaluate('JSON.parse(localStorage.getItem("last-trump-campaign"))')==saved
    assert pg.locator('#completion-path').inner_text().count('✓')==stage+(1 if name in ['gold','advance'] else 0)
    pg.screenshot(path=f'artifacts/medal-{theme}-{name}.png')
    pg.locator('#action').tap()
    resumed=pg.evaluate('JSON.parse(localStorage.getItem("last-trump-campaign"))')
    assert resumed['stage']==next_stage and resumed['lastResult'] is None and resumed['medals']==saved['medals']
    assert pg.locator('.playing-card:not([disabled])').count()==5
    pg.close();results.append({'theme':theme,'ending':name,'medal':medal,'checks':'once, reload twice, next stage, image download, native share payload, saved scores retained'})
 b.close()
assert not errors,errors
Path('artifacts/medals-share-results.json').write_text(json.dumps({'portraits':len(portraits),'results':results,'page_errors':errors},indent=2))
print(json.dumps({'portraits':len(portraits),'scenarios':len(results),'page_errors':errors}))
