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
        page.locator('#help').tap()
        assert page.locator('#rules').evaluate('(e) => e.open')
        page.locator('#ready').tap()
        assert not page.locator('#rules').evaluate('(e) => e.open')
        page.locator('[data-card="1"]').tap()
        assert page.locator('[data-card="1"]').get_attribute('aria-pressed') == 'true'
        page.locator('[data-card="4"]').tap()
        assert page.locator('[data-card="1"]').get_attribute('aria-pressed') == 'false'
        assert page.locator('[data-card="4"]').get_attribute('aria-pressed') == 'true'
        page.locator('#sound').tap()
        assert page.locator('#sound').get_attribute('aria-pressed') == 'true'
        page.reload()
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
             ('draw', 0, [1, 2, 3, 4, 5], '引き分け', True)]
    for name, random_value, cards, expected, reduced in cases:
        match_viewport = {'width': 320, 'height': 568} if reduced else {'width': 375, 'height': 548 if name == 'victory' else 667}
        page = browser.new_page(viewport=match_viewport, is_mobile=True, has_touch=True,
                                reduced_motion='reduce' if reduced else 'no-preference', device_scale_factor=2)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(f'Math.random = () => {random_value};')
        page.goto(URL)
        if name == 'victory':
            page.locator('#sound').tap()
        for index, card in enumerate(cards):
            page.locator(f'[data-card="{card}"]').tap()
            # Same-event-loop click spam tests the synchronous lock.
            page.locator('#action').evaluate('(e) => { for(let i=0;i<12;i++) e.click(); }')
            assert page.locator('#action').is_disabled()
            assert page.locator('.playing-card:not([disabled])').count() == 0
            assert page.locator('#help').is_disabled()
            page.wait_for_selector('#arena.clash')
            assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == index + 1
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
            if index < 4:
                assert page.locator('#hand-hint').inner_text() == '次の戦へ進もう'
                page.locator('#action').tap()
                assert page.locator('#action').is_disabled()
        assert expected in page.locator('#message-detail').inner_text(), page.locator('#message-detail').inner_text()
        assert 'finished' in page.locator('#arena').get_attribute('class')
        assert page.locator('.recap').is_visible()
        assert page.locator('#hand-hint').inner_text() == '合計得点で決着'
        assert page.locator('#hand-title').inner_text() == '5戦の振り返り'
        assert page.locator('.playing-card').count() == 0
        assert page.locator('#history').bounding_box()['y'] + page.locator('#history').bounding_box()['height'] <= match_viewport['height']
        if name == 'defeat':
            assert '相手の1' in page.locator('.recap').inner_text()
        expected_class = {'victory':'match-win','defeat':'match-loss','draw':'match-draw'}[name]
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
        assert page.locator('#player-score').inner_text() == '0'
        assert page.locator('#cpu-score').inner_text() == '0'
        assert page.locator('.playing-card:not([disabled])').count() == 5
        assert page.locator('#hand-title').inner_text() == 'あなたの手札'
        assert page.locator('.recap').count() == 0
        assert page.locator('#history li.won, #history li.lost, #history li.tied').count() == 0
        results.append({'match': name, 'checks': 'five rounds, spam lock, scoring, restart', 'reduced_motion': reduced})
        page.close()

    # Simulated safe-area insets check primary controls remain above the home indicator.
    for width, height in [(390, 844), (390, 664)]:
        page = browser.new_page(viewport={'width': width, 'height': height}, is_mobile=True, has_touch=True)
        page.goto(URL)
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
