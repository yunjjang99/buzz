import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../../tests/helpers/bridge";
import { waitForAnimations } from "../../tests/helpers/animations";
import { KIND_HUDDLE_STARTED } from "../../src/shared/constants/kinds";

const AGENT =
  "554cef57437abac34522ac2c9f0490d685b72c80478cf9f7ed6f9570ee8624ea";
const ROOM = "11111111-1111-4111-8111-111111111111";
const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

async function korean(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("buzz-ui-language.v1", "ko");
    localStorage.setItem("buzz-theme", "buzz-dark");
  });
}

async function switchLanguage(page: Page, language: "ko" | "en") {
  // Models a language selection in the other native window, without remounting.
  await page.evaluate((next) => {
    localStorage.setItem("buzz-ui-language.v1", next);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "buzz-ui-language.v1",
        newValue: next,
        storageArea: localStorage,
      }),
    );
  }, language);
}

test("DM, wave and ended huddle cards translate; message content and actions survive", async ({
  page,
}) => {
  await korean(page);
  await installMockBridge(page);
  await page.goto("/");
  await page.getByTestId("channel-alice-tyler").click();
  await expect(page.getByTestId("message-dm-intro")).toContainText(
    "님과의 개인 대화가 시작되는 곳입니다.",
  );
  await expect(
    page.getByTestId("message-input").locator("[data-placeholder]").first(),
  ).toHaveAttribute("data-placeholder", /님에게 메시지 보내기/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "alice-tyler",
          }) ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ room, kind }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "alice-tyler",
        content: "<!-- buzz:wave:v1 -->\nEnglish 이름 waved at you.",
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "alice-tyler",
        content: JSON.stringify({ ephemeral_channel_id: room }),
        kind,
        createdAt: Math.floor(Date.now() / 1000) - 86400,
      });
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "alice-tyler",
        content: "Profile / Leave / Today — 사용자가 쓴 원문",
      });
    },
    { room: ROOM, kind: KIND_HUDDLE_STARTED },
  );
  await expect(page.getByTestId("message-wave-attachment")).toContainText(
    "English 이름 님이 손을 흔들었습니다.",
  );
  await expect(
    page
      .getByTestId("message-wave-attachment")
      .getByRole("button", { name: "허들 시작" }),
  ).toBeVisible();
  const card = page.getByTestId("huddle-attachment");
  await expect(card).toContainText("종료됨");
  await expect(card).toContainText("참여자 1명");
  await expect(card.getByRole("button", { name: "허들 보기" })).toBeVisible();
  const userMessage = page
    .getByTestId("message-row")
    .filter({ hasText: "Profile / Leave / Today — 사용자가 쓴 원문" });
  await expect(userMessage).toBeVisible();
  await userMessage.getByRole("button", { name: "추가 작업" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "메시지 복사", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await waitForAnimations(page);
  await page
    .getByTestId("message-timeline")
    .screenshot({ path: "test-results/korean-interactions/dm.png" });
  await switchLanguage(page, "en");
  await expect(page.getByTestId("message-dm-intro")).toContainText(
    "This is the beginning of your direct message with",
  );
  await expect(page.getByTestId("message-wave-attachment")).toContainText(
    "English 이름 waved at you.",
  );
  await expect(card).toContainText("1 participant");
  await expect(
    page.getByTestId("message-input").locator("[data-placeholder]").first(),
  ).toHaveAttribute("data-placeholder", /^Message /);
  await expect(userMessage).toContainText(
    "Profile / Leave / Today — 사용자가 쓴 원문",
  );
  await switchLanguage(page, "ko");
  await expect(card.getByRole("button", { name: "허들 보기" })).toBeVisible();
  await card.getByRole("button", { name: "허들 보기" }).click();
  await expect.poll(() => page.url()).toContain(ROOM);
});

