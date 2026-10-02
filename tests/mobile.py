"""Mobile interaction regression. Requires Python Playwright and a browser.
Start npm run preview first. CHROMIUM_PATH overrides the system Chromium path.
BROWSER=webkit uses an installed Playwright WebKit browser (no iPhone claim).
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path('artifacts')
OUT.mkdir(exist_ok=True)
URL = os.environ.get('TEST_URL', 'http://localhost:4173')
errors = []
results = []
with sync_playwright() as p:
    engine = os.environ.get('BROWSER', 'chromium')
    options = {'headless': True}
    if engine == 'chromium':
        options.update(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), args=['--no-sandbox'])
    browser = getattr(p, engine).launch(**options)
    for width, height in [(320, 568), (375, 548), (375, 667), (390, 664), (390, 844), (430, 932)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True, device_scale_factor=2)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(URL)
        assert page.locator('#rules').evaluate('(e) => e.open')
        assert page.locator('#rules').evaluate('(e) => e.scrollTop') == 0
        if width == 320:
            page.screenshot(path=str(OUT / 'rules-small.png'))
        page.locator('#ready').click()
        page.wait_for_selector('.playing-card')
        geometry = page.evaluate('''() => ({width: innerWidth, height: innerHeight,
          scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
          actionBottom: document.querySelector('#action').getBoundingClientRect().bottom,
          historyBottom: document.querySelector('#history').getBoundingClientRect().bottom,
          cardWidth: document.querySelector('.playing-card').getBoundingClientRect().width})''')
        assert geometry['scrollWidth'] <= width, geometry
        assert geometry['scrollHeight'] <= height, geometry
        assert geometry['actionBottom'] <= height, geometry
        assert geometry['historyBottom'] <= height, geometry
        assert geometry['cardWidth'] >= 44, geometry
        assert page.locator('#action').is_disabled()
        assert not page.locator('#arena').is_visible()
        assert not page.locator('.opponent').is_visible()
        page.locator('#help').tap()
        assert page.locator('#rules').evaluate('(e) => e.open')
        page.locator('#ready').tap()
        assert not page.locator('#rules').evaluate('(e) => e.open')
        page.locator('[data-card="1"]').tap()
        assert page.locator('[data-card="1"]').get_attribute('aria-pressed') == 'true'
        page.locator('[data-card="4"]').tap()
        assert page.locator('[data-card="1"]').get_attribute('aria-pressed') == 'false'
        assert page.locator('[data-card="4"]').get_attribute('aria-pressed') == 'true'
        box=page.locator('#action').bounding_box()
        assert box['y'] + box['height'] <= height
        assert page.locator('.confirm-note').is_visible()
        page.locator('#sound').tap()
        assert page.locator('#sound').get_attribute('aria-pressed') == 'true'
        page.reload()
        page.locator('#ready').click()
        assert page.locator('#sound').get_attribute('aria-pressed') == 'true'
        page.locator('#sound').tap()
        assert page.locator('#sound').get_attribute('aria-pressed') == 'false'
        assert page.locator('body').evaluate('(e) => getComputedStyle(e).userSelect') == 'none'
        if (width, height) in [(320, 568), (375, 667), (390, 844)]:
            page.screenshot(path=str(OUT / f'{engine}-{width}x{height}.png'))
        results.append({'viewport': [width, height], 'geometry': geometry, 'checks': 'layout, selection, modal, sound persistence'})
        page.close()

    # Known outcomes through deterministic random input; no production testing hook.
    cases = [('victory', 0, [2, 3, 4, 5, 1], 'あなたの勝利', False),
             ('defeat', .999999, [1, 4, 3, 2, 5], 'CPUの勝利', False),
             ('draw', 0, [1, 2, 3, 4, 5], '引き分け', True),
             ('swept', 0, [5, 1, 2, 3, 4], 'CPUの勝利', False)]
    for name, random_value, cards, expected, reduced in cases:
        match_viewport = {'width': 320, 'height': 568} if reduced else {'width': 375, 'height': 548 if name == 'victory' else 667}
        page = browser.new_page(viewport=match_viewport, is_mobile=True, has_touch=True,
                                reduced_motion='reduce' if reduced else 'no-preference', device_scale_factor=2)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(f'Math.random = () => {random_value};')
        page.add_init_script("if (!localStorage.getItem('last-trump-campaign')) localStorage.setItem('last-trump-campaign', JSON.stringify({version:1,stage:1,wins:1,losses:0,draws:0,clears:0,completed:false}));")
        page.goto(URL)
        assert page.locator('#rules').evaluate('(e) => e.open')
        page.locator('#ready').click()
        if name == 'victory':
            page.locator('#sound').tap()
        for index, card in enumerate(cards[:4]):
            page.locator(f'[data-card="{card}"]').tap()
            assert not page.locator('#arena').is_visible()
            box=page.locator('#action').bounding_box()
            assert box['y'] + box['height'] <= match_viewport['height']
            # Same-event-loop click spam tests the synchronous lock.
            if index % 2 == 0:
                page.locator(f'[data-card="{card}"]').evaluate('(e) => { for(let i=0;i<12;i++) e.click(); }')
                assert not page.locator('#arena').is_visible(), 'rapid duplicate taps must not commit'
                page.wait_for_timeout(470)
                page.locator(f'[data-card="{card}"]').tap()
            else:
                page.locator('#action').evaluate('(e) => { for(let i=0;i<12;i++) e.click(); }')
            assert page.locator('#action').is_disabled()
            assert page.locator('.playing-card:not([disabled])').count() == 0
            assert page.locator('#help').is_disabled()
            page.wait_for_selector('#arena.clash')
            if name in ['victory', 'swept']:
                winner = card if name == 'victory' else index + 1
                effect = page.locator('#card-effect')
                assert f'card-{winner}' in effect.get_attribute('class')
                assert ('effect-player' if name == 'victory' else 'effect-cpu') in effect.get_attribute('class')
                assert effect.locator('.effect-symbol').count() == 1
            if reduced:
                assert page.locator('#card-effect > *').count() == 0
            page.wait_for_function('(n) => document.querySelectorAll("#history li.won, #history li.lost, #history li.tied").length === n', arg=index + 1)
            assert '操作ロック' in page.locator('#hand-hint').inner_text()
            assert page.locator('.playing-card.selected').count() == 0
            if name == 'defeat' and index == 0:
                page.wait_for_timeout(100)
                page.screenshot(path=str(OUT / 'reversal.png'))
                assert 'reversal' in page.locator('#arena').get_attribute('class')
                assert page.evaluate('document.documentElement.scrollWidth === innerWidth')
            page.wait_for_function('!document.querySelector("#action").disabled')
            assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == index + 1
            assert page.evaluate('scrollX === 0 && scrollY === 0')
            assert page.locator('#action').bounding_box()['y'] + page.locator('#action').bounding_box()['height'] <= match_viewport['height']
            if index < 3:
                assert '次のラウンドへ' in page.locator('#hand-hint').inner_text()
                page.locator('#action').tap()
                assert page.locator('#action').is_disabled()
        assert '最終決着' in page.locator('#action').inner_text()
        assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == 4
        page.wait_for_timeout(200)
        assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == 4, 'round four result must wait for the player'
        page.locator('#action').evaluate('(e) => { for(let i=0;i<12;i++) e.click(); }')
        assert page.locator('#action').is_disabled()
        assert page.locator('.playing-card:not([disabled])').count() == 0
        page.wait_for_selector('#arena.clash')
        if name in ['victory', 'swept']:
            winner = cards[4] if name == 'victory' else 5
            assert f'card-{winner}' in page.locator('#card-effect').get_attribute('class')
        page.wait_for_selector('#arena.finished', state='attached')
        assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == 5
        saved = page.evaluate('JSON.parse(localStorage.getItem("last-trump-campaign"))')
        assert saved['wins'] + saved['losses'] + saved['draws'] == 2
        if name in ['victory', 'draw', 'swept']:
            expected_sweep = {'victory':'perfect', 'draw':'mirror', 'swept':'swept'}[name]
            assert f'sweep-{expected_sweep}' in page.locator('#arena').get_attribute('class')
        assert expected in page.locator('#message-title').inner_text(), page.locator('#message-title').inner_text()
        assert 'finished' in page.locator('#arena').get_attribute('class')
        assert page.locator('.recap').is_visible()
        assert page.locator('#hand-hint').inner_text() == '勝ち数ではなく合計点'
        assert page.locator('#hand-title').inner_text() == '合計点の内訳'
        assert page.locator('.playing-card').count() == 0
        assert page.locator('#history').bounding_box()['y'] + page.locator('#history').bounding_box()['height'] <= match_viewport['height']
        if name == 'defeat':
            assert 'あなた 1 = 1点 ／ CPU 2 = 2点' in page.locator('.recap').inner_text()
        expected_class = {'victory':'match-win','defeat':'match-loss','draw':'match-draw','swept':'match-loss'}[name]
        assert expected_class in page.locator('#arena').get_attribute('class')
        assert page.locator('.brand').evaluate('(e) => e.tagName') == 'DIV'
        page.locator('.brand').tap()
        assert 'finished' in page.locator('#arena').get_attribute('class')
        if reduced:
            assert page.locator('.fx i').count() == 0
            assert page.locator('#player-stage').evaluate('(e) => getComputedStyle(e).animationName') == 'none'
        page.wait_for_timeout(0 if reduced else 900)
        page.screenshot(path=str(OUT / f'{name}.png'))
        page.locator('#action').tap()
        assert ('中堅' if name == 'victory' else '次鋒') in page.locator('#opponent-name').inner_text()
        assert page.locator('#player-score').inner_text() == '0'
        assert page.locator('#cpu-score').inner_text() == '0'
        assert page.locator('.playing-card:not([disabled])').count() == 5
        assert page.locator('#hand-title').inner_text() == 'あなたの手札'
        assert page.locator('.recap').count() == 0
        assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == 0
        results.append({'match': name, 'checks': 'five rounds, spam lock, scoring, restart', 'reduced_motion': reduced})
        page.close()

    page = browser.new_page(viewport={'width': 375, 'height': 548}, is_mobile=True, has_touch=True, reduced_motion='reduce')
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('Math.random = () => 0;')
    page.goto(URL)
    page.locator('#ready').tap()
    for stage, opponent in enumerate(['先鋒','次鋒','中堅','副将','大将']):
        assert f'{stage+1}/5：{opponent}' in page.locator('#opponent-name').inner_text()
        cards = [1,5,3,2,4] if stage == 0 else [2,3,4,5,1]
        for r, card in enumerate(cards[:4]):
            page.locator(f'[data-card="{card}"]').tap()
            page.locator('#action').tap()
            page.wait_for_function('!document.querySelector("#action").disabled')
            if r < 3: page.locator('#action').tap()
        assert '最終決着' in page.locator('#action').inner_text()
        page.locator('#action').tap()
        page.wait_for_selector('#arena.finished', state='attached')
        assert f'通算{stage+1}試合' in page.locator('#record').inner_text()
        if stage < 4: page.locator('#action').tap()
    assert '5人勝ち抜き達成' in page.locator('#message-kicker').inner_text()
    assert '任意' in page.locator('#action').inner_text()
    assert page.locator('#completion').is_visible()
    assert '♛ × 1' in page.locator('#completion-count').inner_text()
    assert page.locator('#completion-title').evaluate('(e) => e === document.activeElement')
    assert page.locator('#action').bounding_box()['y'] + page.locator('#action').bounding_box()['height'] <= 548
    page.screenshot(path=str(OUT / 'campaign-clear.png'))
    page.reload()
    assert not page.locator('#rules').evaluate('(e) => e.open')
    assert page.locator('#completion').is_visible()
    assert '五人制覇' in page.locator('#completion-title').inner_text()
    assert 'celebrate' not in page.locator('#completion').get_attribute('class')
    assert '通算5試合' in page.locator('#record').inner_text()
    page.locator('#action').tap()
    assert '1/5：先鋒' in page.locator('#opponent-name').inner_text()
    assert not page.locator('#completion').is_visible()
    assert '五人制覇 1回' in page.locator('#crown-record').inner_text()
    assert '通算5試合' in page.locator('#record').inner_text()
    results.append({'campaign': 'all five opponents, auto final round, completion, persistence, next circuit'})
    page.close()

    # A saved crown must not add a row that pushes compact match controls offscreen.
    for width, height in [(320,568),(375,548),(390,664)]:
        page=browser.new_page(viewport={'width':width,'height':height},is_mobile=True,has_touch=True,reduced_motion='reduce')
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script("Math.random=()=>0;localStorage.setItem('last-trump-campaign',JSON.stringify({version:1,stage:1,wins:6,losses:0,draws:0,clears:1,completed:false}));")
        page.goto(URL)
        page.locator('#ready').click()
        for i,card in enumerate([2,3,4,5]):
            page.locator(f'[data-card="{card}"]').tap()
            page.locator('#action').tap()
            page.wait_for_function('!document.querySelector("#action").disabled')
            assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
            if i<3: page.locator('#action').tap()
        page.locator('#action').tap()
        page.wait_for_function('!document.querySelector("#action").disabled')
        assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
        assert page.locator('#crown-record').is_visible()
        results.append({'saved_crown_viewport':[width,height],'checks':'all rounds and final result remain within viewport'})
        page.close()

    # Simulated safe-area insets check primary controls remain above the home indicator.
    for width, height in [(390, 844), (390, 664)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        page.goto(URL)
        assert page.locator('#rules').evaluate('(e) => e.open')
        page.locator('#ready').click()
        page.add_style_tag(content='.app { --safe-top: 47px; --safe-bottom: 34px; }')
        assert page.locator('.topbar').bounding_box()['y'] >= 47
        box = page.locator('#action').bounding_box()
        assert box['y'] + box['height'] <= height - 34
        results.append({'safe_area': [width, height], 'checks': 'primary controls within simulated notch and home indicator'})
        page.close()

    # Keyboard focus, dialog escape, and unavailable localStorage.
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });")
    page.goto(URL)
    page.locator('#ready').click()
    page.locator('#help').click()
    page.keyboard.press('Escape')
    assert not page.locator('#rules').evaluate('(e) => e.open')
    page.locator('[data-card="2"]').focus()
    page.keyboard.press('Enter')
    assert page.locator('[data-card="2"]').get_attribute('aria-pressed') == 'true'
    assert page.locator('[data-card="2"]').evaluate('(e) => e === document.activeElement')
    page.locator('#sound').click()
    assert page.locator('#sound').get_attribute('aria-pressed') == 'true'
    page.screenshot(path=str(OUT / 'desktop.png'))
    results.append({'desktop': 'keyboard, focus preservation, Escape, storage blocked'})
    assert not errors, errors
    browser.close()
(OUT / 'mobile-results.json').write_text(json.dumps({'engine': engine, 'results': results, 'page_errors': errors}, indent=2), encoding='utf-8')
print(json.dumps({'engine': engine, 'checks': len(results), 'page_errors': errors, 'results': results}, indent=2))
