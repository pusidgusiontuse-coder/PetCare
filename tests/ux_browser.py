"""Browser regression checks. Start a demo-enabled server with an isolated DB first."""
import os
import uuid
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('PETCARE_TEST_URL', 'http://127.0.0.1:8002')

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for width, height in ((1440, 900), (375, 812), (812, 375)):
        context = browser.new_context(viewport={'width': width, 'height': height})
        response = context.request.post(BASE + '/api/v1/auth/demo-login/1')
        assert response.ok, response.text()
        token = response.json()['access_token']
        context.add_init_script('localStorage.setItem("petcare_jwt", ' + __import__('json').dumps(token) + ')')
        page = context.new_page()
        page.emulate_media(reduced_motion='reduce')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE)
        page.wait_for_load_state('networkidle')
        page.wait_for_function('state.pets.length > 0')
        page.evaluate("""() => {
            state.selected = state.pets[0].id;
            state.events = [{id:'ux-overdue', petId:pet().id, title:'Обработка от паразитов',
                at:'2020-11-13T09:00:00+03:00',status:'pending',type:'Процедура'}];
            show('pets');
        }""")
        expect(page.locator('.pet-card-status').first).to_contain_text('Обработка от паразитов')
        page.locator('[data-overdue-pet]').first.click()
        expect(page.locator('#care.active')).to_be_visible()
        expect(page.locator('[data-care-filter=overdue]')).to_have_class('chip active')
        expect(page.get_by_role('button', name='Готово — отметить выполненным: Обработка от паразитов')).to_be_visible()
        expect(page.get_by_role('link', name='Уход и события', exact=True)).to_have_attribute('href', __import__('re').compile('#/pet/.+/care'))
        page.get_by_role('link', name='Здоровье', exact=True).click()
        expect(page.locator('#health-pet-profile')).not_to_have_attribute('open', '')
        page.locator('#health-pet-profile summary').click()
        expect(page.locator('#health-pet-form')).to_be_visible()
        page.get_by_role('link', name='Уход и события', exact=True).click()
        page.locator('[data-extra-modal=reminder]').click()
        interval = page.locator('#editor [name=interval]')
        expect(interval).to_be_hidden()
        expect(interval).to_be_disabled()
        page.locator('#editor [name=frequency]').select_option('days')
        expect(interval).to_be_visible()
        expect(interval).to_have_attribute('required', '')
        page.locator('#editor [name=frequency]').select_option('once')
        expect(interval).to_be_disabled()
        page.once('dialog', lambda dialog: dialog.dismiss())
        page.locator('#editor').click(position={'x': 2, 'y': 2}, force=True)
        expect(page.locator('#editor')).to_be_visible()
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#close-editor').click()
        expect(page.locator('[data-extra-modal=reminder]')).to_be_focused()
        page.get_by_role('link', name='Питание', exact=True).click()
        page.locator('.food-tools summary').first.click()
        # Controlled client-side fixtures, no writes to user records.
        page.evaluate("""() => { state.nutrition = [{id:'ux-food',petId:pet().id,date:'2026-11-15',kind:'food',food:'Корм А',tolerated:'yes'}]; renderNutrition(); }""")
        expect(page.locator('#comparison')).to_contain_text('Добавьте ещё один корм')
        expect(page.locator('.compare-selects-row')).to_be_hidden()
        page.evaluate("""() => { state.nutrition.push({id:'ux-food-2',petId:pet().id,date:'2026-11-15',kind:'food',food:'Корм Б',tolerated:'yes'}); renderNutrition(); }""")
        expect(page.locator('.compare-selects-row')).to_be_visible()
        page.locator('#compare-a').select_option('1')
        assert page.locator('#compare-a').input_value() != page.locator('#compare-b').input_value()
        page.locator('#compare-b').select_option('1')
        assert page.locator('#compare-a').input_value() != page.locator('#compare-b').input_value()
        page.locator('#nutrition-add-food').click()
        expect(page.locator('#editor')).to_have_attribute('data-mode', 'nutrition')
        expect(page.locator('#editor input[name=food]')).to_be_visible()
        expect(page.locator('#editor input[name=price]')).to_be_hidden()
        section = page.locator('.food-form-section').first.bounding_box()
        fields = page.locator('#editor-fields').bounding_box()
        assert section and fields and abs(section['width'] - fields['width']) < 2, 'Food sections should span form width'
        food_name = 'Тестовый корм ' + uuid.uuid4().hex[:8]
        page.locator('#editor [name=food]').fill(food_name)
        page.locator('#editor [name=brand]').fill('Проверка интерфейса')
        page.locator('.food-options label:has(input[name=liked][value=yes])').click()
        page.locator('.food-options label:has(input[name=tolerated][value=no])').click()
        page.locator('#editor [name=reactions]').fill('Отказался от корма')
        page.locator('.food-form-details summary').click()
        page.locator('#editor [name=price]').fill('1290')
        page.locator('#editor [name=notes]').fill('Заметка для проверки')
        page.locator('#editor').evaluate('(el) => el.scrollTop = 0')
        page.screenshot(path=f'/tmp/petcare-food-form-{width}.png')
        with page.expect_response(lambda r: '/nutrition' in r.url and r.request.method == 'POST') as saved:
            page.get_by_role('button', name='Сохранить корм', exact=True).click()
        assert saved.value.ok, saved.value.text()
        expect(page.locator('#editor')).not_to_be_visible()
        entry = page.locator('.food-entry').filter(has_text=food_name)
        expect(entry).to_contain_text('Не подошёл')
        expect(entry).to_contain_text('Ест охотно')
        expect(entry).to_contain_text('Отказался от корма')
        expect(entry).to_contain_text('Заметка для проверки')
        page.screenshot(path=f'/tmp/petcare-food-journal-{width}.png', full_page=True)
        page.get_by_role('link', name='Документы', exact=True).click()
        page.evaluate('''() => {
            state.health = [{id:'visit-new',petId:pet().id,title:'Анализ крови',type:'other',date:'2026-11-15',attachment:{name:'new.pdf'}},
                {id:'visit-old',petId:pet().id,title:'Анализ крови',type:'other',date:'2026-10-15',attachment:{name:'old.pdf'}}];
            renderDocuments();
        }''')
        page.locator('[data-linked-health=visit-old]').click()
        expect(page.locator('[data-health-record=visit-old]')).to_be_focused()
        page.get_by_role('link', name='Документы', exact=True).click()
        page.locator('#document-search').fill('Нет такого документа')
        expect(page.locator('#document-list')).to_contain_text('Документов не найдено')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
        assert not errors, errors
        page.screenshot(path=f'/tmp/petcare-ux-{width}.png', full_page=True)
        context.close()
        print(f'UX checks passed at {width}px')
    browser.close()
