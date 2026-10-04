import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import { encrypt } from "nostr-tools/nip49";
import {
  key,
  root,
  makeEvent,
  installRelay,
  signInWithExtension,
} from "./fixtures";
import { waitForAnimations } from "../../../tests/helpers/animations";

const bytes = Buffer.from("웹 첨부 파일 테스트\n");
const hash = createHash("sha256").update(bytes).digest("hex");
const url = `https://buzz.kovar.kr/media/${hash}.bin`;
const file = {
  name: "업무 자료 [최종].txt",
  mimeType: "text/plain",
  buffer: bytes,
};
const descriptor = {
  url,
  sha256: hash,
  size: bytes.length,
  type: "text/plain",
  uploaded: 1,
};
const imeta = [
  "imeta",
  `url ${url}`,
  `x ${hash}`,
  "m text/plain",
  `size ${bytes.length}`,
  `filename ${file.name}`,
];

test.beforeEach(async ({ page }) => {
  await page.route("**/chat-api/**", (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/status") ? 200 : 401,
      json: route.request().url().endsWith("/status")
        ? { configured: true }
        : { error: "login-required" },
    }),
  );
});

async function mediaRoutes(page: Page, failFirst = false) {
  const requests: string[] = [];
  let failures = failFirst ? 1 : 0;
  await page.route("https://buzz.kovar.kr/upload", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "PUT",
        },
      });
    const auth = JSON.parse(
      Buffer.from(
        request.headers().authorization.slice(6),
        "base64",
      ).toString(),
    );
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.kind).toBe(24242);
    expect(auth.content.trim()).not.toBe("");
    expect(auth.tags).toContainEqual(["t", "upload"]);
    expect(auth.tags).toContainEqual(["x", hash]);
    expect(auth.tags).toContainEqual(["server", "buzz.kovar.kr"]);
    expect(request.postDataBuffer()).toEqual(bytes);
    requests.push(auth.id);
    await route.fulfill({
      status: failures-- > 0 ? 503 : 200,
      json: descriptor,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  await page.route(url, async (route) => {
    const request = route.request();
    const auth = JSON.parse(
      Buffer.from(
        request.headers().authorization.slice(6),
        "base64",
      ).toString(),
    );
    expect(verifyEvent(auth)).toBe(true);
    expect(auth.content.trim()).not.toBe("");
    expect(auth.tags).toContainEqual(["t", "get"]);
    expect(auth.tags).toContainEqual(["x", hash]);
    await route.fulfill({
      body: bytes,
      contentType: "application/octet-stream",
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
  return requests;
}

async function attach(page: Page) {
  await page.getByLabel("파일 첨부", { exact: true }).setInputFiles(file);
  await expect(page.getByRole("list", { name: "첨부 파일" })).toContainText(
    file.name,
  );
}

test("file-only upload, durable same-ID retry, and authenticated original-name download", async ({
  page,
}) => {
  const published = await installRelay(page, true);
  const uploads = await mediaRoutes(page);
  await signInWithExtension(page);
  await attach(page);
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(
    page.getByRole("button", { name: "같은 메시지 다시 전송" }),
  ).toBeEnabled();
  expect(published).toHaveLength(1);
  expect(published[0].tags).toContainEqual(
    imeta
      .slice(0, 2)
      .concat([
        "m text/plain",
        `x ${hash}`,
        `size ${bytes.length}`,
        `filename ${file.name}`,
      ]),
  );
  await page.reload();
  await page.locator("summary").click();
  await page
    .getByRole("button", { name: "브라우저 서명 확장으로 로그인" })
    .click();
  await page.getByRole("button", { name: "같은 메시지 다시 전송" }).click();
  await expect(
    page.getByRole("button", { name: `다운로드: ${file.name}`, exact: true }),
  ).toBeVisible();
  expect(published).toHaveLength(2);
  expect(published[0].id).toBe(published[1].id);
  expect(uploads).toHaveLength(1);
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `다운로드: ${file.name}`, exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename().normalize("NFC")).toBe(file.name);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Missing downloaded file");
  expect(await readFile(downloadPath)).toEqual(bytes);
  await waitForAnimations(page);
  await page.screenshot({
    path: `test-results/korean-web/attachments-${test.info().project.name}.png`,
  });
});

test("upload failure retains files and text, and retry posts a threaded attachment", async ({
  page,
}) => {
  const published = await installRelay(page);
  const uploads = await mediaRoutes(page, true);
  await signInWithExtension(page);
  await page
    .locator(`[data-message-id="${root.id}"]`)
    .getByRole("button", { name: "답장", exact: true })
    .click();
  await attach(page);
  await page.getByLabel("메시지 입력").fill("검토 부탁드립니다");
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "파일을 전송하지 못했습니다",
  );
  await expect(page.getByLabel("메시지 입력")).toHaveValue("검토 부탁드립니다");
  expect(published).toHaveLength(0);
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(
    page.getByRole("region", { name: "답글 대화", exact: true }),
  ).toContainText(file.name);
  expect(published[0].tags).toContainEqual(["e", root.id, "", "reply"]);
  expect(uploads).toHaveLength(2);
});

test("picker keyboard activation, paste/drop, removal, draft isolation and file limits", async ({
  page,
}) => {
  await installRelay(page, false, [root], ["general", "other"]);
  await signInWithExtension(page);
  const picker = page.getByRole("button", { name: "파일 첨부", exact: true });
  await picker.focus();
  const chooserEvent = page.waitForEvent("filechooser");
  await picker.press("Enter");
  await (await chooserEvent).setFiles(file);
  if (test.info().project.name === "mobile-safari")
    await page.getByRole("button", { name: "채널 목록", exact: true }).click();
  // Desktop keeps the sidebar visible; mobile uses the channel-list control.
  await page.getByRole("button", { name: "other", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `첨부 삭제: ${file.name}` }),
  ).toHaveCount(0);
  if (test.info().project.name === "mobile-safari")
    await page.getByRole("button", { name: "채널 목록", exact: true }).click();
  await page.getByRole("button", { name: "일반", exact: true }).click();
  await page.getByRole("button", { name: `첨부 삭제: ${file.name}` }).click();
  await page.getByLabel("메시지 입력").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["paste"], "붙여넣기.txt", { type: "text/plain" }),
    );
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    element.dispatchEvent(event);
  });
  await expect(
    page.getByRole("button", { name: "첨부 삭제: 붙여넣기.txt" }),
  ).toBeVisible();
  await page.locator(".composer").evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["drop"], "드롭.txt", { type: "text/plain" }));
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    element.dispatchEvent(event);
  });
  await expect(
    page.getByRole("button", { name: "첨부 삭제: 드롭.txt" }),
  ).toBeVisible();
  await page.getByLabel("파일 첨부", { exact: true }).setInputFiles(
    Array.from({ length: 4 }, (_, index) => ({
      ...file,
      name: `${index}.txt`,
    })),
  );
  await expect(page.getByRole("alert")).toContainText("최대 5개");
  await page
    .getByLabel("파일 첨부", { exact: true })
    .setInputFiles({ ...file, name: "empty.txt", buffer: Buffer.alloc(0) });
  await expect(page.getByRole("alert")).toContainText("빈 파일");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("cancelled upload cannot publish later and retains the selected file", async ({
  page,
}) => {
  const published = await installRelay(
    page,
    false,
    [root],
    ["general", "other"],
  );
  let release: (() => void) | undefined;
  await page.route("**/upload", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: descriptor }).catch(() => {});
  });
  await signInWithExtension(page);
  await attach(page);
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole("button", { name: "업로드 취소" }).click();
  await expect(
    page.getByRole("button", { name: "메시지 보내기" }),
  ).toBeEnabled();
  release?.();
  await expect(
    page.getByRole("button", { name: `첨부 삭제: ${file.name}` }),
  ).toBeVisible();
  expect(published).toHaveLength(0);
});

