import { test, expect } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../tests/helpers/bridge";
import { waitForAnimations } from "../../tests/helpers/animations";

for (const theme of ["buzz-dark", "buzz"]) {
  test(`strategy stays in the content pane with ${theme} theme and app navigation`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ identity, theme }) => {
        localStorage.setItem(
          "buzz:e2e-identity-override.v1",
          JSON.stringify(identity),
        );
        localStorage.setItem("buzz-theme", theme);
      },
      { identity: TEST_IDENTITIES.tyler, theme },
    );
    await installMockBridge(page, undefined, {
      relayWsUrl: "wss://buzz.kovar.kr",
    });
    await page.routeWebSocket("wss://buzz.kovar.kr", (socket) => {
      socket.send(JSON.stringify(["AUTH", "strategy-layout-test"]));
      socket.onMessage((raw) => {
        const [op, id] = JSON.parse(String(raw));
        if (op === "AUTH") socket.send(JSON.stringify(["OK", id.id, true, ""]));
        if (op === "REQ") socket.send(JSON.stringify(["EOSE", id]));
      });
    });
    await page.goto("/");
    const entry = page.getByRole("button", { name: "전략실", exact: true });
    await entry.click();
    await expect(
      page.getByRole("heading", { name: "코바 전략실", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "오늘 할 일", exact: true }),
    ).toBeVisible();
    await expect(entry).toHaveAttribute("aria-current", "page");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    const pane = page.locator(".strategy-native-pane");
    const paneBox = await pane.boundingBox();
    const entryBox = await entry.boundingBox();
    if (!paneBox || !entryBox) throw new Error("Missing pane geometry");
    expect(paneBox.x).toBeGreaterThan(entryBox.x + entryBox.width);
    await page
      .getByRole("button", { name: "+ 업무 등록", exact: true })
      .click();
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(pane).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({ path: `test-results/strategy-pane-${theme}.png` });
    await page
      .getByRole("button", { name: "받은 편지함", exact: true })
      .click();
    await expect(pane).toHaveCount(0);
    await page.goBack();
    await expect(pane).toBeVisible();
  });
}
