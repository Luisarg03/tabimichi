"""E2E test: simulate a real user flow through Tabimichi"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:3000"
EMAIL = f"test-{int(time.time())}@tabimichi.test"
PASSWORD = "Test1234!"
SCREENSHOTS = "/home/hiro03/Private/Projects/tabi/docs/screenshots"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, locale="es-ES")
        page = ctx.new_page()

        # === 1. Homepage ===
        print("=== 1. Homepage ===")
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(2000)
        print(f"  Title: {page.title()}")
        page.screenshot(path=f"{SCREENSHOTS}/test-01-home.png")

        # === 2. Settings (unauthenticated) ===
        print("\n=== 2. Settings (unauthenticated) ===")
        page.goto(f"{BASE}/settings", wait_until="networkidle")
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{SCREENSHOTS}/test-02-settings-unauth.png")

        # Check for auth form
        auth_heading = page.locator("text=Iniciar sesión").first
        print(f"  Auth heading visible: {auth_heading.is_visible()}")

        # === 3. Register ===
        print("\n=== 3. Register ===")
        register_link = page.locator("text=Crear una")
        if register_link.count() > 0 and register_link.first.is_visible():
            register_link.first.click()
            page.wait_for_timeout(500)

        page.fill('input[type="email"]', EMAIL)
        page.fill('input[type="password"]', PASSWORD)

        submit_btn = page.locator('button[type="submit"]')
        submit_btn.click()
        page.wait_for_timeout(3000)
        page.screenshot(path=f"{SCREENSHOTS}/test-03-register-result.png")

        # Check for success or auto-login
        logged_in = page.locator("text=Sesión activa").is_visible()
        success_msg = page.locator("text=Cuenta creada").is_visible()
        print(f"  Registered: {success_msg}, Logged in: {logged_in}")

        # === 4. Login (if not auto-logged in) ===
        if not logged_in:
            print("\n=== 4. Login ===")
            login_link = page.locator("text=Iniciar sesión").first
            if login_link.is_visible():
                login_link.click()
                page.wait_for_timeout(500)

            page.fill('input[type="email"]', EMAIL)
            page.fill('input[type="password"]', PASSWORD)
            submit_btn = page.locator('button[type="submit"]')
            submit_btn.click()
            page.wait_for_timeout(3000)
            logged_in = page.locator("text=Sesión activa").is_visible()
            print(f"  Logged in: {logged_in}")
            page.screenshot(path=f"{SCREENSHOTS}/test-04-login.png")

        # === 5. Settings (authenticated) ===
        print("\n=== 5. Settings (authenticated) ===")
        page.wait_for_timeout(1000)
        settings_form = page.locator("text=Google Places").is_visible()
        print(f"  Settings form visible: {settings_form}")
        page.screenshot(path=f"{SCREENSHOTS}/test-05-settings-auth.png")

        browser.close()
        print("\n✅ E2E test complete")

if __name__ == "__main__":
    main()