test("desktop attachment metadata is recognized; foreign and corrupt files cannot download", async ({
  page,
}) => {
  const message = makeEvent(
    9,
    [["h", "general"], imeta],
    `[file](${url})`,
    key,
  );
  const foreign = makeEvent(
    9,
    [
      ["h", "general"],
      ["imeta", `url https://foreign.test/media/${hash}.bin`, `x ${hash}`],
    ],
    `https://foreign.test/media/${hash}.bin`,
    key,
  );
  await installRelay(page, false, [root, message, foreign]);
  await mediaRoutes(page);
  await signInWithExtension(page);
  await page.route(url, (route) =>
    route.fulfill({
      body: "corrupt",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  let downloaded = false;
  page.on("download", () => {
    downloaded = true;
  });
  await page.getByRole("button", { name: `다운로드: ${file.name}` }).click();
  await expect(page.getByRole("alert")).toContainText("무결성");
  expect(downloaded).toBe(false);
  await expect(page.getByRole("button", { name: /^다운로드:/ })).toHaveCount(1);
});

test("backup worker signs Blossom proofs as well as chat events", async ({
  page,
}) => {
  const published = await installRelay(page);
  await mediaRoutes(page);
  await page.goto("/chat/");
  await page.locator("summary").click();
  await page.getByLabel("암호화 계정 백업", { exact: true }).setInputFiles({
    name: "fixture.ncryptsec",
    mimeType: "text/plain",
    buffer: Buffer.from(encrypt(key, "fixture password", 10)),
  });
  await page.getByLabel("백업 비밀번호").fill("fixture password");
  await page.getByRole("button", { name: "백업으로 로그인" }).click();
  await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
  await attach(page);
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  await expect(
    page.getByRole("button", { name: `다운로드: ${file.name}` }),
  ).toBeVisible();
  expect(published).toHaveLength(1);
});

test("employee session signs file upload and download without a browser extension", async ({
  page,
}) => {
  await installRelay(page);
  await mediaRoutes(page);
  const account = {
    username: "staff",
    name: "직원",
    pubkey: getPublicKey(key),
    role: "member",
    mustChangePassword: false,
    status: "ready",
    provisioningError: "",
  };
  const signedKinds: number[] = [];
  await page.route("**/chat-api/session", (route) =>
    route.fulfill({ json: account }),
  );
  await page.route("**/chat-api/sign", (route) => {
    const { template } = route.request().postDataJSON();
    signedKinds.push(template.kind);
    return route.fulfill({ json: finalizeEvent(template, key) });
  });
  await page.goto("/chat/");
  await expect(page.getByRole("log")).toContainText("안녕하세요, 팀 여러분!");
  await attach(page);
  await page.getByRole("button", { name: "메시지 보내기" }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: `다운로드: ${file.name}` }).click();
  expect((await downloaded).suggestedFilename().normalize("NFC")).toBe(
    file.name,
  );
  expect(signedKinds.filter((kind) => kind === 24242)).toHaveLength(2);
});
