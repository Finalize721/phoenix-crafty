import { expect, test } from "./helpers/fixtures";

test("mobile themes preserve appearance choices and Crafty controls", async ({
  page,
  bluetoothDevice,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bluetoothDevice("CRAFTY");
  await page.goto("/");

  const paletteButton = page.getByRole("button", {
    name: "Customize appearance",
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

test("RGB sliders start at the selected color and preserve other channels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const openPalette = () => page.getByRole("button", { name: "Customize appearance" }).click();
  await openPalette();
  const palette = page.locator(".palette-popover");
  await palette.locator("select").selectOption("signal");
  const base = palette.getByRole("button", { name: "Base color", exact: true });
  const accent = palette.getByRole("button", { name: "Accent color", exact: true });
  await base.click();
  const sliders = palette.getByRole("slider");
  const hex = palette.getByRole("textbox", { name: "Hex color" });
  await expect(sliders.nth(0)).toHaveValue("234");
  await expect(sliders.nth(1)).toHaveValue("244");
  await expect(sliders.nth(2)).toHaveValue("239");
  await sliders.nth(0).fill("233");
  await expect(hex).toHaveValue("#e9f4ef");
  await expect(sliders.nth(1)).toHaveValue("244");
  await expect(sliders.nth(2)).toHaveValue("239");
  await hex.fill("#28445c");
  await hex.press("Tab");
  await expect(base).toContainText("#28445C");
  await accent.click();
  await expect(sliders.nth(0)).toHaveValue("18");
  await expect(sliders.nth(1)).toHaveValue("108");
  await expect(sliders.nth(2)).toHaveValue("84");
  await hex.fill("#c14372");
  await hex.press("Tab");
  await expect(accent).toContainText("#C14372");
  await expect(page.locator("html")).toHaveAttribute("data-custom-base", "true");
  await page.reload();
  await openPalette();
  await expect(palette.locator("select")).toHaveValue("signal");
  await base.click();
  await expect(sliders.nth(0)).toHaveValue("40");
  await expect(sliders.nth(1)).toHaveValue("68");
  await expect(sliders.nth(2)).toHaveValue("92");
  await sliders.nth(2).fill("93");
  await expect(hex).toHaveValue("#28445d");
  await base.click();
  await base.click();
  await expect(sliders.nth(2)).toHaveValue("93");
  await accent.click();
  await expect(sliders.nth(0)).toHaveValue("193");
  await expect(sliders.nth(1)).toHaveValue("67");
  await expect(sliders.nth(2)).toHaveValue("114");
  await page.keyboard.press("Escape");
});

test("dark preset starts from its dark accent and preserves its base appearance when edited", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("button", { name: "Customize appearance" }).click();
  const palette = page.locator(".palette-popover");
  await palette.getByRole("button", { name: "Accent color", exact: true }).click();
  const sliders = palette.getByRole("slider");
  await expect(sliders.nth(0)).toHaveValue("134");
  await expect(sliders.nth(1)).toHaveValue("180");
  await expect(sliders.nth(2)).toHaveValue("255");
  await palette.getByRole("button", { name: "Base color", exact: true }).click();
  await expect(sliders.nth(0)).toHaveValue("31");
  await expect(sliders.nth(1)).toHaveValue("57");
  await expect(sliders.nth(2)).toHaveValue("109");
  await sliders.nth(0).fill("32");
  await expect(palette.getByRole("textbox", { name: "Hex color" })).toHaveValue("#20396d");
  await expect(page.locator("html")).toHaveCSS("--custom-base", "#20396d");
});

test("visual and RGB methods edit the same color without resetting it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Customize appearance" }).click();
  const palette = page.locator(".palette-popover");
  await palette.getByRole("button", { name: "Accent color", exact: true }).click();
  const hex = palette.getByRole("textbox", { name: "Hex color" });
  await hex.fill("#ff0000");
  await hex.press("Tab");
  await palette.getByRole("button", { name: "Color field", exact: true }).click();
  await expect(hex).toHaveValue("#ff0000");
  await expect(palette.getByRole("slider", { name: "Hue", exact: true })).toHaveValue("0");
  await expect(palette.getByRole("slider", { name: "Saturation", exact: true })).toHaveValue("100");
  await expect(palette.getByRole("slider", { name: "Brightness", exact: true })).toHaveValue("100");
  await palette.getByRole("slider", { name: "Hue", exact: true }).fill("120");
  await expect(hex).toHaveValue("#00ff00");
  await palette.getByRole("button", { name: "RGB", exact: true }).click();
  await expect(palette.getByRole("slider", { name: "Red", exact: true })).toHaveValue("0");
  await expect(palette.getByRole("slider", { name: "Green", exact: true })).toHaveValue("255");
  await expect(palette.getByRole("slider", { name: "Blue", exact: true })).toHaveValue("0");
});
