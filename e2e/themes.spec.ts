import { expect, test } from "./helpers/fixtures";

test("mobile themes preserve appearance choices and Crafty controls", async ({
  page,
  bluetoothDevice,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bluetoothDevice("CRAFTY");
  await page.goto("/");

  const paletteButton = page.getByRole("button", {
    name: "Atmosphäre anpassen",
  });
  const palette = page.locator(".palette-popover");
  const choosePalette = async (skin: string) => {
    await paletteButton.click();
    const select = palette.locator("select");
    await expect(select).toBeVisible();
    await select.selectOption(skin);
    await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
    await page.keyboard.press("Escape");
  };

  await expect(paletteButton).toBeVisible();
  await paletteButton.click();
  await expect(palette.locator("select option")).toHaveText([
    "Phoenix Court",
    "Ghost Signal",
    "Jellyfish Hotel",
  ]);
  await page.keyboard.press("Escape");

  for (const skin of ["court", "signal", "jelly"]) {
    await choosePalette(skin);
    for (const dark of [false, true]) {
      await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
      if (dark) await expect(page.locator("html")).toHaveClass(/dark/);
      else await expect(page.locator("html")).not.toHaveClass(/dark/);
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
  await paletteButton.click();
  await expect(palette.locator("select")).toHaveValue("jelly");
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: /^connect device$/i }).click();
  await page.waitForURL(/crafty/);
  await expect(page.locator("text=/180/i").first()).toBeVisible();
  await choosePalette("court");
  await page.screenshot({
    path: "test-results/crafty-court-dark.png",
    fullPage: true,
  });
});

test("dark-mode toggle keeps its saved preference", async ({
  page,
  bluetoothDevice,
}) => {
  await bluetoothDevice("CRAFTY");
  await page.goto("/");
  await page.getByRole("button", { name: /^connect device$/i }).click();
  await page.waitForURL(/crafty/);

  const toggle = page.getByRole("button", {
    name: /dark mode|dunkelmodus/i,
  });
  const previous = (await toggle.getAttribute("aria-pressed")) === "true";
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", String(!previous));
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) => element.classList.contains("dark"))
    )
    .toBe(!previous);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("isDarkModeVReverse")))
    .toBe(String(!previous));

  await page.reload();
  if (!previous) await expect(page.locator("html")).toHaveClass(/dark/);
  else await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("custom base and accent colors persist in the palette", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await page.getByRole("button", { name: "Atmosphäre anpassen" }).click();
  const palette = page.locator(".palette-popover");
  await palette.locator("select").selectOption("signal");

  const colors = palette.locator('input[type="color"]');
  await colors.nth(0).evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "#28445c";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await colors.nth(1).evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "#c14372";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator("html")).toHaveAttribute("data-skin", "signal");
  await expect(page.locator("html")).toHaveAttribute(
    "data-custom-base",
    "true"
  );
  await expect(colors.nth(0)).toHaveValue("#28445c");
  await expect(colors.nth(1)).toHaveValue("#c14372");
  await page.reload();

  await page.getByRole("button", { name: "Atmosphäre anpassen" }).click();
  await expect(palette.locator("select")).toHaveValue("signal");
  await expect(palette.locator('input[type="color"]').nth(0)).toHaveValue(
    "#28445c"
  );
  await expect(palette.locator('input[type="color"]').nth(1)).toHaveValue(
    "#c14372"
  );
  await page.keyboard.press("Escape");
});
