"""Theme, readable contrast samples, compact layouts, and direct next-hand input.
Start npm run preview. Python Playwright + Chromium are test-only dependencies.
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
OUT=Path('artifacts');OUT.mkdir(exist_ok=True)
URL=os.environ.get('TEST_URL','http://localhost:4173')
errors=[];results=[];contrasts=[]
def rgb(s):
    n=[float(x) for x in re.findall(r'[\d.]+',s)]
    return n[:3]
def lum(c):
    a=[x/255 for x in c];a=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in a]
    return sum(x*w for x,w in zip(a,[.2126,.7152,.0722]))
def check_contrast(page,selectors,theme):
    for selector in selectors:
        e=page.locator(selector).first
        if not e.is_visible():continue
        data=e.evaluate('''e=>{const fg=getComputedStyle(e).color;let p=e;
          while(p){const s=getComputedStyle(p);if(s.backgroundImage!=='none')return {fg,bg:s.backgroundImage};
            if(s.backgroundColor!=='rgba(0, 0, 0, 0)')return {fg,bg:s.backgroundColor};p=p.parentElement;}
          return {fg,bg:getComputedStyle(document.body).backgroundColor};}''')
        colors=re.findall(r'rgba?\([^)]*\)',data['bg'])
        ratios=[(max(lum(rgb(data['fg'])),lum(rgb(c)))+.05)/(min(lum(rgb(data['fg'])),lum(rgb(c)))+.05) for c in colors]
        assert ratios and min(ratios)>=4.5,(theme,selector,data,ratios)
        contrasts.append({'theme':theme,'selector':selector,'minimum_ratio':round(min(ratios),2)})
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
    for theme in ['light','dark']:
        for w,h in [(320,568),(375,548),(375,667),(390,664),(390,844),(430,932)]:
            page=browser.new_page(viewport={'width':w,'height':h},is_mobile=True,has_touch=True,color_scheme=theme,reduced_motion='reduce')
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.add_init_script('window.cpuDraws=0;Math.random=()=>{cpuDraws++;return 0};')
            page.goto(URL)
            assert page.locator('html').get_attribute('data-theme')==theme
            assert page.locator('#theme').input_value()=='auto'
            assert page.locator('html').evaluate('(e)=>getComputedStyle(e).colorScheme')==theme
            check_contrast(page,['.quick-rules li','.quick-rules strong','.fair-note','#build-version','#ready'],theme)
            page.locator('#ready').tap()
            for mode in ['light','dark','auto']:
                page.locator('#theme').select_option(mode)
                assert page.locator('html').get_attribute('data-theme')==(theme if mode=='auto' else mode)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
            for sel in ['#theme','#sound','#help']:
                box=page.locator(sel).bounding_box();assert box['width']>=44 and box['height']>=44
                assert box['x']>=0 and box['x']+box['width']<=w
            check_contrast(page,['#message-title','#message-detail','#record','.section-label','.card-name','#theme','#sound','#help'],theme)
            if w==320:page.screenshot(path=str(OUT/f'theme-{theme}-hand.png'))
            assert page.evaluate('cpuDraws')==1
            page.locator('[data-card="1"]').tap()
            check_contrast(page,['.confirm-note','#action'],theme)
            page.locator('#action').tap();page.wait_for_function('!document.querySelector("#action").disabled')
            assert page.locator('#arena').is_visible()
            assert page.evaluate('cpuDraws')==2, 'next CPU card committed before next input'
            assert not page.locator('#action').is_visible()
            check_contrast(page,['#message-title','#message-detail','.history b','.history em'],theme)
            if w==320:page.screenshot(path=str(OUT/f'theme-{theme}-result.png'))
            page.wait_for_timeout(500)
            assert page.locator('#arena').is_visible(), 'result must not auto-dismiss'
            page.locator('[data-card="2"]').tap()
            assert page.locator('[data-card="2"]').get_attribute('aria-pressed')=='true'
            assert not page.locator('#arena').is_visible()
            assert page.evaluate('cpuDraws')==2, 'selection must reuse prior commitment'
            page.locator('[data-card="2"]').evaluate('(e)=>{for(let i=0;i<12;i++)e.click()}')
            assert page.locator('#history li.won').count()==1, 'tap spam cannot commit next round'
            assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
            results.append({'system':theme,'viewport':[w,h],'checks':'auto, all modes, contrast, touch targets, result waits, direct next selection, CPU precommit, spam guard'})
            page.close()
    page=browser.new_page(viewport={'width':320,'height':568},is_mobile=True,has_touch=True,color_scheme='dark')
    page.on('pageerror',lambda e:errors.append(str(e)))
    saved={'version':1,'stage':4,'wins':5,'losses':2,'draws':3,'clears':1,'completed':True}
    page.add_init_script("if(!localStorage.getItem('last-trump-campaign'))localStorage.setItem('last-trump-campaign',"+json.dumps(json.dumps(saved))+");")
    page.goto(URL)
    for mode in ['light','dark']:
        page.locator('#theme').select_option(mode);page.reload()
        assert page.locator('#theme').input_value()==mode
        page.emulate_media(color_scheme='light' if mode=='dark' else 'dark')
        assert page.locator('html').get_attribute('data-theme')==mode
        page.wait_for_timeout(250)
        check_contrast(page,['#completion-title','.completion-story','.completion-path','.completion-end','.completion small','#action'],mode)
        page.screenshot(path=str(OUT/f'theme-{mode}-finale.png'))
        assert page.evaluate('JSON.parse(localStorage.getItem("last-trump-campaign"))')==saved
    page.locator('#theme').select_option('auto')
    for system in ['light','dark','light']:
        page.emulate_media(color_scheme=system)
        page.wait_for_function('(t)=>document.documentElement.dataset.theme===t',arg=system)
        assert page.locator('#theme').input_value()=='auto'
    page.reload();assert page.locator('#theme').input_value()=='auto'
    assert page.locator('#completion').is_visible()
    assert page.evaluate('JSON.parse(localStorage.getItem("last-trump-campaign"))')==saved
    results.append({'preference':'persistence, manual overrides system, Auto follows live changes, completed progress unchanged'})
    page.close()
    for blocked in [True,False]:
        page=browser.new_page(color_scheme='dark')
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})" if blocked else "localStorage.setItem('last-trump-theme','invalid')")
        page.goto(URL);page.locator('#ready').click()
        assert page.locator('html').get_attribute('data-theme')=='dark'
        page.locator('#theme').select_option('light')
        assert page.locator('html').get_attribute('data-theme')=='light'
        page.close()
    results.append({'storage':'blocked or invalid storage falls back to Auto, selection still works'})
    browser.close()
assert not errors,errors
(OUT/'theme-results.json').write_text(json.dumps({'results':results,'contrast_samples':contrasts,'page_errors':errors},indent=2))
print(json.dumps({'scenarios':len(results),'contrast_samples':len(contrasts),'minimum_sampled_contrast':min(c['minimum_ratio'] for c in contrasts),'page_errors':errors}))
