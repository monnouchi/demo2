"""Browser audio scheduling regression; measures Web Audio calls, not perceived sound.
Run npm run preview, then python tests/audio.py (Python Playwright + Chromium).
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get('TEST_URL', 'http://localhost:4173')
OUT = Path('artifacts')
OUT.mkdir(exist_ok=True)
PROBE = r'''(() => {
  window.audioNotes = [];
  const Native = window.AudioContext || window.webkitAudioContext;
  window.AudioContext = class extends Native {
    createOscillator() {
      const o = super.createOscillator();
      const note = {created: this.currentTime};
      const set = o.frequency.setValueAtTime.bind(o.frequency);
      o.frequency.setValueAtTime = (v,t) => { note.frequency=v; return set(v,t); };
      const ramp = o.frequency.exponentialRampToValueAtTime.bind(o.frequency);
      o.frequency.exponentialRampToValueAtTime = (v,t) => { note.endFrequency=v; note.end=t; return ramp(v,t); };
      const connect = o.connect.bind(o);
      o.connect = (g) => {
        if (g.gain) {
          note.gainNode = g;
        }
        return connect(g);
      };
      const start = o.start.bind(o);
      o.start = (t) => { note.start=t; note.type=o.type; note.phase=document.querySelector('#arena').className;
        window.audioNotes.push(note); return start(t); };
      const stop = o.stop.bind(o);
      o.stop = (t) => { if(t===undefined) note.cancelled=true; note.stop=t ?? this.currentTime; return stop(t); };
      return o;
    }
    createGain() {
      const g=super.createGain();
      g.recordedEnvelope={};
      const peak=g.gain.linearRampToValueAtTime.bind(g.gain);
      g.gain.linearRampToValueAtTime=(v,t)=>{g.recordedEnvelope.peak=v;g.recordedEnvelope.attackEnd=t;return peak(v,t);};
      return g;
    }
  };
})();'''

def notes(page, phase=None):
    values = page.evaluate('audioNotes.map(({gainNode,...n})=>({...n,...gainNode.recordedEnvelope}))')
    return [n for n in values if phase is None or phase in n['phase']]

def opening(browser, cpu=1, stage=1, sound=True, reduced=True, viewport=None):
    page = browser.new_page(viewport=viewport or {'width':320,'height':568}, is_mobile=True, has_touch=True,
                            reduced_motion='reduce' if reduced else 'no-preference')
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(PROBE)
    page.add_init_script(f'Math.random=()=>{(cpu-1+.1)/5 if cpu!=1 else 0};')
    page.add_init_script(f'''if (!localStorage.getItem('last-trump-campaign')) localStorage.setItem('last-trump-campaign',JSON.stringify({{version:1,stage:{stage},wins:{stage},losses:0,draws:0,clears:0,completed:false}}));''')
    page.goto(URL)
    page.locator('#ready').click()
    if sound: page.locator('#sound').tap()
    return page

def play(page, card):
    page.locator(f'[data-card="{card}"]').tap()
    page.locator('#action').evaluate('(e)=>{for(let i=0;i<12;i++)e.click()}')
    page.wait_for_function('!document.querySelector("#action").disabled')

def outcome(p,c):
    if p==c:return 0
    if (p,c)==(1,5):return 1
    if (p,c)==(5,1):return -1
    return 1 if p>c else -1

errors=[]
report=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox'])
    signatures={}
    for player in range(1,6):
        for cpu in range(1,6):
            page=opening(browser,cpu)
            play(page,player)
            ns=notes(page,'clash')
            result=outcome(player,cpu)
            freq=[n['frequency'] for n in ns]
            if result:
                assert freq[:2]==([660,880] if result>0 else [220,130]), (player,cpu,freq)
                assert min(n['start'] for n in ns[2:])-ns[0]['start']>=.15
                if result<0:
                    assert all(n['endFrequency']<n['frequency'] and n['type']=='triangle' for n in ns[2:])
            else:
                assert freq==[170,1450,2183,3311]
                assert max(n['end']-n['start'] for n in ns)<=.151
                assert max(n['start'] for n in ns)-min(n['start'] for n in ns)<.04
                assert max(n['attackEnd']-n['start'] for n in ns)<=.0021
                assert sum(n['peak'] for n in ns)<.23
            signatures[f'{player}:{cpu}']=[(n['frequency'],n['endFrequency'],n['type']) for n in ns]
            page.close()
    assert signatures['2:4']!=signatures['4:2']
    assert signatures['1:5']!=signatures['5:1']
    report.append({'matchups':25,'checks':'player outcome first; all card textures; both reversals; short fast-attack inharmonic draw; lower combined gain'})

    endings=[('victory',[2,1,4,5,3],[392,494,587,784],1),
             ('defeat',[5,1,2,4,3],[220,165,110],1),
             ('draw',[2,1,3,5,4],[440,622],1),
             ('perfect',[2,3,4,5,1],[392,494,784,1175],1),
             ('swept',[5,1,2,3,4],[220,165,110],1),
             ('mirror',[1,2,3,4,5],[440,622,440,622],1),
             ('champion-perfect',[2,3,4,5,1],[392,523,659,784,1046,523,659,784],4),
             ('champion-normal',[2,1,4,5,3],[392,523,659,784,1046,523,659,784],4)]
    for name,cards,expected,stage in endings:
        page=opening(browser,stage=stage,reduced=name!='champion-normal')
        for i,c in enumerate(cards[:4]):
            play(page,c)
        assert '最終決着' in page.locator('#action').inner_text()
        page.evaluate('audioNotes=[]')
        page.locator('#action').evaluate('(e)=>{for(let i=0;i<12;i++)e.click()}')
        page.wait_for_function('!document.querySelector("#action").disabled')
        final=notes(page,'finished')
        assert [n['frequency'] for n in final]==expected,(name,final)
        round_notes=[n for n in notes(page,'clash') if 'finished' not in n['phase']]
        assert min(n['start'] for n in final)>max(n['stop'] for n in round_notes), name
        if stage==4:
            assert page.locator('#completion').is_visible()
            assert page.locator('#completion-title').inner_text()=='五人制覇'
            assert page.locator('#completion-count').inner_text()=='♛ × 1'
            assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
            page.wait_for_timeout(1200)
            assert page.locator('#action').evaluate('(e)=>getComputedStyle(e).backgroundColor')=='rgba(0, 0, 0, 0)'
            assert len(notes(page,'finished'))==len(expected), 'no second fanfare'
            page.screenshot(path=str(OUT/f'{name}.png'))
            page.reload()
            assert page.locator('#completion').is_visible()
            assert not page.locator('#rules').evaluate('(e)=>e.open')
            assert notes(page)==[], 'reload must not replay the finale'
            assert page.locator('#completion-count').inner_text()=='♛ × 1'
        report.append({'ending':name,'scheduled_notes':len(final),'checks':'one ending cue, automatic fifth, no overlap with round cue, repeated-click lock'})
        page.close()

    page=opening(browser,sound=False)
    for i,c in enumerate([2,3,4,5]):
        play(page,c)
    page.locator('#action').tap()
    page.wait_for_function('!document.querySelector("#action").disabled')
    assert notes(page)==[]
    page.close()
    page=opening(browser,reduced=False)
    # Observe the first clash mutation, then mute in the same browser microtask.
    # Cross-process polling may arrive after a 0.4-second sound has already ended.
    page.evaluate("""() => {
      const arena=document.querySelector('#arena');
      const observer=new MutationObserver(()=>{
        if(arena.classList.contains('clash')) {
          observer.disconnect(); document.querySelector('#sound').click();
        }
      });
      observer.observe(arena,{attributes:true,attributeFilter:['class']});
    }""")
    page.locator('[data-card="4"]').tap();page.locator('#action').tap()
    page.wait_for_selector('#arena.clash')
    assert page.locator('#sound').get_attribute('aria-pressed')=='false' 
    stopped=notes(page,'clash')
    assert any(n.get('cancelled') for n in stopped), 'mute must cancel queued textures'
    count=len(notes(page))
    page.wait_for_timeout(750)
    assert len(notes(page))==count
    page.locator('#sound').tap()
    page.wait_for_function('(n)=>audioNotes.length===n+2',arg=count)
    resumed=notes(page)[count:]
    assert [n['frequency'] for n in resumed] in [[],[520,780]], 'unmute must not replay old voices'
    count=len(notes(page))
    page.locator('[data-card="3"]').tap()
    page.wait_for_function('(n)=>audioNotes.length===n+2',arg=count)
    assert [n['frequency'] for n in notes(page)[count:]]==[520,780], 'new input must sound after unmute'
    page.close()
    report.append({'mute':'whole match and special result silent; in-flight voices cancelled; no replay on unmute'})
    browser.close()
assert not errors,errors
(OUT/'audio-results.json').write_text(json.dumps({'checks':report,'page_errors':errors},indent=2))
print(json.dumps({'checks':report,'page_errors':errors},indent=2))
