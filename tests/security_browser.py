"""The production UI works under CSP without inline script handlers."""
import os
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('PETCARE_TEST_URL','http://127.0.0.1:8002')
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    for width,height in ((1440,900),(375,812)):
        context=browser.new_context(locale='ru-RU', viewport={'width':width,'height':height},reduced_motion='reduce')
        response=context.request.post(BASE+'/api/v1/auth/demo-login/1', headers={'X-PetCare-Browser': '1'});assert response.ok
        context.add_init_script('''window.__PETCARE_TEST__=true; window.cspViolations=[];
            document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective));''')
        page=context.new_page();page.goto(BASE+'/#/pets');page.wait_for_load_state('networkidle')
        session = next(cookie for cookie in context.cookies() if cookie['name'] == 'petcare_session')
        assert session['httpOnly'] and session['sameSite'] == 'Strict'
        assert page.evaluate("localStorage.getItem('petcare_jwt')") is None
        assert not page.evaluate("document.cookie.includes('petcare_session=')")
        page.locator('#pet-cards [data-open-pet]').first.click()
        page.evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:value=>{window.copiedCode=value;return Promise.resolve();}},configurable:true})")
        button=page.locator('#editor [data-copy-pet-code]')
        expected=button.get_attribute('data-copy-pet-code')
        button.click()
        page.wait_for_function('(code)=>window.copiedCode===code',arg=expected)
        if width == 1440:
            pet_id = page.evaluate('pet().serverId')
            route = BASE + f'/api/v1/pets/{pet_id}/documents'
            headers = {'X-PetCare-Browser': '1'}
            note = context.request.post(route, headers=headers, data={
                'title': 'Проверка скачивания', 'date': '2026-11-21',
                'file_name': 'note.txt', 'file_data': 'data:text/plain;base64,aGk=',
            })
            assert note.ok, note.text()
            doc_id = note.json()['id']
            page.locator('#close-editor').click()
            page.evaluate("async () => { await syncServerData(true); show('documents'); }")
            with page.expect_download() as downloaded:
                page.locator(f'a[href="/api/v1/documents/{doc_id}/download"]').click()
            assert downloaded.value.path().read_bytes() == b'hi'
            assert context.request.delete(BASE + f'/api/v1/documents/{doc_id}', headers=headers).ok
        assert not page.evaluate('window.cspViolations')
        print(f'CSP and delegated copy action passed at {width}px')
        context.close()
    browser.close()
