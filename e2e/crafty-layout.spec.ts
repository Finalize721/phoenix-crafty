import { expect, test } from "./helpers/fixtures";

test.use({ locale: "en-US" });

test("Crafty header has two compact rows and the source link lives in settings", async ({
  page,
  bluetoothDevice,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await bluetoothDevice("CRAFTY");
  await page.goto("/");
  await page.getByRole("button", { name: /^connect device$/i }).click();
  await page.waitForURL(/crafty/);
  const header = page.locator("header");
  const first = header.locator(":scope > div").nth(0);
  const second = header.locator(":scope > div").nth(1);
  await expect(first.getByRole("button", { name: "Keep screen awake" })).toBeVisible();
  await expect(first.getByRole("img", { name: /Battery: 80 %/ })).toBeVisible();
  await expect(second.getByRole("button", { name: "Customize appearance" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Dark Mode" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Notify at 99% battery" })).toBeVisible();
  await expect(second.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Source code" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("link", { name: "Source code" })).toHaveAttribute(
    "href", "https://github.com/Finalize721/phoenix-crafty"
  );
});

test("manual charging estimate replaces only the gauge and heating restores the temperature gauge", async ({
  page,
  bluetoothDevice,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bluetoothDevice("CRAFTY");
  await page.addInitScript(() => {
    const start = Date.now() - 3_600_000;
    const history = [80, 85, 90, 95, 99].map((level) => ({
      level,
      time: start + (level - 80) * 60_000,
      sessionId: "historical-run",
      origin: "notification",
      continuousSincePrevious: true,
      heaterActive: false,
    }));
    localStorage.setItem("craftyChargingHistory:mock-crafty", JSON.stringify(history));
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^connect device$/i }).click();
  await page.waitForURL(/crafty/);
  const gauge = page.getByTestId("crafty-charging-gauge");
  const showEstimate = page.getByRole("button", { name: "Show charging estimate" });
  await expect(showEstimate).toBeVisible();
  await expect(gauge).toHaveCount(0);
  await showEstimate.click();
  await expect(gauge).toBeVisible();
  await expect(gauge).toContainText("Historical charging estimate");
  await expect(gauge).toContainText("Estimated time remaining");
  await expect(gauge).toContainText("180 °C");
  await expect(gauge).toContainText(/19 min/);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(gauge).toHaveCount(0);
  await page.getByRole("link", { name: "Control", exact: true }).click();
  await expect(gauge).toBeVisible();
  await page.getByRole("button", { name: "Hide charging estimate" }).click();
  await expect(gauge).toHaveCount(0);
  await showEstimate.click();
  await expect(gauge).toBeVisible();
  await page.getByRole("button", { name: /^Heater/ }).click();
  await expect(gauge).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toBeVisible();
});

test.describe("German locale", () => {
  test.use({ locale: "de-DE" });

  test("appearance controls use German translations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await page.getByRole("button", { name: "Atmosphäre anpassen" }).click();
    await expect(page.locator(".palette-popover")).toContainText("Grundfarbe");
    await expect(page.getByRole("button", { name: "Preset-Farben wiederherstellen" })).toBeVisible();
    await expect(page.locator(".palette-popover")).not.toContainText("Base color");
  });
});
