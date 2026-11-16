"""Local regression checks for progressive disclosure and preserved actions."""
import os
import json
import uuid
from playwright.sync_api import sync_playwright, expect
BASE=os.environ.get('PETCARE_TEST_URL','http://127.0.0.1:8002')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width,height in ((1440,900),(375,812),(812,375)):
        context=browser.new_context(viewport={'width':width,'height':height},reduced_motion='reduce')
        r=context.request.post(BASE+'/api/v1/auth/demo-login/1');assert r.ok
        token=r.json()['access_token']
        context.add_init_script("window.__PETCARE_TEST__=true;")
        context.add_init_script('localStorage.setItem("petcare_jwt",'+json.dumps(token)+')')
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE);page.wait_for_load_state('networkidle');page.evaluate('syncServerData(true)')
        page.evaluate("show('pets')")
        assert page.locator('#today-panel').bounding_box()['y'] < page.locator('#pet-cards').bounding_box()['y']
        page.evaluate("show('care')")
        expect(page.locator('#care #enable-alerts')).to_have_count(0)
        expect(page.locator('#care [data-do=skip]').first).to_be_hidden()
        expect(page.locator('#care [data-do=move]').first).to_be_hidden()
        page.locator('.event-more summary').first.click()
        expect(page.locator('#care [data-do=skip]').first).to_be_visible()
        page.locator('#care [data-do=move]').first.click()
        expect(page.locator('#editor')).to_be_visible()
        expect(page.locator('#editor-title')).to_have_text('Перенести событие')
        page.locator('#close-editor').click()
        page.screenshot(path=f'/tmp/petcare-simpler-care-{width}.png',full_page=True)
        page.evaluate("show('profile')")
        expect(page.locator('#profile .settings-group')).to_have_count(5)
        assert page.locator('#profile button:visible').count()==0
        expect(page.locator('#profile #avatar-preview')).to_have_count(0)
        page.screenshot(path=f'/tmp/petcare-simpler-profile-{width}.png',full_page=True)
        for group,control in [('person','#btn-account-settings'),('notifications','#enable-alerts'),('sharing','[data-extra-modal=member]'),('security','[data-security=password_change]'),('app','#install-petcare')]:
            page.locator('#settings-'+group+' > summary').click()
            expect(page.locator('#settings-'+group+' '+control)).to_be_visible()
            page.locator('#settings-'+group+' > summary').click()
        page.locator('#settings-app > summary').click()
        page.evaluate('installPrompt=null')
        page.locator('#install-petcare').click()
        expect(page.locator('#settings-app .settings-feedback')).to_be_visible()
        expect(page.locator('#settings-app .settings-feedback')).not_to_have_text('')
        expect(page.locator('#settings-security')).not_to_have_attribute('open','')
        page.locator('#settings-app > summary').click()
        page.locator('#settings-notifications > summary').click()
        page.route('**/api/v1/notifications/config',lambda route:route.fulfill(json={'configured':False}))
        page.locator('#subscribe-push').click()
        expect(page.locator('#settings-notifications .settings-feedback')).to_be_visible()
        expect(page.locator('#settings-security')).not_to_have_attribute('open','')
        page.evaluate("show('documents')")
        expect(page.locator('#document-photo')).to_be_hidden()
        page.locator('#document-recognition summary').click()
        expect(page.locator('#document-photo')).to_be_visible()
        page.evaluate("show('health')")
        expect(page.locator('[data-del-health]').first).to_be_hidden()
        page.locator('#health-records .record-actions summary').first.click()
        expect(page.locator('[data-del-health]').first).to_be_visible()
        page.locator('#health-pet-profile summary').click()
        page.locator('[data-extra-modal=avatar]').click()
        expect(page.locator('#editor [name=background]')).to_be_visible()
        page.locator('#close-editor').click()
        for action,status in [('complete','completed'),('skip','skipped')]:
            title='Проверка действия '+uuid.uuid4().hex[:8]
            pet_id=page.evaluate('pet().serverId')
            created=context.request.post(BASE+f'/api/v1/pets/{pet_id}/reminders',headers={'Authorization':'Bearer '+token},data={'title':title,'reminder_type':'Процедура','due_date':'2026-11-17','at':'2026-11-17T12:00:00+03:00'})
            assert created.ok,created.text()
            reminder_id=created.json()['id']
            page.evaluate("async () => {await syncServerData(true);careFilter='all';show('care')}")
            button=page.locator(f'[data-care-event="sr_{reminder_id}"][data-do="{action}"]')
            if action=='skip':
                page.locator('.event-more').filter(has=button).locator('summary').click()
            with page.expect_response(lambda r: f'/reminders/{reminder_id}/action' in r.url and r.request.method=='PATCH') as saved:
                button.click()
            assert saved.value.ok,saved.value.text()
            page.wait_for_function('(id)=>state.events.find(e=>e.serverId===id)?.status!=="pending"',arg=reminder_id)
            assert page.evaluate('(id)=>state.events.find(e=>e.serverId===id).status',reminder_id)==status
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors,errors
        print(f'Hierarchy and preserved actions passed at {width}x{height}')
        context.close()
    browser.close()
