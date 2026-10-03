"""Real Chromium Web Audio, with injected interruption/resume failures and lifecycle events.
This checks recovery logic, not physical iPhone interruptions or audible output.
"""
import json,os
from pathlib import Path
from playwright.sync_api import sync_playwright
URL=os.environ.get('TEST_URL','http://localhost:4173')
PROBE=r'''(() => {
 const Native=window.AudioContext;
 window.control={contexts:[],starts:0,resumes:0,suspends:0,mode:'normal',hidden:false,pending:[]};
 Object.defineProperty(document,'hidden',{get:()=>control.hidden});
 window.AudioContext=class extends Native {
  constructor(){super();control.contexts.push(this);this.forcedState=null;}
  get state(){return this.forcedState || super.state;}
  suspend(){control.suspends++;this.forcedState=null;return super.suspend();}
  resume(){
   control.resumes++;
   if(control.mode==='reject')return Promise.reject(new Error('simulated activation required'));
   if(control.mode==='pending')return new Promise(resolve=>control.pending.push(resolve));
   return new Promise(resolve=>setTimeout(resolve,25)).then(()=>super.resume()).then(()=>{control.pending.splice(0).forEach(resolve=>resolve());});
  }
  createOscillator(){const o=super.createOscillator();const start=o.start.bind(o);o.start=t=>{control.starts++;return start(t)};return o;}
 };
 window.background=()=>{control.hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pagehide'));};
 window.foreground=()=>{control.hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));};
})();'''
errors=[];results=[]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
 page=b.new_page(viewport={'width':375,'height':667},is_mobile=True,has_touch=True)
 page.add_init_script(PROBE);page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(URL);page.locator('#ready').click()
 page.locator('[data-card="1"]').tap()
 assert page.evaluate('control.contexts.length')==0
 page.locator('#sound').tap();page.wait_for_function('control.starts===2')
 for i in range(3):
  page.evaluate('background()');page.wait_for_function('control.contexts.at(-1).state==="suspended"')
  before=page.evaluate('control.starts')
  page.evaluate("control.contexts.at(-1).forcedState='interrupted';control.mode='reject';foreground()")
  page.wait_for_timeout(60)
  assert page.locator('#sound').get_attribute('aria-pressed')=='true'
  assert page.evaluate('control.starts')==before
  page.evaluate("control.mode='normal'")
  page.locator(f'[data-card="{2+i}"]').tap()
  page.wait_for_function('(n)=>control.starts===n+2',arg=before)
  assert page.evaluate('control.contexts.length')==1
  assert page.evaluate('control.contexts[0].state')=='running'
 results.append('three background/foreground cycles, interrupted→suspended→running, rejected foreground resumes recover on next tap without toggling')
 page.evaluate("background();control.mode='pending';foreground()")
 page.wait_for_timeout(60)
 before=page.evaluate('control.starts');attempts=page.evaluate('control.resumes')
 page.evaluate("control.mode='normal'");page.locator('[data-card="5"]').tap()
 page.wait_for_function('(n)=>control.starts===n+2',arg=before)
 assert page.evaluate('control.resumes')>attempts
 results.append('pending foreground resume retried in user gesture; no stale sound replay')
 page.evaluate("background();control.mode='pending';foreground()")
 page.wait_for_timeout(60);before=page.evaluate('control.starts')
 page.locator('#sound').tap()
 page.evaluate("control.mode='normal';control.contexts.at(-1).resume()")
 page.wait_for_function('control.contexts.at(-1).state==="suspended"')
 page.evaluate('background();foreground()')
 page.locator('[data-card="1"]').tap()
 assert page.evaluate('control.starts')==before
 assert page.evaluate('localStorage.getItem("last-trump-sound")')=='false'
 results.append('mute wins over in-flight resume; repeated switching and gestures do not unmute')
 page.locator('#sound').tap();page.wait_for_function('control.contexts.at(-1).state==="running"')
 page.evaluate('control.contexts.at(-1).close()');before=page.evaluate('control.starts')
 page.locator('[data-card="2"]').tap();page.wait_for_function('(n)=>control.starts===n+2',arg=before)
 assert page.evaluate('control.contexts.length')==2
 results.append('closed context recreated only on enabled audio input')
 assert page.evaluate('localStorage.getItem("last-trump-campaign")') is None
 b.close()
assert not errors,errors
Path('artifacts/audio-lifecycle-results.json').write_text(json.dumps({'results':results,'page_errors':errors},indent=2))
print(json.dumps({'results':results,'page_errors':errors}))