test("huddle companion menus, accessible names and live language changes", async ({
  page,
}) => {
  await korean(page);
  await installMockBridge(page, {
    windowLabel: `huddle-${ROOM}`,
    huddle: {
      parentChannelId: GENERAL,
      ephemeralChannelId: ROOM,
      members: [{ pubkey: TEST_IDENTITIES.tyler.pubkey, role: "member" }],
      transcriptionEnabled: true,
    },
  });
  await page.goto("/");
  await expect(page.getByTestId("huddle-transcript-intro")).toContainText(
    "허들 채팅",
  );
  await expect(page.getByTestId("huddle-transcript-intro")).toContainText(
    "음성 대화 기록도 여기에 표시됩니다.",
  );
  await expect(page.getByRole("button", { name: "허들 나가기" })).toBeVisible();
  await page.getByRole("button", { name: "오디오 설정" }).click();
  await expect(page.getByText("입력 방식", { exact: true })).toBeVisible();
  await expect(page.getByText("시스템 기본값", { exact: true })).toBeVisible();
  await switchLanguage(page, "en");
  await expect(page.getByText("Input Mode", { exact: true })).toBeVisible();
  await switchLanguage(page, "ko");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "스피커 설정" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("스피커", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "허들에 에이전트 추가" }).click();
  await expect(page.getByTestId("add-huddle-agent-dialog")).toContainText(
    "이 허들에 참여할 에이전트를 선택하세요.",
  );
  await page.keyboard.press("Escape");
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/korean-interactions/huddle.png",
  });
  await page.getByRole("button", { name: "대화 기록 중지" }).click();
  await expect(
    page.getByRole("button", { name: "대화 기록 시작" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_COMMAND_LOG__?.some(
          (e) => e.command === "set_huddle_transcription_enabled",
        ),
      ),
    )
    .toBe(true);
});

test("agent profile tabs and confirmation dialogs preserve semantic fields and user data", async ({
  page,
}) => {
  await korean(page);
  await installMockBridge(page, {
    relayRole: "owner",
    relayRequiresMembership: true,
    archivedIdentities: [],
    managedAgents: [
      {
        pubkey: AGENT,
        name: "Charlie",
        status: "running",
        channelNames: ["agents"],
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("channel-agents").click();
  await page
    .getByTestId("message-row")
    .filter({ hasText: "Indexing the channel catalog now." })
    .getByRole("button")
    .first()
    .click();
  const panel = page.getByTestId("user-profile-panel");
  await expect(panel).toContainText("프로필");
  await expect(panel).toContainText("공개 키");
  await expect(panel).toContainText("관리자");
  await expect(panel.getByTestId("user-profile-public-key")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByTestId("user-profile-public-key").click();
  await expect(
    page.getByText("공개 키 복사 완료", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^npub1[0-9a-z]{58}$/);
  await expect(
    panel.getByRole("tab", { name: "실행 환경", exact: true }),
  ).toBeVisible();
  await panel.getByRole("tab", { name: "실행 환경", exact: true }).click();
  await expect(
    panel.getByTestId("user-profile-agent-configuration-section"),
  ).toBeVisible();
  await panel.getByRole("tab", { name: "채널", exact: true }).click();
  await expect(panel).toContainText("채널에 추가");
  await panel.getByRole("tab", { name: "기억", exact: true }).click();
  await expect(panel).toContainText("이 에이전트의 기억을 만들어 보세요");
  await panel.getByRole("tab", { name: "정보", exact: true }).click();
  await panel.getByTestId("user-profile-archive-agent-row").click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "이 에이전트를 보관할까요?",
  );
  await expect(page.getByRole("alertdialog")).toContainText(
    "이 워크스페이스에만 적용되며",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "취소" })
    .click();
  await panel.getByTestId("user-profile-delete-agent-row").click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "이 에이전트를 삭제할까요?",
  );
  await expect(page.getByRole("alertdialog")).toContainText(
    "에이전트가 속한 모든 채널에서 제거합니다",
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "취소" })
    .click();
  await waitForAnimations(page);
  await panel.screenshot({
    path: "test-results/korean-interactions/profile.png",
  });
  await switchLanguage(page, "en");
  await expect(
    panel.getByRole("tab", { name: "Info", exact: true }),
  ).toBeVisible();
  await expect(panel.getByTestId("user-profile-public-key")).toContainText(
    "Public key",
  );
  await expect(
    panel.getByTestId("user-profile-delete-agent-row"),
  ).toContainText("Delete agent");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_COMMAND_LOG__?.filter((e) =>
            /^(delete_managed_agent|archive_identity)$/.test(e.command),
          ).length,
      ),
    )
    .toBe(0);
});
