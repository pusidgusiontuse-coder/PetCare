"""Shared forms/calendar regression checks against an isolated demo server."""
import os
import json
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('PETCARE_TEST_URL', 'http://127.0.0.1:8002')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, height in ((1440, 900), (375, 812), (812, 375)):
        context = browser.new_context(viewport={'width':width,'height':height}, reduced_motion='reduce')
        result = context.request.post(BASE + '/api/v1/auth/demo-login/1')
        assert result.ok
        token = result.json()['access_token']
        context.add_init_script('localStorage.setItem("petcare_jwt",' + json.dumps(token) + ')')
        page = context.new_page(); errors=[]; friends_requests=[]
        page.on('request', lambda request: friends_requests.append(request.url) if '/match-' in request.url else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE); page.wait_for_load_state('networkidle')
        page.wait_for_function('state.pets.length > 0')
        page.evaluate('syncServerData(true)')  # Wait for a complete server snapshot.
        for kind in ('pet','pet-edit','health','prescription','weight','activity'):
            page.evaluate('(kind) => openModal(kind)', kind)
            expect(page.locator('#editor')).to_be_visible()
            expect(page.locator('#editor .editor-section').first).to_be_visible()
            assert page.locator('#editor [required]').count() > 0
            page.locator('#editor').screenshot(path=f'/tmp/petcare-{kind}-{width}.png')
            page.locator('#close-editor').click()
        for kind in ('reminder','feeding-log','document','shopping','vet-contact','profile','member','avatar','settings','meal-plan'):
            page.evaluate('(kind) => openExtraModal(kind)', kind)
            expect(page.locator('#editor')).to_be_visible()
            assert page.locator('#editor .editor-section').count() > 0
            assert page.locator('#editor').evaluate('(el) => el.scrollWidth <= el.clientWidth'), kind
            page.locator('#close-editor').click()
        page.evaluate("openModal('weight')")
        date = page.locator('#editor [name=date]')
        date.focus(); page.keyboard.press('Enter')
        expect(page.locator('#temporal-picker')).to_be_visible()
        page.locator('#picker-direct').fill('29.02.2024')
        page.locator('#picker-apply').click()
        expect(date).to_have_value('2024-02-29')
        expect(date).to_be_focused()
        date.click()
        page.locator('#picker-direct').fill('31.02.2024')
        page.locator('#picker-apply').click()
        expect(page.locator('#picker-error')).to_be_visible()
        expect(page.locator('#temporal-picker')).to_be_visible()
        page.locator('#picker-direct').fill('01.03.2024')
        page.locator('#picker-direct').press('Enter')
        page.locator('[data-day="2024-03-01"]').focus()
        page.keyboard.press('ArrowLeft'); page.keyboard.press('Enter')
        page.locator('#picker-apply').click()
        expect(date).to_have_value('2024-02-29')
        page.once('dialog', lambda d:d.accept()); page.locator('#close-editor').click()
        page.evaluate("openExtraModal('reminder')")
        moment = page.locator('#editor [name=at]')
        moment.click()
        page.locator('[data-relative-day="7"]').click()
        page.locator('#picker-apply').click()
        expect(page.locator('#picker-time-panel')).to_be_visible()
        page.locator('#picker-manual-time summary').click()
        page.locator('#picker-hour').fill('25')
        page.locator('#picker-apply').click()
        expect(page.locator('#picker-error')).to_be_visible()
        page.locator('[data-preset-time="19:00"]').click()
        page.locator('#temporal-picker').screenshot(path=f'/tmp/petcare-calendar-time-{width}.png')
        page.locator('#picker-apply').click()
        assert moment.input_value().endswith('T19:00')
        expect(moment).to_be_focused()
        page.once('dialog', lambda d:d.accept()); page.locator('#close-editor').click()
        page.evaluate("show('pets')")
        expect(page.locator('.nav [data-page=match]')).to_be_hidden()
        page.evaluate("show('match')")
        expect(page.locator('#pets.active')).to_be_visible()
        expect(page).to_have_url(BASE + '/#/pets')
        assert page.locator('#match').count() == 1  # Preserved, not removed.
        expect(page.locator('#match')).to_be_hidden()
        page.evaluate("openModal('pet-details')")
        expect(page.locator('[data-card-page=match]')).to_have_count(0)
        page.locator('#close-editor').click()
        if width < 1024:
            button=page.locator('.nav .mobile-pets')
            rect=button.bounding_box()
            assert abs(rect['x']+rect['width']/2-width/2)<2, rect
            assert rect['width'] >= 44 and rect['height'] >= 44, rect
            circle=button.locator('svg').bounding_box()
            assert abs(circle['height']-circle['width'])<1, circle
            assert page.locator('.nav a:visible').count()==5
            page.screenshot(path=f'/tmp/petcare-nav-{width}.png')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        assert not friends_requests, friends_requests
        print(f'All forms and calendar passed at {width}x{height}')
        context.close()
    browser.close()
