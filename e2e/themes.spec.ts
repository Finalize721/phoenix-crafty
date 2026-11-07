import { expect, test } from "./helpers/fixtures";

test("mobile themes preserve appearance choices and Crafty controls", async ({
  page,
  bluetoothDevice,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bluetoothDevice("CRAFTY");
  await page.goto("/");
  for (const skin of ["court", "signal", "jelly"]) {
    await page.getByLabel("Design auswählen").selectOption(skin);
    for (const dark of [false, true]) {
      const toggle = page.getByRole("button", { name: /dark mode/i });
      if ((await toggle.getAttribute("aria-pressed")) !== String(dark))
        await toggle.click();
      await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `test-results/${skin}-${dark ? "dark" : "light"}.png`,
        fullPage: true,
      });
    }
  }
  await page.reload();
  await expect(page.getByLabel("Design auswählen")).toHaveValue("jelly");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: /^connect device$/i }).click();
  await page.waitForURL(/crafty/);
  await expect(page.locator("text=/180/i").first()).toBeVisible();
  await page.getByLabel("Design auswählen").selectOption("court");
  await page.screenshot({
    path: "test-results/crafty-court-dark.png",
    fullPage: true,
  });
});
