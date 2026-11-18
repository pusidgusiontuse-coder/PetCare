"""Time wheels: scroll, keyboard, manual input, presets, cancel and reopen."""
import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
BASE=os.environ.get('PETCARE_TEST_URL','http://127.0.0.1:8002')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width,height in ((1440,900),(375,812),(812,375)):
        context=browser.new_context(viewport={'width':width,'height':height},has_touch=True,is_mobile=width < 1024,reduced_motion='reduce')
        result=context.request.post(BASE+'/api/v1/auth/demo-login/1');assert result.ok
        context.add_init_script("window.__PETCARE_TEST__=true;")
        context.add_init_script('localStorage.setItem("petcare_jwt",'+json.dumps(result.json()['access_token'])+')')
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE);page.wait_for_load_state('networkidle');page.wait_for_function('() => state.pets.length > 0')
        page.evaluate('syncServerData(true)')  # Wait for a complete server snapshot.
        page.evaluate("openExtraModal('reminder')")
        source=page.locator('#editor [name=at]');original=source.input_value()
        source.click()
        # Selecting a day opens the two-column wheel view immediately.
        page.locator('#picker-calendar [aria-selected=true]').click()
        expect(page.locator('#picker-time-panel')).to_be_visible()
        hours=page.get_by_role('listbox',name='Часы',exact=True)
        minutes=page.get_by_role('listbox',name='Минуты',exact=True)
        expect(hours).to_be_focused()
        hours.evaluate('(el) => el.scrollTop=14*44')
        expect(page.locator('#picker-hour')).to_have_value('14')
        minutes.evaluate('(el) => el.scrollTop=37*44')
        expect(page.locator('#picker-minute')).to_have_value('37')
        expect(hours.locator('[aria-selected=true]')).to_have_text('14')
        expect(minutes.locator('[aria-selected=true]')).to_have_text('37')
        # Explicit touch events work across Linux/macOS headless Chromium;
        # synthesizeScrollGesture(touch) can be a no-op on Linux runners.
        hours.scroll_into_view_if_needed()
        rect=hours.bounding_box()
        x=rect['x']+rect['width']/2
        y=max(60,min(height-40,rect['y']+rect['height']/2))
        cdp=context.new_cdp_session(page)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
        for step in range(1,9):
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-step*11}]})
            page.evaluate('new Promise(resolve => requestAnimationFrame(resolve))')
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
        try:
            page.wait_for_function("() => Number(document.getElementById('picker-hour').value)>14",timeout=5000)
        except Exception:
            Path('reports/ui').mkdir(parents=True,exist_ok=True)
            page.screenshot(path=f'reports/ui/time-wheel-{width}.png',full_page=True)
            print('Swipe failure:', width, rect, hours.evaluate('(el) => ({scrollTop:el.scrollTop, height:el.clientHeight, scrollHeight:el.scrollHeight})'),flush=True)
            raise
        finally:
            cdp.detach()
        # Wheel keyboard controls are independent, including boundary values.
        hours.focus();page.keyboard.press('End')
        expect(page.locator('#picker-hour')).to_have_value('23')
        minutes.focus();page.keyboard.press('Home');page.keyboard.press('ArrowDown')
        expect(page.locator('#picker-minute')).to_have_value('01')
        expect(page.locator('#picker-hour')).to_have_value('23')
        # Native mouse-wheel scrolling, not only programmatic scrolling.
        hours.hover();page.mouse.wheel(0,-132)
        page.wait_for_function("() => Number(document.getElementById('picker-hour').value)<23")
        page.locator('[data-preset-time="19:00"]').click()
        expect(hours.locator('[aria-selected=true]')).to_have_text('19')
        expect(minutes.locator('[aria-selected=true]')).to_have_text('00')
        page.locator('#temporal-picker').evaluate('(el)=>el.scrollTop=0')
        page.locator('#temporal-picker').screenshot(path=f'/tmp/petcare-time-wheels-{width}.png')
        page.locator('#picker-cancel').click()
        expect(source).to_have_value(original)
        source.click();page.locator('#picker-time-tab').click()
        expect(page.locator('#picker-hour')).to_have_value(original[11:13])
        page.locator('#picker-manual-time summary').click()
        page.locator('#picker-hour').fill('6');page.locator('#picker-minute').fill('45')
        expect(hours.locator('[aria-selected=true]')).to_have_text('06')
        expect(minutes.locator('[aria-selected=true]')).to_have_text('45')
        page.locator('#picker-apply').click()
        assert source.input_value().endswith('T06:45')
        expect(source).to_be_focused()
        # A time-only field skips the calendar.
        page.once('dialog',lambda d:d.accept());page.locator('#close-editor').click()
        page.evaluate("openExtraModal('meal-plan')")
        page.locator('#editor [name=time]').click()
        expect(page.locator('#picker-date-panel')).to_be_hidden()
        expect(hours).to_be_visible()
        assert not errors,errors
        print(f'Time wheels passed at {width}x{height}')
        context.close()
    browser.close()
