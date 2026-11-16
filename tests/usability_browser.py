"""Navigation, error-recovery and destructive-action usability checks on a demo DB."""
import json
import os
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('PETCARE_TEST_URL', 'http://127.0.0.1:8002')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':375,'height':812}, reduced_motion='reduce')
    response = context.request.post(BASE+'/api/v1/auth/demo-login/1')
    assert response.ok
    context.add_init_script('localStorage.setItem("petcare_jwt",'+json.dumps(response.json()['access_token'])+')')
    page=context.new_page(); errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(BASE); page.wait_for_load_state('networkidle');page.wait_for_function('state.pets.length > 0')
    page.evaluate('syncServerData(true)')  # Wait for a complete server snapshot.
    snapshot=page.evaluate('''async () => {
        await Promise.all([syncServerData(true),syncServerData(true),syncServerData(true)]);
        return {count:state.health.length,unique:new Set(state.health.map(record=>record.id)).size};
    }''')
    assert snapshot['count']==snapshot['unique'] and snapshot['unique']>0, snapshot
    for width in (320,375,812,1023):
        page.set_viewport_size({'width':width,'height':812})
        page.evaluate("show('pets')")
        links=page.locator('.nav a:visible')
        assert links.count()==5
        for link in links.all():
            rect=link.bounding_box(); assert rect['width']>=44 and rect['height']>=44
            assert rect['y']+rect['height']<=812
        pets_link=page.locator('.nav .mobile-pets')
        pets_link.hover()
        expect(pets_link).to_have_css('background-color','rgba(0, 0, 0, 0)')
        expect(pets_link.locator('.nav-label')).to_have_css('color','rgb(27, 73, 52)')
        expect(pets_link.locator('svg')).to_have_css('color','rgb(255, 254, 250)')
        circle=page.locator('.mobile-pets svg').bounding_box()
        assert abs(circle['x']+circle['width']/2-width/2)<2
        page.screenshot(path=f'/tmp/petcare-menu-audit-{width}.png')
    page.set_viewport_size({'width':375,'height':812})
    for name in ('Здоровье','Питание','Уход и события','Документы'):
        page.get_by_role('link',name=name,exact=True).click()
        expect(page.locator('section.active h1')).to_be_focused()
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.evaluate("show('profile')")
    expect(page.locator('#profile.active')).to_be_visible()
    page.get_by_role('link',name='Здоровье',exact=True).click()
    page.locator('#health-pet-profile summary').click()
    original_name=page.evaluate('pet().name')
    field=page.locator('#health-pet-form [name=name]')
    field.fill('Несохранённое имя')
    page.once('dialog',lambda d:d.dismiss())
    page.get_by_role('link',name='Питание',exact=True).click()
    expect(page.locator('#health.active')).to_be_visible()
    expect(field).to_have_value('Несохранённое имя')
    page.route('**/api/v1/pets/*',lambda route:route.fulfill(status=500,json={'detail':'Тестовая ошибка сохранения'}) if route.request.method=='PUT' else route.continue_())
    page.get_by_role('button',name='Сохранить карточку',exact=True).click()
    expect(page.locator('#health-profile-feedback')).to_contain_text('Ошибка сохранения')
    assert page.evaluate('pet().name')==original_name
    expect(field).to_have_value('Несохранённое имя')
    page.once('dialog',lambda d:d.accept())
    page.get_by_role('link',name='Питание',exact=True).click()
    expect(page.locator('#nutrition.active')).to_be_visible()
    expect(field).to_have_value(original_name)
    page.get_by_role('link',name='Здоровье',exact=True).click()
    page.evaluate('syncServerData(true)')  # Drain recovery refresh before opening record actions.
    before=page.locator('[data-del-health]').count()
    page.locator('#health-records .record-actions summary').first.click()
    page.once('dialog',lambda d:d.dismiss())
    page.locator('[data-del-health]').first.click()
    assert page.locator('[data-del-health]').count()==before
    page.route('**/api/v1/health-records/*',lambda route:route.fulfill(status=500,json={'detail':'Тестовая ошибка удаления'}))
    if not page.locator('[data-del-health]').first.is_visible():
        page.locator('#health-records .record-actions summary').first.click()
    page.once('dialog',lambda d:d.accept())
    page.locator('[data-del-health]').first.click()
    expect(page.locator('#toast')).to_contain_text('Не удалось удалить')
    assert page.locator('[data-del-health]').count()==before
    page.evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.reject(new Error('denied'))},configurable:true});copyPetCode('TEST-CODE')")
    expect(page.locator('#toast')).to_contain_text('Не удалось скопировать')
    page.evaluate("pet().name='Очень длинное имя '.repeat(20);pet().breed='Длиннаяпорода'.repeat(30);show('pets')")
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    context.close()
    # Authentication errors should stay in the form and receive focus.
    context=browser.new_context()
    page=context.new_page();page.goto(BASE);page.wait_for_load_state('networkidle')
    page.locator('#api-open').click()
    pending=[]
    page.route('**/api/v1/auth/login',lambda route:pending.append(route))
    page.locator('#auth-email').fill('user@example.com');page.locator('#auth-password').fill('wrong-password')
    page.locator('#auth-submit-btn').click()
    expect(page.locator('#tab-login')).to_be_disabled()
    expect(page.locator('#tab-register')).to_be_disabled()
    expect(page.locator('#auth-submit-btn')).to_have_text('Подождите…')
    pending[0].fulfill(status=401,json={'detail':'Проверьте логин и пароль'})
    expect(page.locator('#auth-error')).to_be_focused()
    expect(page.locator('#auth-submit-btn')).to_be_enabled()
    expect(page.locator('#auth-email')).to_have_value('user@example.com')
    print('Usability audit regression checks passed')
    context.close();browser.close()
