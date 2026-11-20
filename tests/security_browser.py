"""The production UI works under CSP without inline script handlers."""
import json
import os
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('PETCARE_TEST_URL','http://127.0.0.1:8002')
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    for width,height in ((1440,900),(375,812)):
        context=browser.new_context(locale='ru-RU', viewport={'width':width,'height':height},reduced_motion='reduce')
        response=context.request.post(BASE+'/api/v1/auth/demo-login/1');assert response.ok
        context.add_init_script('localStorage.setItem("petcare_jwt",'+json.dumps(response.json()['access_token'])+')')
        context.add_init_script('''window.cspViolations=[];
            document.addEventListener('securitypolicyviolation',event=>window.cspViolations.push(event.violatedDirective));''')
        page=context.new_page();page.goto(BASE+'/#/pets');page.wait_for_load_state('networkidle')
        page.locator('#pet-cards [data-open-pet]').first.click()
        page.evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:value=>{window.copiedCode=value;return Promise.resolve();}},configurable:true})")
        button=page.locator('#editor [data-copy-pet-code]')
        expected=button.get_attribute('data-copy-pet-code')
        button.click()
        page.wait_for_function('(code)=>window.copiedCode===code',arg=expected)
        assert not page.evaluate('window.cspViolations')
        print(f'CSP and delegated copy action passed at {width}px')
        context.close()
    browser.close()
